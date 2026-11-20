# Drafts → Beta：点一下，文章进草稿箱

在 iOS Drafts 写完一篇，点一次「发送到 Beta」，它就出现在 `hux.ink/beta` 的草稿列表里。
之后的配图、标签、slug、预览、发布，全部走原来那套流程 —— 这条通道只负责把文字送进去。

```
Drafts ──POST /api/integrations/drafts──▶ D1 write_drafts ──GET /api/write/drafts──▶ Beta 草稿箱
        (独立令牌，只能建/改草稿，带限流)
```

---

## 〇、第二轮审计：发现了什么、改了什么

第一版能跑，但按「并发 + 冲突判定 + 安全」的标准复查，有六处要修。结论都写在下面各节，
这里先列清单：

| # | 问题 | 严重度 | 处理 |
|---|---|---|---|
| 1 | **判断顺序反了**：先比「Drafts 指纹 == source_hash」就返回 `unchanged`。Beta 已改过、Drafts 没改时，会静默报成功，两端分叉却没人知道 | 高 | 顺序改为「先看 Beta 再比 Drafts」，Beta 变过一律 409 |
| 2 | **读-判断-写不是原子操作**：两个并发请求都读到旧状态时，后写的会盖掉先写的；并发首次创建靠 catch 异常兜底，可能冒 500 | 高 | 写回改成内容条件更新（CAS），失败就重读，只判 unchanged / 冲突，**不再重写**；创建用 `ON CONFLICT DO NOTHING` |
| 3 | 没有频率限制，令牌泄露后可以无限写 | 中 | 新增 `integration_rates` 表，按「令牌指纹 + 分钟桶」限 30 次 / 100 万字每分钟 |
| 4 | `sourceId` 只要求 `[\w-]{8,64}`，不像 UUID | 中 | 严格 UUID 校验，两种写法（带/不带连字符）归一成同一篇 |
| 5 | 指纹用 `标题 + "\n" + 正文` 拼接，标题带换行时会有歧义 | 中 | 改成 `JSON.stringify([标题, 正文])` 再哈希 |
| 6 | **打开草稿就会被重排**：`loadActive()` 里 `paragraphize()` 会把软换行改成硬段落并写回 `draft.body`，切一次后台（`pagehide` → `flushSave`）就落盘，下次发送必然误报冲突 | 高 | 给来源是 `drafts` 的稿子跳过自动排版（前端只动了这几行） |

第 6 条是这轮最值得说的一处：它不是接口的问题，是「打开即修改」的副作用。
`paragraphize()` 本身没错（它救的是早年「一行一段」的手写稿），但用在正牌 Markdown 上
等于替人改文章 —— `第一行\n第二行` 会被撑成两段，渲染结果都不一样了。

---

## 一、设计要点（为什么是这样）

**复用草稿表，只加四列。** Drafts 来的文章不是另一种东西，它就是 `write_drafts` 里的一行。
新加的四列只做账，不参与原有同步：

| 列 | 存什么 | 谁写 |
|---|---|---|
| `source` | 固定 `drafts` | 只有导入接口 |
| `source_id` | Drafts 文稿的 UUID（统一小写标准形式） | 只有导入接口 |
| `source_hash` | 上次导入时标题+正文的 SHA-256 | 只有导入接口 |
| `source_at` | 上次导入的时间（仅供排查，不参与判断） | 只有导入接口 |

原来的批量上行（`POST /api/write/drafts`）在 `ON CONFLICT DO UPDATE` 里既不读也不写这四列，
所以 Beta 端自己的同步**动不到**来源信息，老草稿也自然是空的。

**id 就是幂等键。** 草稿 id 是 `dr-` + 文稿 UUID 的标准小写形式（39 字符，还在原来的
`^[\w-]{2,64}$` 之内）。同一份 Drafts 文稿永远算出同一个 id —— 网络超时重试、手抖连点两次，
库里也只会有一行。不需要额外的去重表。

### 判断顺序（顺序不能换）

```
1. 没有这一行            → 建草稿                    201 created
2. deleted_at > 0        → 409 draft_deleted         不复活
3. published_at / edit   → 409 draft_published       不动线上内容
4. Beta 指纹 ≠ source_hash → 409 draft_conflict      不管 Drafts 变没变
5. Drafts 指纹 == source_hash → 200 unchanged        两边都没变
6. 其余                  → 更新                      200 updated
```

第 4 步在第 5 步之前，是这轮修的核心。反过来写（先比 Drafts）会出现这样一条静默路径：

> Beta 里改过正文 → Drafts 里什么都没动 → 再点一次 → 「已发送到 Beta」→ 其实什么都没写。

功能上没丢数据，但用户以为同步成功了，两端的分叉从此没人发现。现在这种情况会明确报
`409 draft_conflict`，`conflict.reason = 'beta_modified'`，Action 会提示「Beta 里的修改保留着，
不用重发」。

| 情况 | 判定 | 结果 |
|---|---|---|
| 没有这一行 | 新文稿 | `201 created` |
| 墓碑 | 用户在 Beta 删了 | `409 draft_deleted` |
| 已发布 | 已是线上文章 | `409 draft_published` |
| Beta 改过 + Drafts 没改 | 两端分叉 | `409 draft_conflict`（`reason: beta_modified`） |
| Beta 改过 + Drafts 也改 | 两端都动了 | `409 draft_conflict`（`reason: both_modified`） |
| 两边都没变 | 重试 / 连点 | `200 unchanged`，一个字段都不写 |
| 只有 Drafts 变 | 正常同步 | `200 updated`，跟着 Drafts 改标题正文 |

更新时只写 `title` / `body` / `updated_at` / 指纹，**标签、slug、发布时间一律不碰** ——
这些是进 Beta 之后才配的，Drafts 不知道也不该知道。

### 为什么不用时间判断

手机和 Worker 的时钟对不上是常态。拿 `updated_at` 比大小，会同时制造两种错误：明明没人
改动却报冲突，或者改过却被悄悄覆盖。这里的判据只有内容指纹，跟任何一端的时钟无关 ——
把行时间设成 1970 或 2030，结论都一样（有测试盯着）。

### 并发：条件更新（CAS）

「先查、再判断、再写」天生不是原子的：两个请求同时读到同一份旧状态，都认为「Beta 没动过」，
后写的那个就把先写的盖掉。所以写回时带上读到的内容做条件：

```sql
UPDATE write_drafts
   SET title = ?, body = ?, updated_at = ?, source_hash = ?, source_at = ?
 WHERE id = ? AND deleted_at = 0
   AND source_hash IS ? AND title IS ? AND body IS ?     -- ← 这三个是乐观锁
```

`changes = 0` 说明这一瞬间被别人改过了。这时候**不重写**，只重读一次，按新状态给结论：

| 重读之后看到 | 返回 |
|---|---|
| 已经被删 | `409 draft_deleted` |
| Beta 指纹对不上（真人编辑） | `409 draft_conflict` |
| 写进去的正是我们这份内容 | `200 unchanged`（重试撞上自己，收敛） |
| 别人写了另一份内容 | `409 concurrent_update`，让客户端重发 |

**一次请求只写一次**，绝不「重试到成功」——否则手里那份旧快照就有机会盖掉刚落库的新内容，
也就是「旧请求覆盖新请求」。宁可让客户端多发一次，也不猜。

首次创建同理：`INSERT ... ON CONFLICT(id) DO NOTHING` 撞车不抛异常（不会变 500），
`changes = 0` 就重读一遍，内容一样 → `unchanged`，不一样 → `concurrent_update`。

### 内容指纹

```js
sha256(JSON.stringify([title, body]))
```

为什么不是 `title + "\n" + body`：那样 `("a", "b\nc")` 和 `("a\nb", "c")` 都会哈希成 `a\nb\nc`，
标题里带换行时两边会撞成同一个指纹，冲突检测直接失效。JSON 序列化会把引号、反斜杠、换行
都转义掉，数组边界没有歧义。有一条测试专门构造这组输入。

### 文本处理规则（写清楚了，别猜）

| 处理 | 标题 | 正文 |
|---|---|---|
| 换行符 `\r\n`、`\r` → `\n` | ✅ | ✅ |
| 去掉 `\u0000`（NUL，D1 写入会出问题） | ✅ | ✅ |
| 首尾空白 `trim()` | ✅ | ❌ 不 trim |
| 空行、缩进、Markdown 标记 | 不涉及 | ❌ 一律不动 |
| 补空行 / 重排段落 | ❌ | ❌ 服务端从不排版 |

也就是说：**正文除了换行符归一和去 NUL，一个字符都不改**。连续空行、行尾空格、缩进、
代码块、引用、列表全都原样进库。标题会去掉首尾空白（不然 `# 标题 ` 会带个尾巴）。

Drafts Action 那一侧另外做了两件小事（在手机上、发请求之前）：跳过标题前的空行、
去掉标题后紧跟的空行和整段末尾的空白。这两步不影响 Markdown 语义，但也确实改了字面 ——
所以旧版文档里「一个字符都不改写」的说法是不准确的，这里更正。

### 令牌与限流

`DRAFTS_INTEGRATION_TOKEN` 只在这一个 handler 里比对：换不到会话 Cookie，进不了
`/api/write/*`（发布、传图、删图），也进不了 `/api/comments/*`。手机上即使明文被抓，
损失上限是「往草稿箱塞草稿，且每分钟最多 30 次 / 100 万字」。

限流按「令牌指纹 + 60 秒时间桶」记账（`integration_rates` 表），只存指纹不存令牌：

| 维度 | 上限 | 超了 |
|---|---|---|
| 次数 | 30 次 / 分钟 | `429 rate_limited`，带 `Retry-After` |
| 写入量 | 100 万字符 / 分钟（按请求体算） | 同上 |

老时间桶每次请求顺手删掉，表里永远只有十几行。计数用的是「自增 + 读取」两条语句：
自增是原子的，读到的值可能慢一两个请求 —— 对限流来说这点误差没关系，换来的是不依赖
`RETURNING`（D1 上的行为本文没有实测，见第九节）。

---

## 二、部署（Worker 端）

> 状态：2026-11-20 已部署到生产（Version `4376828f`），`DRAFTS_INTEGRATION_TOKEN` 已写入 Secret，
> 线上联调通过（明细见第八节第 1 条）。下面是操作记录，换机器或重装时照做即可。

### 1. 生成令牌并写进 Secret

```bash
# 32 字节随机串，别用能记住的字符串
openssl rand -hex 32

npx wrangler secret put DRAFTS_INTEGRATION_TOKEN
# 粘贴上面那串，回车
```

### 2. 部署

```bash
npx wrangler deploy
```

数据库不用手动动：`worker/src/db.js` 里 `SCHEMA_VERSION` 升到了 `7`，Worker 收到第一个
请求时会自己跑 `ALTER TABLE write_drafts ADD COLUMN ...` 补上四列，并建出 `integration_rates`。
已存在的草稿不受影响（有一条测试专门盯着这件事）。

想手动确认：

```bash
npx wrangler d1 execute blog-comment --remote \
  --command "PRAGMA table_info(write_drafts)"

npx wrangler d1 execute blog-comment --remote \
  --command "SELECT name FROM sqlite_master WHERE name='integration_rates'"
```

### 3. 联调（发一篇假的，再删掉）

```bash
TOKEN='<刚才那串>'

curl -sS -X POST https://comments.hux.ink/api/integrations/drafts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"drafts","sourceId":"11111111-2222-3333-4444-555555555555","title":"联调测试","body":"第一段\n\n第二段"}'
```

预期 `201` + `{"ok":true,"status":"created",...}`。再发一次同样的内容，应返回
`{"status":"unchanged"}`，草稿列表里仍然只有一篇。最后在 Beta 里把它删掉即可。

令牌不对 `401`，没配 Secret `503`，发太快 `429`。

### 4. 令牌轮换与撤销

**轮换**（旧令牌在新令牌生效前仍然可用，不会断服）：

```bash
npx wrangler secret put DRAFTS_INTEGRATION_TOKEN   # 填新值，Worker 立刻换成新的
# 然后到 Drafts → 那个 Action → 第一次运行时重新输入令牌
```

Drafts 的 Credential 存在本机钥匙串里，改 Secret **不会**自动更新手机上的那一份 ——
必须手动让 Action 重新授权一次：Drafts 设置里删掉这条 Credential（`Beta 草稿箱`），
再跑一次 Action 就会重新弹输入框。

**撤销**（立刻失效，不需要改代码）：

```bash
npx wrangler secret delete DRAFTS_INTEGRATION_TOKEN
# 或者换成一个谁也猜不到的随机值
```

删除后接口立刻返回 `503 integration_not_configured`，已有的草稿和 Beta 一切功能都不受影响
（这条通道从来只写草稿表）。轮换后建议顺手把 `integration_rates` 里的老指纹行清掉，
不清也无所谓，最多留十几个空转的行。

---

## 三、Drafts 端：装 Action

### 1. 新建 Action

1. Drafts 里打开任意一篇文稿，点键盘上方的 **Action 图标**（四象限那个）；
2. 打开 Action 列表后，点右上角 **`…` → Edit / Manage Actions**；
3. 点左上角 **`+` → New Action**；
4. 名字填 **发送到 Beta**，图标随便挑一个向上的箭头。

### 2. 加一个 Script 步骤

1. 在 Action 编辑器里点 **Steps → `+` → Script**；
2. 把 `docs/drafts/send-to-beta.js` 的全部内容粘进去；
3. 返回，点 **Save**。

> 脚本整段是一个 IIFE。Drafts 的 Script 步骤把代码当**脚本**直接跑，不会包进函数，
> 所以分支里的 `return` 必须待在自己包的函数里 —— 否则第一次运行就报
> `SyntaxError: Return statements are only valid inside functions`（2026-11-20 真机上踩过一次）。
> 粘贴时保留开头的 `(function () {` 和结尾的 `})();`，别只复制中间部分。

> 手机上粘代码：把这个文件 AirDrop 到「文件」App，用 Drafts 打开，全选复制；
> 或者先在电脑上把它发到自己的备忘录里再复制。

### 3. After Success 设成 Nothing

Action 编辑器的 **After Success** 选 **Nothing**（脚本自己会弹「已发送到 Beta」）。
**别选 Open URL** —— 那会跳去浏览器，正好违反「发完留在 Drafts」。

### 4. 第一次运行

第一次点这个 Action 会弹一个输入框，要 **集成令牌** —— 就是第 1 步 `wrangler secret put`
时填的那串。Drafts 会把它存进自己的 Credential（iOS 钥匙串加密），以后不再问。

以后每次就一步：**点 Action → 顶部弹「已发送到 Beta」**。

### 5. 标题怎么认

| Drafts 里的内容 | 送进 Beta 的标题 | 正文 |
|---|---|---|
| 第一行 `在雨里走了一段路` | 在雨里走了一段路 | 第二行起 |
| 第一行 `# 在雨里走了一段路` | 在雨里走了一段路 | 第二行起 |
| 第一行 `#标签 开头的一段` | `#标签 开头的一段`（不动，那不是标题） | 第二行起 |
| 开头有空行 | 跳过空行取第一个非空行 | 标题之后 |

正文的 Markdown 标记、空行、列表、代码块、引用、emoji 全部原样。上限：标题 300 字、
正文 20 万字（和 Beta 草稿同步同一条线）。超了会明确提示，不会截断。

### 6. 报错都长什么样

| 情况 | 提示 |
|---|---|
| 断网 / 超时 | 「连不上 Beta（…）。草稿原文没动，网络好了再点一次。」 |
| 401 | 「令牌不对（401）。…检查 Drafts 里存的令牌是否和 Worker Secret 一致。」 |
| 409 | 服务端原话 + 「Beta 里的版本：《标题》」+ 下一步该怎么做（重发无用 / 要先删旧稿） |
| 413 | 「这篇太长了（413）」 |
| 429 | 「发得太勤了（429）。约 N 秒后再试。」 |
| 5xx | 「Beta 服务端出问题了（500）…草稿原文没动。」 |

任何情况下都不会误报成功，也不会 `draft.update()` 动原文。

---

## 四、接口

```
POST /api/integrations/drafts
Authorization: Bearer <DRAFTS_INTEGRATION_TOKEN>
Content-Type: application/json

{ "source": "drafts", "sourceId": "<Drafts draft.uuid>", "title": "标题", "body": "Markdown 正文" }
```

成功（`ok: true`）：

```json
{ "ok": true, "status": "created", "id": "dr-f3a1…", "title": "…", "updatedAt": 1763600000000, "serverTime": 1763600000000 }
```

`status` 三种：`created`（新建，HTTP 201）、`updated`、`unchanged`。**只有这三种才该报成功。**

失败（`ok: false`）：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `bad_json` / `bad_source` / `bad_source_id` / `title_required` / `title_too_long` | 请求本身有问题 |
| 401 | `unauthorized` | 令牌不对 |
| 409 | `draft_conflict` | Beta 改过。带 `conflict.reason`（`beta_modified` / `both_modified`）、`conflict.beta.excerpt`、`hint` |
| 409 | `draft_deleted` | 这篇在 Beta 被删了，不复活 |
| 409 | `draft_published` | 已经发成正式文章，不覆盖 |
| 409 | `id_conflict` | id 被别的草稿占用（理论上不会发生） |
| 409 | `concurrent_update` | 三轮都没抢到写锁，稍后重试 |
| 413 | `body_too_large` | 正文超 20 万字 |
| 429 | `rate_limited` | 超过 30 次/分钟或 100 万字/分钟，带 `Retry-After` |
| 500 | `draft_save_failed` | 云库写入失败，可重试 |
| 503 | `integration_not_configured` | 没配 Secret |

---

## 五、Beta 端要检查的那几件事

| 关注点 | 结论 |
|---|---|
| Drafts 草稿能否被下一次同步拉到 | 能。`GET /api/write/drafts` 不区分来源，`adoptRemote()` 见到本地没有、`hasContent()` 为真的行就 `unshift` 进来 |
| id 与 Beta 本地生成的 id 是否兼容 | 兼容。都是字符串主键，`dr-…` 满足 `^[\w-]{2,64}$`；`if (!draft.id) draft.id = blankDraft().id` 也不会覆盖它 |
| 新草稿会不会被本地旧数据盖掉 | 不会。云端行的 `updated_at` 是服务端 `Date.now()`，`adoptRemote` 只在 `remote.updatedAt > local.updatedAt` 时覆盖，新 id 本地压根没有 |
| 已打开的编辑器会不会被同步意外覆盖 | 不会。正在编辑的那篇有 `dirty[id] \|\| isEditingNow()` 保护 |
| 删除后会不会被重复导入 | 不会。墓碑行留在库里，导入接口见到就 409 |
| 已发布状态会不会和来源标识打架 | 不会。`published_at > 0 \|\| edit_path` 直接 409，且导入只写草稿表，从不写 GitHub |
| Beta 自己的上行会不会冲掉来源列 | 不会。批量 upsert 的列清单里没有 `source*`，且有测试盯着 |
| **仅打开一篇 Drafts 草稿会不会改动正文** | **这轮修了**。`loadActive()` 原本无条件 `paragraphize()` 并写回 `draft.body`；`pagehide` / `visibilitychange` 都会 `flushSave()`，于是「打开→切后台」就会把重排后的正文落盘、顶掉 `updatedAt`，下次发送误报冲突。现在 `source === 'drafts'` 的稿子走原样装载 |
| 真正编辑过之后还要不要冲突保护 | 要，而且还在。用户改过 → 内容变了 → 指纹变了 → 下次发送 409 |

### 前端只动了这几行

```js
// blankDraft()：新草稿没有来源
source: ''

// adoptRemote()：云端拉下来时带上来源
source: remote.source || ''
if (remote.source) local.source = remote.source;

// loadActive()：Drafts 来的稿子原样装载，别替人排版
var body = draft.source === 'drafts' ? String(draft.body || '') : paragraphize(draft.body || '');
```

服务端 `GET /api/write/drafts` 多回一个 `source: '' | 'drafts'`，普通草稿拿到空串，
行为与以前完全一样。上行（`wireDraft`）**不带** `source`：来源只有导入接口能写。
另有 3 条测试盯着这段（`tests/beta-draft-source.test.mjs`），包括「`paragraphize` 确实会
把软换行改成硬段落」这个前提本身。

---

## 六、改了哪些文件

| 文件 | 改动 |
|---|---|
| `worker/src/drafts.js` | 新增。鉴权、限流、严格 UUID、JSON 指纹、判断顺序、CAS 循环、幂等创建 |
| `worker/src/index.js` | 一行 import + 一条 `POST /api/integrations/drafts` 路由（不走 `adminGate`） |
| `worker/src/db.js` | `write_drafts` 加 4 列；新增 `integration_rates` 表；`SCHEMA_VERSION` 6 → 7 |
| `worker/src/write.js` | `GET /api/write/drafts` 多回一个 `source`（读写列清单分开，避免影响上行） |
| `worker/schema.sql` | 同步建表与限流表 |
| `static/beta/index.html` | 4 行：`blankDraft` 带 `source`、`adoptRemote` 保留 `source`、`loadActive` 跳过自动排版 |
| `wrangler.toml` | 只加注释：说明这个 Secret 怎么设、能干什么 |
| `docs/drafts/send-to-beta.js` | 新增。Drafts Action 脚本（含 429 分支） |
| `docs/drafts-to-beta.md` | 新增。本文 |
| `tests/drafts-integration.test.mjs` | 24 条：接口、冲突顺序、指纹、并发、限流、迁移 |
| `tests/drafts-action-script.test.mjs` | 14 条：Action 脚本逻辑 + 顶层可编译 + 请求体字段 |
| `tests/beta-draft-source.test.mjs` | 3 条：前端「打开即重排」的回归 |

没动：Hugo 发布流程、`static/admin/*`、FlareMo / 哔哔发布、GitHub 与 R2 相关代码。

---

## 七、测试

```
node --test tests/*.test.mjs
# tests 158
# pass 158
# fail 0
```

`hugo --quiet` 与 `wrangler deploy --dry-run` 也都通过。

### 接口与并发（`tests/drafts-integration.test.mjs`，24 条）

用真 SQLite（`node:sqlite`）当 D1，SQL 与线上同一份。

1. 首次发送建草稿，标题正文原样落库，Beta 列表拉得到（并带上 `source`）
2. 重复发送相同内容 → `unchanged`，不新建、不改进度时间
3. Drafts 改正文、Beta 没动 → `updated`，标签与 slug 不丢
4. **Beta 改过、Drafts 没变 → 409 `beta_modified`（第一轮会误报 unchanged）**
5. Beta 改过、Drafts 也改 → 409 `both_modified`，两边都留着
6. 时间戳设成 1970 / 未来，结论不变（只认内容）
7. Beta 删除过 → 409，墓碑还在，列表里不复活
8. 已发布 → 409，不覆盖不新建
9. **指纹边界：`("a","b\\nc")` 与 `("a\\nb","c")` 不撞**（拼接式指纹会在这里漏判）
10. 换行符归一：CRLF 与 LF 视为同一份内容
11. 正文不排版：缩进、连续空行、行尾空白都留着
12. **并发首次创建：一个 201、一个 200，只有一行，没有 500**
13. **并发两个不同版本：只有先到的写进去（一个 200、一个 409 `concurrent_update`），
    落库内容正好是写成功的那一份，再发一次是 unchanged**
14. **读完之后 Beta 删了：409 `draft_deleted`，正文没被写回去**
15. **限流：第 31 次 → 429，带 Retry-After，且不写库**
16. **限流：写入量超 100 万字符 → 429**
17. 令牌缺失/写错/未配置 → 401 / 401 / 503，且不落库
18. source / sourceId / 标题 / JSON 各自返回明确错误码（含 4 组非法 UUID）
19. UUID 带/不带连字符 → 同一篇，第二次是 `unchanged`
20. 20 万字以上 → 413
21. 中文、Markdown、emoji、代码块、特殊字符原样往返
22. Beta 原样推回来：不抹掉来源列，不变「认不出的新稿」
23. Beta 改过之后 Drafts 再发：判得出冲突
24. 老库（旧表结构 + version=5）升级：补四列 + 建限流表，已有草稿一条不少

### Action 脚本（`tests/drafts-action-script.test.mjs`，14 条）

搭了一个最小的 Drafts 运行时（`Credential` / `HTTP` / `app` / `context`），`http.request`
直接接到真实 Worker 上，所以「脚本发的字段名」与「Worker 认的字段名」对不上会当场红。

25. 首行当标题、正文原样、弹「已发送到 Beta」，且 `draft.update()` 一次没调
26. `# 标题` 去井号，`#标签` 原样保留
27. 开头空行、结尾空白不影响结果
28. 连点两次第二次报「已是最新」，库里仍只有一篇
29. Drafts 改正文后报「已更新」，草稿跟着变
30. Beta 改过 → 报失败，带 Beta 侧标题与下一步，绝不误报成功
31. 令牌不对（401）→ 报失败并指明令牌
32. 断网 → 报「连不上」，不报成功，原文不动
33. 用户取消授权 → 一个请求都不发
34. 空文稿 / 301 字标题 → 本地就拦住
35. **429 → 报失败并说明多久后重试**
36. **Beta 改过但 Drafts 没变 → 提示「不用重发」，不覆盖**
37. **脚本能被当成普通脚本编译**：Drafts 的 Script 步骤不包函数，顶层 `return` 会直接
    语法错（2026-11-20 真机踩到），`vm.Script` 这条挡回归
38. **请求体走 `data` + `encoding: "json"`**：断言没有 `body` 键（Drafts 会整个忽略它）

### 前端（`tests/beta-draft-source.test.mjs`，3 条）

39. `paragraphize` 确实会把 `第一行\n第二行` 改成两段（列表/代码/表格/引用不动）
40. `loadActive` 里那行 `source === 'drafts'` 判断还在
41. 来源标记在新建、合并、上行三处的取舍都对（上行不带 `source`）

### 没有自动化的部分

- 真实浏览器里的「打开一篇 Drafts 草稿 → 切到别的 App → 回来 → 再发送」：需要手工过一遍，
  但代码路径已经确定（`loadActive` 不重排 → `capture()` 写回的是同一份内容 → 指纹不变）。
- Drafts App 本身（令牌输入框、成功提示的位置、After Success 行为）：只能真机看。

---

## 八、尚未解决的风险

1. **真实 D1 已实测（2026-11-20，生产，Version `4376828f`）。** 原本列为「本地过、线上未知」
   的几处 —— `ON CONFLICT ... DO NOTHING`、`WHERE ... AND source_hash IS ?` 条件更新、
   `.run()` 的 `meta.changes` —— 都在生产上跑过了：

   | 请求 | 结果 |
   |---|---|
   | 首次创建 | `201 created` |
   | 原样重发 | `200 unchanged` |
   | 改正文再发（Beta 未动） | `200 updated` —— **条件写命中，CAS 可用** |
   | 再改第三次 | `200 updated` |
   | 直接改 D1 里的正文后重发 | `409 draft_conflict`，`reason: beta_modified` |
   | 打上墓碑后重发 | `409 draft_deleted` |
   | 错令牌 | `401` |

   表结构也确认过：`write_drafts` 补出 `source / source_id / source_hash / source_at` 四列，
   `integration_rates` 建出来了，`schema:version` = `7`。当时造的两条测试草稿已硬删
   （`SELECT COUNT(*) FROM write_drafts WHERE id LIKE 'dr-%'` = 0）。
   仍未覆盖的只有限流清理那条 `DELETE ... WHERE bucket < ?` —— 它失败也只是多留几行空账。
2. **并发只在单进程里验证过。** Node 的单线程 + 事件循环能把「两个请求都读到旧状态」这条
   路径逼出来（用 barrier 强行制造），但 D1 的真实并发（多 isolate、多区域）没法在本地复现。
   CAS 的写法对这种场景天然安全 —— 条件更新由数据库判定，不依赖进程内状态 —— 但这是推理，
   不是实测。
3. **同一文稿的并发发送，只有先到的写进去。** 两次内容不同的请求同时到，后到的那次会拿到
   `409 concurrent_update`，需要重发一次。没有可靠的客户端序号（也不该信手机时间），所以
   判断不了「哪一份更新」—— 与其猜，不如让用户再点一下。正常使用里同一篇不会同时发两次。
4. **限流是按令牌整体计的**，不是按文稿。一次连发 30 篇以上会被拦，需要等一个窗口。
   真遇到可以调 `worker/src/drafts.js` 里的 `RATE_MAX_HITS`。
5. **rate 计数读到的值可能慢一两个请求**（自增与读取是两条语句），极端情况下同一瞬间的
   两个请求能一起越过上限。限流是防护，不是精确计费。
6. **`/api/write/drafts` 的 `since` 语义没变**：它按 `updated_at` 过滤，而导入写的就是
   `updated_at`。如果 Beta 客户端正在编辑同一篇（`dirty` 标记），上行可能被判「更旧」而丢一次，
   这属于原有行为，本次没有改动。
7. **iOS 真机未验证**（本机没有 Drafts）。脚本按官方 Scripting API 写，逻辑层有 13 条测试，
   但「第一次弹令牌框」「顶部提示的样式」只能真机确认。
8. **Drafts 的 Script 步骤不包函数**（2026-11-20 真机踩到）。第一版脚本按「脚本被包在函数里」
   写，用了顶层 `return`，iOS 上直接
   `SyntaxError: Return statements are only valid inside functions`，一次都没发出去。
   现已整段包成 IIFE，并加了一条 `vm.Script` 编译测试 —— 语义与 Drafts 一致，顶层 `return`
   会当场失败，这类错误不会再流到真机。
9. **`http.request()` 没有 `body` 选项**（同日第二次踩到，紧接上一条）。官方 `request(settings)`
   只认 `data` + `encoding: "json" | "form"`，`timeout` 是 `HTTP` 对象上的属性而不是 request 的键。
   用 `body` 传字符串会被**整段忽略**，服务端收到空请求体，回 `400 请求体是空的` —— 表现是
   Action Log 里 `HTTP.request Failed: 400`，很像鉴权或网络问题，其实是没发出去东西。
   已改成 `data: {...}` + `encoding: "json"`、`http.timeout = 30`；测试里的假 HTTP 也改成
   只按这个语义序列化，脚本若退回 `body`，所有成功用例当场红。

---

## 九、边界

- 一次只发一篇；不做批量、不做双向同步、不回读 Beta 的修改到 Drafts。
- 图片：`[[image-…]]` 这类 Drafts 附件占位符会当成普通文字发过去，第一阶段不传图。
  正文里自己写 `![](https://img.hux.ink/...)` 是可以的，Beta 会照常渲染。
- 单设备本机最多留 30 篇草稿（`MAX_DRAFTS`，原有限制）。云端不受此限。
- 删掉的行永远占着那个 id。要让同一篇文稿重新进 Beta，在 Drafts 里「Duplicate」成新文稿
  （新 UUID）再发。
- 发布流程没有变：导入只写 `write_drafts`，不碰 GitHub。
