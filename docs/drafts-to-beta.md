# Drafts → Beta：点一下，文章进草稿箱

在 iOS Drafts 写完一篇，点一次「发送到 Beta」，它就出现在 `hux.ink/beta` 的草稿列表里。
之后的配图、标签、slug、预览、发布，全部走原来那套流程 —— 这条通道只负责把文字送进去。

```
Drafts ──POST /api/integrations/drafts──▶ D1 write_drafts ──GET /api/write/drafts──▶ Beta 草稿箱
        (独立令牌，只能建/改草稿)
```

---

## 一、设计要点（为什么是这样）

**复用草稿表，只加四列。** Drafts 来的文章不是另一种东西，它就是 `write_drafts` 里的一行。
新加的四列只做账，不参与原有同步：

| 列 | 存什么 | 谁写 |
|---|---|---|
| `source` | 固定 `drafts` | 只有导入接口 |
| `source_id` | Drafts 文稿的 UUID | 只有导入接口 |
| `source_hash` | 上次导入时 `(标题+正文)` 的 SHA-256 | 只有导入接口 |
| `source_at` | 上次导入的时间（仅供排查，不参与判断） | 只有导入接口 |

原来的批量上行（`POST /api/write/drafts`）在 `ON CONFLICT DO UPDATE` 里既不读也不写这四列，
所以 Beta 端自己的同步**动不到**来源信息，老草稿也自然是空的。

**id 就是幂等键。** 草稿 id 是 `dr-` + 文稿 UUID 的小写形式（39 字符，还在原来的
`^[\w-]{2,64}$` 之内）。同一份 Drafts 文稿永远算出同一个 id —— 网络超时重试、手抖连点两次，
库里也只会有一行。不需要额外的去重表。

**冲突只看内容，不看时钟。** 手机和 Worker 的时间对不上是常态：拿 `updated_at` 比大小，
就会出现「明明没人改却报冲突」，或者更糟的「改过却被悄悄覆盖」。这里的判据是
`source_hash`（上次导入的内容指纹）与行里当前内容的指纹是否一致：

| 情况 | 判定 | 结果 |
|---|---|---|
| 没有这一行 | 新文稿 | `201 created`，建草稿 |
| 指纹相同 | 和上次发的一模一样 | `200 unchanged`，一个字段都不写 |
| 指纹不同，行内容 == `source_hash` | Beta 端没动过 | `200 updated`，跟着 Drafts 更新标题正文 |
| 指纹不同，行内容 != `source_hash` | Beta 端改过 | `409 draft_conflict`，两边都留着 |
| `deleted_at > 0` | 用户在 Beta 删了 | `409 draft_deleted`，不复活 |
| `published_at > 0` 或 `edit_path` 非空 | 已经发成正式文章 | `409 draft_published`，不动线上内容 |

更新时只写 `title` / `body` / `updated_at` / 指纹，**标签、slug、发布时间一律不碰** ——
这些是进 Beta 之后才配的，Drafts 不知道也不该知道。

**令牌是单独一把。** `DRAFTS_INTEGRATION_TOKEN` 只在这一个 handler 里比对：
它换不到会话 Cookie，进不了 `/api/write/*`（发布、传图、删图），也进不了 `/api/comments/*`。
手机上即使是明文被抓，损失上限也只是「能往草稿箱里塞一篇草稿」。

---

## 二、部署（Worker 端）

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

数据库不用手动动：`worker/src/db.js` 里 `SCHEMA_VERSION` 升到了 `6`，Worker 收到第一个
请求时会自己跑 `ALTER TABLE write_drafts ADD COLUMN ...` 补上四列。已存在的草稿不受影响
（有一条测试专门盯着这件事：`老库升级：旧表结构补上 source 四列，已有草稿一条不少`）。

想手动确认列加上了：

```bash
npx wrangler d1 execute blog-comment --remote \
  --command "PRAGMA table_info(write_drafts)"
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

令牌不对时是 `401 unauthorized`，没配 Secret 时是 `503 integration_not_configured`。

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

正文一个字符都不改写：Markdown 标记、空行、列表、代码块、引用、emoji 全部原样。
只做两件无关紧要的清理：去掉标题后紧跟着的空行、去掉结尾的空白。

上限：标题 300 字、正文 20 万字（和 Beta 草稿同步同一条线）。超了会明确提示，不会截断。

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
{ "ok": true, "status": "created", "id": "dr-f3a1...", "title": "在雨里走了一段路", "updatedAt": 1763600000000, "serverTime": 1763600000000 }
```

`status` 三种：`created`（新建，HTTP 201）、`updated`（跟着 Drafts 更新）、
`unchanged`（内容和上次一样，没写库）。**只有这三种才该报成功。**

失败（`ok: false`）：

| HTTP | code | 含义 |
|---|---|---|
| 400 | `bad_json` / `bad_source` / `bad_source_id` / `title_required` / `title_too_long` | 请求本身有问题 |
| 401 | `unauthorized` | 令牌不对 |
| 409 | `draft_conflict` | Beta 里改过，带 `conflict.beta.excerpt` 和 `hint` |
| 409 | `draft_deleted` | 这篇在 Beta 被删了，不复活 |
| 409 | `draft_published` | 已经发成正式文章，不覆盖 |
| 413 | `body_too_large` | 正文超 20 万字 |
| 500 | `draft_save_failed` | 云库写入失败，可重试 |
| 503 | `integration_not_configured` | 没配 Secret |

---

## 五、Beta 端要检查的那几件事（结论：不用改前端）

| 关注点 | 结论 |
|---|---|
| Drafts 草稿能否被下一次同步拉到 | 能。`GET /api/write/drafts` 不区分来源，`adoptRemote()` 见到本地没有、`hasContent()` 为真的行就 `unshift` 进来 |
| id 与 Beta 本地生成的 id 是否兼容 | 兼容。都是字符串主键，`dr-…` 满足 `^[\w-]{2,64}$`；前端的 `if (!draft.id) draft.id = blankDraft().id` 也不会覆盖它 |
| 新草稿会不会被本地旧数据盖掉 | 不会。云端行的 `updated_at` 是服务端 `Date.now()`，`adoptRemote` 只在 `remote.updatedAt > local.updatedAt` 时才覆盖，新 id 本地压根没有 |
| 已打开的编辑器会不会被同步意外覆盖 | 不会。正在编辑的那篇有 `dirty[id] \|\| isEditingNow()` 保护 |
| 删除后会不会被重复导入 | 不会。墓碑行（`deleted_at`）留在库里，导入接口见到就 409 |
| 已发布状态会不会和来源标识打架 | 不会。`published_at > 0 \|\| edit_path` 直接 409，且导入只写草稿表，从不写 GitHub |
| Beta 自己的上行会不会冲掉来源列 | 不会。批量 upsert 的列清单里没有 `source*`，还有一条测试专门盯着这件事 |

也就是说：**前端一行没改**。Drafts 来的草稿和手写草稿在列表里完全一样，多出来的
只有服务端那四列账。

一个符合预期的行为：草稿在 Beta 里打开后，`paragraphize()` 会把「一行一段」补成真段落，
如果这时用户又敲了字，`capture()` 会把补过空行的正文存下来 —— 内容指纹从此对不上，
下一次 Drafts 发送就是 `409 冲突`。这是保守策略：**Beta 里动过就不覆盖**。

---

## 六、改了哪些文件

| 文件 | 改动 |
|---|---|
| `worker/src/drafts.js` | 新增。导入 handler：鉴权、校验、来源关联、内容指纹冲突判断、幂等插入 |
| `worker/src/index.js` | 加一行 import、一个 `POST /api/integrations/drafts` 路由（不走 `adminGate`）、文件头注释补一行 |
| `worker/src/db.js` | `write_drafts` 建表语句加 4 列；`MIGRATIONS` 加 4 条 `ALTER`；`SCHEMA_VERSION` 5 → 6 |
| `worker/schema.sql` | 同步建表语句（含老库补列的注释版 SQL） |
| `wrangler.toml` | 只加注释：说明这个 Secret 怎么设、能干什么 |
| `docs/drafts/send-to-beta.js` | 新增。Drafts Action 脚本 |
| `docs/drafts-to-beta.md` | 新增。本文 |
| `tests/drafts-integration.test.mjs` | 新增 14 条回归测试（接口 + 迁移） |
| `tests/drafts-action-script.test.mjs` | 新增 10 条回归测试（Action 脚本本身） |

没动：`static/beta/index.html`、`static/admin/*`、发布流程、FlareMo / 哔哔 Action、
GitHub 相关代码、R2 相关代码。

---

## 七、测试

```
node --test tests/*.test.mjs
# tests 141
# pass 141
# fail 0
```

新增 24 条，分两个文件。

**`tests/drafts-integration.test.mjs`（14 条，用真 SQLite 当 D1，走真实 SQL）**

1. 首次发送建草稿，标题正文原样落库，Beta 列表拉得到
2. 重复发送相同内容 → `unchanged`，不新建不改进度时间
3. Drafts 改正文、Beta 没动 → 跟着更新，标签与 slug 不丢
4. Beta 改过 → 409，Beta 内容一个字符不动，回执带 excerpt
5. 冲突判断只看内容：把 `updated_at` 设成 1970 或未来，结论都不变
6. Beta 删除过 → 409，墓碑还在，列表里不复活
7. 已发布 → 409，不覆盖不新建
8. 令牌缺失/写错/未配置 → 401 / 401 / 503，且不落库
9. source / sourceId / 标题 / JSON 各自返回明确错误码
10. 20 万字以上 → 413
11. 中文、Markdown、emoji、代码块、特殊字符原样往返
12. Beta 把草稿原样推回来，不会抹掉来源列，也不会变成「认不出的新稿」
13. Beta 改过之后 Drafts 再发，仍然判得出冲突
14. 老库（旧表结构 + version=5）升级后补齐四列，已有草稿一条不少

**`tests/drafts-action-script.test.mjs`（10 条，把 `docs/drafts/send-to-beta.js` 真跑一遍）**

搭了一个最小的 Drafts 运行时（`Credential` / `HTTP` / `app` / `context`），HTTP 直接接到
真实 Worker 上，所以「脚本发的字段名」和「Worker 认的字段名」对不上会当场红：

15. 第一行当标题、正文原样、弹「已发送到 Beta」，且 `draft.update()` 一次都没调
16. `# 标题` 去掉井号，`#标签` 原样保留
17. 开头空行、结尾空白不影响结果
18. 连点两次第二次报「已是最新」，库里仍只有一篇
19. Drafts 改正文后报「已更新」，草稿跟着变
20. Beta 改过 → 报失败，提示里带 Beta 侧标题与下一步，绝不误报成功
21. 令牌不对（401）→ 报失败并指明令牌
22. 断网 → 报「连不上」，不报成功，原文不动
23. 用户取消授权 → 一个请求都不发
24. 空文稿 / 301 字标题 → 本地就拦住，不浪费请求

### 还没做的验证

- **真机**：本机没有 iOS / Drafts，Action 的交互（首次弹令牌框、顶部提示、After Success）
  只按 Drafts 官方 Scripting API 写，没有实机跑过。第一次用请先拿一篇测试文稿，
  在 Beta 里确认出现后再删掉。
- **线上部署**：代码没推、`wrangler deploy` 也没跑。上面的 curl 是你部署后自己验的步骤。

---

## 八、边界

- 一次只发一篇；不做批量、不做双向同步、不回读 Beta 的修改到 Drafts。
- 图片：`[[image-…]]` 这类 Drafts 附件占位符会当成普通文字发过去，第一阶段不传图。
  正文里自己写 `![](https://img.hux.ink/...)` 是可以的，Beta 会照常渲染。
- 单设备本机最多留 30 篇草稿（`MAX_DRAFTS`，原有限制）。云端不受此限，
  换设备/清缓存后还能拉回来。
- 删掉的行永远占着那个 id。要让同一篇文稿重新进 Beta，在 Drafts 里「Duplicate」
  成新文稿（新 UUID）再发。
