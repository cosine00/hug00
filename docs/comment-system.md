# 评论系统（Cloudflare Workers + D1）操作手册

一套跑在 Cloudflare 边缘的自建评论系统，用来替换群晖上的 Twikoo。

- **后端**：Cloudflare Worker（单个 `fetch` 处理函数，无需服务器）
- **数据库**：Cloudflare D1（SQLite，免费额度内）
- **前端**：原生 JS + CSS，跟随 ivy 主题的四套配色
- **现状**：默认关闭，与 Twikoo 并行存在；Twikoo 的数据一个字节都没动

---

## 一、它解决了什么

### 1. 脱钩群晖

旧链路是 `博客 → https://i.hux.ink:2334/ → 群晖 NAS 上的 Twikoo 容器 → MongoDB`。
NAS 一关机、DDNS 一掉线、证书一过期，评论就全挂。

新链路是 `博客 → Cloudflare Worker → D1`，没有任何需要你自己维护的机器。

### 2. 哔哔终于有了独立链接

原来哔哔的评论锚点是一个**假 path**：

| | 旧（Twikoo） | 新 |
|---|---|---|
| 哔哔的评论归属 | `/memos/1233`（数据库存得下，浏览器打不开） | `memo:1233` |
| 哔哔的真实地址 | 不存在 | `/m/1233/` |
| 邮件/通知点进去 | 只能落到 `/bb/` 顶部，找不到是哪条 | 直达那条哔哔的评论区 |
| 列表页入口 | 无 | 每条哔哔底部右侧有「表情」+「气泡按钮（就地展开）」；点底部的时间即进单条页 |

`/m/1233/` 的实现是三段式的，缺一不可：

1. `vercel.json` 里 `rewrites` 把 `/m/:id` 内部指向 `/memo/`（地址栏仍显示 `/m/1233/`）
2. `layouts/_default/memo-single.html` 渲染一个空壳页面
3. `static/js/bb-comments.js` 从 `location.pathname` 取 id，去 `memos.json` 里找那一条，渲染出来并挂上评论区

再加一层兜底：`layouts/404.html` 检测到 `/m/数字/` 会自动跳 `/memo/?memo=id`，所以在**本地** `hugo server`（没有 rewrite 能力）里也能正常打开。

### 3. 评论归属规则

| 页面类型 | thread key | 例子 |
|---|---|---|
| 文章（路径在 `/posts/` 下） | `post:<相对路径>` | `post:/posts/hello-hugo/` |
| 哔哔 | `memo:<memo id>` | `memo:1233` |
| 其他独立页 | `page:<相对路径>` | `page:/about/` |

判断依据是**路径前缀**（`strings.HasPrefix .RelPermalink "/posts/"`），不是 Hugo 的 `.Kind`。

> ⚠️ 这里踩过一个坑：`.Kind` 对"文章"和"普通页面"都返回 `page`，早先按 `.Kind` 写 `post:` / `page:` 的分支，结果 `/about/` 被算成了 `post:/about/`。库里导入的 37 条是 `page:/about/`，两边对不上，评论区就显示成空的——而且更糟的是，新发的评论会被写进一个新出现的 `post:/about/` 线程，数据被劈成两半。

`worker/src/util.js` 的 `normalizeThreadKey()` 会兼容旧 Twikoo 的写法：`/memos/1233` → `memo:1233`，`/posts/hello-hugo/` → `post:/posts/hello-hugo/`，其余一律 `page:`。这是历史评论能对上号的前提。

### 4. 没有审核，写完就公开

**评论一旦提交就是公开的**，不存在待审核队列，也不存在"首访先审"。

之前用的是"首访先审"（这个邮箱没有已通过的评论就先压起来），现在整条链路都拆掉了：

- `createComment()` 一律写 `status = 'approved'`，`pending_token`、`firstTime` 都不再产生；
- 列表接口只查 `approved`，前端也没有「待审核」徽章、提示条和计数；
- 管理入口只剩「垃圾 / 删除」，没有「通过」——本来就没有什么要通过的。

邮箱仍然**必填**，但它现在只干两件事：取头像、接收回复提醒。

原来"首访先审"挡的东西，改由下面这套**自动拦截**接手（详见「八、反垃圾」）：蜜罐字段、2 秒脚本判定、30 秒 3 条的频率限制、同一内容 10 分钟内重复、关键词/链接打分达到阈值直接丢掉。机器人拿不到任何反馈，正常读者全程无感。

> 历史数据里如果有 `pending` 的评论，第一次请求会在建表流程里被统一放行（`settings` 表里的 `migrate:no-review` 标记只让它跑一次），不会因为去掉审核而永久消失。

### 5. 隐藏的管理入口

评论区右上角平时什么都没有。在**昵称框里输入暗号**（`config.toml` 的 `comments.adminNick`），「管理」按钮才会冒出来；点开再输入 Worker 的 `COMMENTS_ADMIN_TOKEN` 才算进入管理态。

页面源码里只出现暗号的 sha256（Hugo 构建时用 `crypto.SHA256` 算好），暗号原文不会被爬。真正的门禁仍然是那个口令。

### 6. 头像从哪来

填了邮箱的读者，按 **Cravatar → WeAvatar → Gravatar** 的顺序取（都是 Gravatar 协议，用邮箱的 MD5）。Cravatar 在国内可直连，且认 QQ 邮箱头像，所以绝大多数留言者会有图。

三级都取不到（或压根没填邮箱），就用**昵称首字的彩色圆**。字母头像永远垫在图片底下，所以网络慢的时候也不会出现空圈。

需要知道的一点：Cravatar 对**没有头像的邮箱**不会返回 404，而是回一张自动生成的图案（所以你会看到形状各异的色块）。这是它的默认行为，好处是每人都有图，坏处是和博客的素净风格不完全一致。

三种取法自己挑：

```toml
# 默认：Cravatar → WeAvatar → Gravatar → 昵称首字
# 只用某一个源
avatar = "https://cravatar.cn/avatar/"
# 一个外部请求都不发，全部用昵称首字（最统一）
avatar = "letter"
```

### 7. 字体跟着博客走

评论区所有元素 `font-family: inherit`，不写死字体。博客左上角的诗句点一下换字体（霞鹜文楷 / 朱雀仿宋 / 新致宋 / 霞鹜新晰黑），评论区同步变，不用刷新。

配色同理：全部取自主题的 CSS 变量（`--surface` / `--text` / `--border` / `--accent` / `--shadow` …），所以四套配色和深色模式都是自动适配，没有第二份色板要维护。

### 8. 排序

- 顶层评论：**按时间倒序**，最新的在最上面
- 楼中楼回复：按时间正序，对话顺着往下读
- 楼号按原始时间正序编，"1 楼"是最早那条（可能排在页面最下面）

### 9. 计数口径（页面上那个数字是怎么来的）

一句话：**数字只统计"已通过"的评论，回复也算一条；楼号只编顶层。**

| 显示位置 | 算法 | 例子 |
|---|---|---|
| 标题旁的"N 条评论" | 当前 thread 下 `status = 'approved'` 的全部记录（含楼中楼） | 2 个话题 + 3 条回复 = **5 条评论** |
| 悬停提示 | "含 X 个话题、Y 条回复" | 鼠标停在数字上就能看到拆分 |
| "N 楼" | 只对顶层评论按时间正序编号 | 楼中楼不占楼号 |
| 哔哔列表的小气泡 | `/api/comments/count` 同一口径（含回复） | 所以点进去看到的条数一定对得上 |
| 垃圾 / 已删除 | **不计数**，`status` 已改，查询条件里就排除了 | 数字不会因为删评论而"跳" |

为什么这么定：读者感知的是"这页有多少人在说话"，把回复排掉会显得冷清；而楼号是给人找位置的坐标，只对顶层编号才不会出现"3 楼回复 7 楼"这种混乱。两者分开算，谁也不将就谁。

计数是每次加载实时查的，没有缓存字段，所以不存在"评论删了数字不减"的问题。

### 10. 时间怎么显示

| 距今 | 显示 |
|---|---|
| < 1 分钟 | 刚刚 |
| < 1 小时 | N 分钟前 |
| < 24 小时 | N 小时前 |
| 7 天以内 | N 天前 |
| 超过 7 天 | 10月12日（跨年则 2025年10月12日） |

鼠标悬停显示完整时间（`2026-10-27 11:20`）。页面停留超过一分钟会自动刷新相对时间，不用手动刷新页面。

### 11. 身份标识有哪些

页面上只有一种徽章：

| 徽章 | 触发条件 | 说明 |
|---|---|---|
| **博主** | 提交时带着有效的 `x-admin-token`，**且邮箱等于 `COMMENTS_ADMIN_EMAIL`** | 两个条件同时满足才写 `is_admin = 1` |

**口令和邮箱各管一半，缺一不可。**

- 只有口令、邮箱随便填 → 不算博主，按普通访客走。这种情况前端会提示「邮箱不是博主邮箱，这条按普通访客存的」
- 只有邮箱、没有口令 → 不算博主，也不挂「博主」标（冒充者拿不到任何标识，也拿不到博主的删除权限）
- 两个都对 → 博主

早先的规则是「有口令就是博主」，结果进了管理模式以后随便填个昵称邮箱发出去也顶着「博主」标。现在不会了。

想以博主身份发言：先在昵称框敲暗号唤出「管理」按钮 → 输入口令解锁（口令缓存在当前浏览器），之后发评论前端会自动带上 `x-admin-token`。更要紧的是**邮箱格子也得填 `COMMENTS_ADMIN_EMAIL`**，否则同样按访客算。

### 11.1 管理模式 ≠ 记住口令

这两件事是分开的：

| | 存在哪 | 活多久 | 什么时候清 |
|---|---|---|---|
| 口令本身 | `localStorage.comments-admin-token` | 30 天 | 点「忘掉」，或过期 |
| 是否处于管理模式 | `sessionStorage.comments-admin-active` | 当前标签页 | 点「退出」，或关掉标签页 |

所以「退出」只是关掉模式（不再显示「垃圾 / 删除」按钮、不再自动带口令），**口令还记着**——下次再点「管理」直接就进去了，不用重输。

管理态里「管理中」旁边有个很轻的「忘掉」，是给公共电脑用的：连口令一起清掉，下次必须重输。

想以博主身份发言：先在昵称框敲暗号唤出「管理」按钮 → 输入口令解锁（口令缓存在当前浏览器），之后发评论前端会自动带上 `x-admin-token`。换浏览器/清了缓存就要重新解锁一次，那时这条评论就只是普通访客的留言。

早期的等级（新朋友 / 常客 / 老茶客 / 元老）已经不下发到页面，`levelFor()` 仍在 Worker 里留着，想恢复只要把 `badgeHtml()` 的分支加回去。

### 12. 就近回复、表情、删除确认

- **就近回复**：点某条评论的「回复」，输入框直接展开在这条评论正文下方（不是滚回页面顶部），支持 `Ctrl/⌘ + Enter` 发送。再点一次「回复」或点「取消」收起。回复框里同样是**昵称 / 邮箱 / 网址**三格，和顶部大表单一致，填过的会自动带出来。
- **记住身份**：昵称、邮箱、网址在**第一次发表成功后**存进 `localStorage`（键 `comments-identity`），此后无论主表单还是就近回复框都直接预填，换页面、关浏览器再回来都不用重输。清除浏览器站点数据后会重新填一次。回复框里改了身份，主表单会同步更新。
- **回复的 @ 昵称与正文同一行**：`@某某  内容`，中间只留一点间距，不再另起一段。整条都是代码块时才把 @ 单独放一行。
- **表情**：输入框左下角的 🙂，点开是 **48 个**常用 emoji（笑脸 / 搞怪 / 手势 / 氛围 / 自然 / 物件六类），插入到光标位置而不是简单追加，插入后还会 `dispatchEvent('input')` 让右下角字数提示同步。面板**贴在输入框正下方、在文档流里横向铺开**（`display:flex; flex-wrap:wrap`），不是绝对定位的浮层——所以它天然不会遮住下面的文字或评论，也不需要 `z-index`、上翻、抬升这些补丁。早期试过浮层方案，滚动到页面底部点回复框的表情时必翻车，换成文档流后这类问题整体消失。另外刻意避开了 🥹 🫠 🫡 🫶 这几个 Emoji 14 的新字形——Windows 的 Segoe UI Emoji 还没有，会显示成空白方框。
- **删除 / 标记垃圾要二次确认**：先点按钮 → 变成「确认 / 取消」，确认后才真正执行。删除顶层评论会连带隐藏它楼下的回复（软删除，记录仍在库里，可追溯）。
- **邮箱必填即代表订阅提醒**：不再有"有人回复时邮件通知我"的勾选框，留了邮箱就会收到回复提醒；不想收的话，博主在库里把该条的 `notify` 置 0 即可。邮箱格子的提示语写着「必填，不公开」，所以表单底部不再额外加一行说明文字。
- **外观与首页那 6 条哔哔条目一致**：不是"加一圈淡边框"，而是照搬它的真实观感——**背景透明、没有实心边框**，轮廓全靠 `0 1px 4px` 的柔和投影托出来，只有底边一条 `transparent → rgba(145,145,145,.2) → transparent` 的渐隐细线；圆角 12px。悬停时投影加深为 `0 10px 28px`、整体上浮 1px，0.18s 过渡（静止/悬停的投影数值与首页条目逐项相同，已用截图逐像素比对过）。

主表单的**内部排布照 Twikoo**：左边一枚头像，右边依次是「昵称 / 邮箱 / 网址」三格、大文本框、底部工具条。三格输入是"标签 + 输入"合在一格：左边 13px 的标签（`昵称`/`邮箱`/`网址`）带 `--cm-surface-soft` 淡底和一条竖分隔线，右边才是输入框本身，`必填 / 必填，不公开 / 选填` 作为 placeholder；聚焦时整格描边转主题色并加一圈柔光。Twikoo 原版还有插图按钮和 MD 按钮，这里**没做**（插图走哔哔正文，Markdown 直接手写）。

**左边那枚头像是活的**：没填身份时是灰色人形（`USER_ICON`），敲了昵称就换成首字母头像（`fallbackAvatar()` 同一套配色），邮箱填成合法格式后前端用 `md5Hex()` 算出哈希（与服务端 `email_hash` 同一份 md5），按评论列表同一套来源（cravatar → weavatar）拉真头像盖上去，`d=404` 没有就摘掉图片露出首字母。输入事件有 320ms 防抖，不会每敲一个字符就打一次网络请求。

**字数上限 500**：textarea `maxlength=500`，右下角 `.cm-counter` 显示 `当前/500`（`pointer-events:none`，让开右下角缩放把手，右偏 16px）；写了字之后才垫一层 `--cm-surface` 薄底，免得最后一行文字从数字底下穿过去。粘贴/脚本赋值越过 500 时前端会截断，服务端 `validateCommentInput` 也按住同一条线，超了返回 `content_too_long`（不静默截断）。

### 13. 提示气泡（药丸样式）

原生 `title` 弹出的方角系统气泡和博客不搭，所以评论区里所有提示都换成**药丸气泡**：999px 全圆角、1px 主题色微边框、`surface 92%` 半透 + 背景模糊、`0 6px 18px` 极轻投影、`600 11px` 字重——参数直接照 `custom.css` 里 `palette-trigger` / `back-to-top` 的 `control-tooltip`。

用法是给元素加 `data-tip="..."`，不要再用 `title`。全站共用一个 `.cm-tip` 节点（挂在 `body`、`position: fixed`），事件走 document 委托，所以列表重绘后不用重新绑定；上方空间不够时自动翻到下方，左右两侧也会夹到视口内。悬停到边界、点击、页面滚动都会自动收起。

已经用上的地方：阅读量、点赞（点赞后文案变「取消点赞」）、「N 条评论」（显示「含 N 个话题、M 条回复」）、每条评论的时间（显示完整时间）、表情按钮、哔哔列表的评论气泡（显示「N 条评论 / 还没有评论，来说一句」）、哔哔的时间（显示完整日期）。

### 14. 首页哔哔条目的底部布局

首页那 6 条哔哔（`static/js/bb-home.js` 渲染）的底排现在是：

```
[时间] [标签] [置顶]                                  [已有表情] [表情按钮] [评论按钮]
```

- **表情整体挪到右下角**，位置在评论按钮前面；已有表情计数排在表情按钮左侧（`emaction.js` 里把「reactions got」那段挪到了笑脸按钮前面）。
- **右下角的独立链接图标已去掉**，能力并进了时间：时间本身是 `<a href="/m/<id>/">`，点一下就去那条哔哔的单页（`vercel.json` 里的 `/m/:id` rewrite 兜住）。悬停时时间变主题色并浮出一条点状下划线，暗示可点。
- 右侧这一组由 `bb-comments.js` 注入的评论气泡（`.cm-pill`）收在同一行，`margin-left: auto` 顶到右边。

### 15. 阅读量与点赞

和评论同一个 Worker、同一个 D1，没有引入 KV。

```bash
# 记一次阅读（同一 session 只记一次）
curl -X POST http://localhost:8787/api/comments/view \
  -H "Content-Type: application/json" \
  -d '{"threadKey":"memo:1233","session":"sess-a","visitor":"vis-a"}'

# 点赞 / 取消
curl -X POST http://localhost:8787/api/comments/like \
  -H "Content-Type: application/json" \
  -d '{"threadKey":"memo:1233","visitor":"vis-a","action":"like"}'

# 批量查统计
curl "http://localhost:8787/api/comments/stats?threads=memo:1233&v=vis-a"
```

**去重口径**（宁要真实，不要好看）：

| 项目 | 规则 | 防的是什么 |
|---|---|---|
| 阅读量 | 前端把 session id 放 `sessionStorage`：同一标签页刷新不变，等于"一次会话一次" | 自己刷新页面把数字刷上去 |
| 阅读量（服务端兜底） | `view_sessions` 表主键 `(thread_key, session_hash)`，`INSERT OR IGNORE` | 前端被改、脚本狂刷 |
| 点赞 | `likes` 表主键 `(thread_key, visitor_hash)`，一个浏览器一篇一票，可取消 | 连着点加数 |

标识都是随机串，服务端只用 `COMMENTS_SALT` 加盐哈希后落库，原文不存。会话记录保留 30 天，过期后同一个人再来会重新算一次阅读（相当于"月活"，不是"浏览量"）。

数据表：`thread_stats`（每篇的 views/likes 汇总）、`view_sessions`、`likes`。都在 `worker/schema.sql` 里，Worker 首次请求会自动建。

### 16. 分页与楼中楼折叠

**分页**：默认每页 **10 楼**，超过一页才出现分页条（`上一页 / 页码 / 下一页 / 第 x / y 页`），页码超过 7 页时中间折叠成 `…`。

- 切页切的是**顶层评论**（"楼"），楼中楼整串跟着它走，永远不会被页码拆散
- 翻页后自动滚回列表顶部，不然会停在半空
- 新评论发表成功后**自动跳回第 1 页**，否则用户发完看不见自己那条
- 页大小可以用 `data-cm-page-size` 覆盖（默认 10），`options.pageSize` 也认
- 页数变化时会自动 clamp（比如在最后一页删光了评论，页码收回有效范围）
- **锚点定位**：`#cm-c-<id>` 指向的评论如果不在当前页，会先算出它属于第几楼、翻到那一页再滚动高亮；页内改 hash（`hashchange`）也认，不只是整页新开

**楼中楼折叠**：某一楼的回复超过 **5 条**时，先只显示前 5 条，尾巴上挂一枚 `▾ 展开另外 N 条回复`；展开后变成 `▴ 收起回复`。

- 展开/收起是**就地重画那一小段**（`#cm-c-<rootId> > .cm-body > .cm-children`），不是整页重排，避免上面内容高度变化把视野顶跑
- 收起后会把这一楼滚回视野中心，不让人对着空出来的一片
- 折叠状态按顶层 id 记在 `state.expanded`，翻页来回切不会丢

实测（23 楼的 `/about/`）：第 1 页 10 楼、第 2 页 10 楼、第 3 页 3 楼；单楼挂 8 条回复时默认显示 5 条 + `展开另外 3 条回复`。

### 17. 改错别字

有条评论写错了字，不用删了重发——条目右上角有「编辑」，点开正文原地变成一个 textarea，改完「保存」当场生效，不跳页。

谁能改：

| 谁 | 能改什么 | 凭据 |
|---|---|---|
| 博主（管理模式） | 任何一条，包括自己发的 | `x-admin-token` |
| 留言者本人 | 自己 **1 分钟内**发的 | 发表时服务端回的 `editToken`，存在本地 `localStorage.comments-edit-tokens`，只回给提交人，不进公开列表 |

超过 1 分钟，本人就不能改了（服务端按 `created_at` 判，返回 `edit_window_closed`）——想改得找博主。博主没有时间限制。

**博主署名的评论不认 `editToken`。** 服务端遇到 `is_admin = 1` 的评论会直接返回 `admin_only`，前端也不给按钮。原因是那条 `editToken` 存在浏览器里，退出管理模式后仍然活着——不拦住的话，随便谁拿到那台电脑就能改博主写的东西。想改自己漏的字，先进管理模式。

细节：

- 快捷键 `Ctrl/⌘ + Enter` 保存，`Esc` 取消
- 改完正文，楼中楼关系、楼层号、时间都不动
- 迁进来的历史评论没有 `edit_token`，只有博主能改
- 内容长度、空内容都在服务端再校验一次（和发评论同一套上限 500 字）

> 如果哪天觉得阅读量统计太粗，想换成"IP + 天"去重，只改 `recordView()` 里那一个哈希的构成即可，表结构不用动。

### 18. 网址字段：自动补协议

留言时填的「网址」会变成昵称上的链接。这个字段从 Twikoo 迁过来的数据里有一大半是**裸域名**——`hux.ink`、`www.hux.ink`、`lillianwho.com`。裸域名直接写进 `<a href>` 会被浏览器当成**相对路径**，点一下不是去外站，而是跳到当前页面下面：

```
当前页 https://hux.ink/about/
href="hux.ink"   →  https://hux.ink/about/hux.ink   ✗
href="https://hux.ink"  →  https://hux.ink          ✓
```

同一份数据里两种写法并存时，表现就是「这条昵称点了能跳、那条点了 404」，看着像随机的。

两层兜底：

1. **写入时**：`normalizeWebsite()`（`worker/src/util.js`）在存库前补 `https://`。既管公开发言，也管 Twikoo 导入。危险协议（`javascript:`、`data:`）原样留下，交给 `URL_RE` 报 `website_invalid`，不静默吞掉。
2. **渲染时**：`linkHref()`（`static/js/comments.js`）再补一次，只放行 `http/https`。这一步是为了兜住历史脏数据——库里 30 多条旧记录已经批量修过一遍，但保不齐哪天又导进来一批。

前端表单的网址框也放宽了：填 `hux.ink` 就行，不用自己敲 `https://`。

---

## 二、文件清单

```
wrangler.toml                    Worker 配置（D1 绑定、环境变量）
worker/
  schema.sql                     D1 建表脚本
  src/index.js                   Worker 入口 + 路由 + CORS
  src/service.js                 业务逻辑（列表/写入/反垃圾/导入导出/Twikoo 转换）
  src/db.js                      D1 适配层
  src/util.js                    校验、MD5/SHA256、UA 解析、地区、反垃圾
  src/mail.js                    Resend 邮件通知（可选）

static/js/comments.js            评论组件（含药丸提示气泡、48 个 emoji 面板）
static/js/bb-comments.js         哔哔列表/单条页的评论入口与渲染
static/js/bb-home.js             首页/列表页的哔哔渲染（底排布局在这里）
static/js/emaction.js            表情组件（第三方；为「已有表情排在笑脸左边」动过一
                                 处模板顺序，从上游重新下载会被覆盖，记得再改一次）
static/css/comments.css          评论组件样式
static/admin/comments.html       管理后台（删除/标垃圾/看全部/数据迁移面板）
layouts/partials/comments.html   评论容器（主题同名 partial 的项目级覆盖）
layouts/partials/comments/api.html       API 地址解析
layouts/partials/comments/enabled.html   开关判断
layouts/partials/comments/admin-hash.html 管理暗号的 sha256（原文不出现在页面里）
layouts/partials/comments/avatar.html    自定义头像源（可选）
layouts/_default/memo-single.html        /m/:id 单条哔哔页
layouts/404.html                 /m/:id 的本地兜底跳转
content/memo.md                  /memo/ 这个"壳页面"
vercel.json                      /m/:id 的 rewrite（博客本身还在 Vercel）
scripts/import-twikoo.mjs        Twikoo 历史评论迁移
scripts/comments-export.mjs      备份导出
```

---

## 三、本地调试（先做这一步，不碰线上任何东西）

### 1. 准备

需要 Node 20+（`node -v` 确认）。

```bash
cd E:/SynologyDrive/hug00
npm install
```

### 2. 建本地数据库

本地 D1 是 miniflare 模拟的，数据落在 `.wrangler/state/`，和线上完全隔离。

```bash
npx wrangler d1 execute comments --local --file=worker/schema.sql
```

看到几条 `"success": true` 就成了。

### 3. 准备本地口令

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 默认内容是 `COMMENTS_ADMIN_TOKEN = "devtoken"`。这个文件已在 `.gitignore` 里，不会被提交。

### 4. 起两个终端

**终端 A —— 评论 API**

```bash
npm run comments:dev
```

看到 `Ready on http://127.0.0.1:8787` 即成功。它支持热重载，改 `worker/src/*.js` 会自动重启。

**终端 B —— 博客**

```bash
hugo server
```

`hugo server` 会自动启用新评论系统（不需要改任何配置），API 地址自动指向 `http://localhost:8787/api/comments`。

### 5. 检查这些页面

| 地址 | 应该看到 |
|---|---|
| http://localhost:1313/bb/ | 每条哔哔底部右侧有表情和气泡按钮，有评论的显示数字；点时间是单条页 |
| http://localhost:1313/m/1233/ | 单条哔哔 + 评论区 |
| http://localhost:1313/posts/hello-hugo/ | 文章底部评论区 |
| http://localhost:1313/admin/comments.html | 管理后台（API 填 `http://localhost:8787/api/comments`，口令 `devtoken`） |

### 6. 命令行自检

```bash
# 健康检查
curl http://localhost:8787/api/health

# 发一条评论
curl -X POST http://localhost:8787/api/comments \
  -H "Content-Type: application/json" \
  -d '{"threadKey":"memo:1233","nick":"测试","email":"t@example.com","content":"本地测试一条","elapsed":5000}'

# 看评论列表
curl "http://localhost:8787/api/comments?thread=memo:1233"

# 改一条评论（带 editToken 改自己的，或者带管理口令改任意条）
curl -X POST http://localhost:8787/api/comments/edit \
  -H "Content-Type: application/json" \
  -H "x-admin-token: devtoken" \
  -d '{"id":1,"content":"改过之后的正文"}'

# 评论计数
curl "http://localhost:8787/api/comments/count?threads=memo:1233,post:/posts/hello-hugo/"

# 阅读量（同一 session 重复调用，第二次 counted=false，数字不涨）
curl -X POST http://localhost:8787/api/comments/view \
  -H "Content-Type: application/json" \
  -d '{"threadKey":"memo:1233","session":"sess-a","visitor":"vis-a"}'

# 点赞
curl -X POST http://localhost:8787/api/comments/like \
  -H "Content-Type: application/json" \
  -d '{"threadKey":"memo:1233","visitor":"vis-a","action":"like"}'
```

> **坑**：别同时跑 `hugo`（构建）和 `hugo server`。两者共用 `public/`，`hugo` 一构建就把目录换成"生产版"（评论开关是关的），`hugo server` 还在读这份产物，评论区会凭空消失。重启 `hugo server` 即可恢复。

### 7. 想清空本地测试数据

```bash
rm -rf .wrangler/state
npx wrangler d1 execute comments --local --file=worker/schema.sql
```

---

## 四、上线（由你决定什么时候做）

### 第 1 步：注册 Cloudflare

去 https://dash.cloudflare.com/sign-up 注册（免费，不用绑卡），然后本地登录：

```bash
npx wrangler login
```

浏览器会弹授权页，点 Allow。

### 第 2 步：建 D1 数据库

```bash
npx wrangler d1 create comments
```

输出里有 `database_id = "xxxxxxxx-xxxx-..."`，**复制这个值**。

### 第 3 步：把 id 填进 `wrangler.toml`

```toml
[[d1_databases]]
binding = "DB"
database_name = "comments"
database_id = "你刚才复制的 id"
```

> 本地开发用的是占位 id，不填也能跑；但 `deploy` 前必须换成真的，否则部署会失败。

### 第 4 步：在线上建表

```bash
npx wrangler d1 execute comments --remote --file=worker/schema.sql
```

### 第 5 步：设置管理口令

```bash
npx wrangler secret put COMMENTS_ADMIN_TOKEN
```

终端会提示输入，自己编一串长的（比如 32 位随机字符），**记在自己的密码管理器里**。这个口令用来登录管理后台。

**这道口令到底存在哪、怎么改：**

| 东西 | 存在哪 | 作用 | 怎么改 |
|---|---|---|---|
| 暗号昵称 | `config.toml` → `params.comments.adminNick` | 在评论框昵称里输入它，才冒出「管理」按钮 | 改完重新部署博客（Hugo 会重算 sha256） |
| 管理口令 | Cloudflare Worker 的加密环境变量 `COMMENTS_ADMIN_TOKEN` | 真正的门禁，服务端逐字节比对 | `npx wrangler secret put COMMENTS_ADMIN_TOKEN` 覆盖，立刻生效 |
| 登录状态 | 访客自己浏览器的 `localStorage` | 30 天内免输；换了浏览器就要重新输 | 页面里点「退出」，或清站点数据 |

口令不会进 git（`.dev.vars` 已在 `.gitignore` 里），也不会出现在任何前端文件里——前端只拿到暗号的哈希，输完口令是发给 Worker 校验的。

本地开发用的是 `.dev.vars` 里的 `COMMENTS_ADMIN_TOKEN`（示例是 `devtoken`）；线上以 `wrangler secret` 为准，两者互不影响。

### 第 6 步：部署

```bash
npx wrangler deploy
```

成功后会打印一个地址，形如：

```
https://comments.<你的账号子域>.workers.dev
```

先验证：

```bash
curl https://comments.<你的账号子域>.workers.dev/api/health
# {"ok":true,"service":"comments","runtime":"cloudflare-worker","hasDb":true,...}
```

### 第 7 步：给它一个自己的域名（强烈建议）

`*.workers.dev` 在国内的连通性时好时坏，读者打不开就等于评论系统坏了。

如果你的 `hux.ink` 的 DNS 已经托管在 Cloudflare：

1. Cloudflare Dashboard → **Workers & Pages** → 点 `comments`
2. **Settings** → **Domains & Routes** → **Add** → **Custom domain**
3. 填 `comments.hux.ink` → 保存

Cloudflare 会自动加 DNS 记录并签发证书，一两分钟生效。

验证：

```bash
curl https://comments.hux.ink/api/health
```

如果 `hux.ink` 的 DNS 不在 Cloudflare（比如还在域名注册商或 DNSPod），两个选择：

- **A（推荐）**：把 `hux.ink` 的 NS 改到 Cloudflare。免费，且顺手能用上 CF 的 CDN
- **B**：先继续用 `xxx.workers.dev`，接受国内偶尔连不上

### 第 8 步：改配置打开开关

`config.toml`：

```toml
[params.comments]
	enable = true
	api = "https://comments.hux.ink/api/comments"
	localApi = "http://localhost:8787/api/comments"
	adminNick = "hux-keeper"          # 管理入口暗号，随时可改
	# avatar = "https://cravatar.cn/avatar/"   # 头像源，可选
```

> 改 `adminNick` 就等于换暗号，推送后生效。它只是"敲门砖"，不是密码；
> 口令是 Worker 里的 `COMMENTS_ADMIN_TOKEN`，两者独立。

同时把 CORS 收紧。`wrangler.toml`：

```toml
[vars]
COMMENTS_ALLOWED_ORIGIN = "https://hux.ink"
```

改完重新部署：

```bash
npx wrangler deploy
```

然后推送博客：

```bash
git add -A
git commit -m "启用新的评论系统（Cloudflare Workers + D1）"
git push
```

Vercel 会自动构建。构建完打开任意文章页，评论区应该就是新的了。

### 第 9 步：上线后逐项验收

- [ ] 文章页能看到评论区，历史评论正常显示
- [ ] 在文章页发一条评论，刷新后还在
- [ ] 点「回复」，提交后能看到嵌套 + `@昵称`
- [ ] 解锁管理口令后留言 → 显示「博主」徽章
- [ ] 不输口令、只把邮箱填成 `me@hux.ink` 留言 → **没有**博主徽章，评论照常公开（冒充者拿不到标识）
- [ ] 用一个新邮箱留言 → **立刻出现在列表里**，没有任何"待审核"提示
- [ ] 连发 4 条 → 第 4 条被挡住（429「发言太快了」）
- [ ] 昵称框输入暗号 → 出现「管理」按钮 → 输入口令 → 那条评论下方出现「垃圾 / 删除」
- [ ] 评论区字体与博客正文一致，点左上角诗句换字体后评论区跟着变
- [ ] 打开 `/bb/`，每条哔哔底部的气泡按钮显示正确计数
- [ ] 点某条哔哔的时间，进到 `/m/:id/` 且评论区对得上
- [ ] 手机浏览器打开同样几个页面
- [ ] 管理后台能登录、能删、能标垃圾

### 第 10 步：切换期的两件小事

1. **公告**：可以在哔哔里说一声"评论系统换了，旧评论稍后迁过来"
2. **Twikoo 先别拆**：让新系统跑一两周，确认稳定再关群晖上的容器。回滚成本几乎为零（见下一节）

---

## 五、开关与回滚

**回滚只要一分钟**：把 `config.toml` 里 `params.comments.enable` 改回 `false`，推送。文章页立刻回到 Twikoo，历史评论都在群晖的 MongoDB 里，没被碰过。

也可以反过来：`params.comments.enable = true` 但 `params.twikoo.enable = true` 同时开着——**同时开启时优先新系统**，Twikoo 不加载。

---

## 六、数据迁移：和 Twikoo 双向互通

**设计前提：这套系统必须能随时退回去。** 所以导出文件不是"自家备份"，而是**直接能被 Twikoo 管理面板吃进去**的格式。哪天真不想要了，导出一份 JSON 丢回 Twikoo，评论、楼中楼关系、博主身份、阅读量全在。

### 1. 入口

管理后台 → 「数据迁移」面板（`/admin/comments.html` 底部），三个按钮：

| 按钮 | 打到的接口 | 产出 |
| --- | --- | --- |
| 导出 Twikoo 格式 | `GET /admin/export?format=twikoo` | `comment-YYYY-MM-DD.json` + `counter-YYYY-MM-DD.json`，即 Twikoo 的两个标准文件 |
| 导出原始备份 | `GET /admin/export` | 单文件，本系统的原始字段（排查问题用） |
| 选择文件导入 | `POST /admin/import` | 自动识别是 Twikoo 格式还是原始格式 |

导入是**前端分批**的：一次选 1150 条，页面按 50 条一批串行 POST，进度条实时打印在面板里。整批 150 条一次发会撞 Worker 的请求体/CPU 上限返回 500，所以别拆成大批。

### 2. 字段映射

| Twikoo | 本系统 | 说明 |
| --- | --- | --- |
| `_id`（32 位 hex） | `comments.id` / 导出时派生 | 导出用 `md5('hux-comment-' + id)` 生成，**同样一条评论每次导出的 `_id` 都一样**，回导 Twikoo 不会错位 |
| `pid` / `rid` | `parent_id` / `root_id` | 楼中楼层级完整还原 |
| `comment`（HTML） | `content`（Markdown） | 导入时 `htmlToText()`，导出时 `textToHtml()` |
| `url` / `href` | `thread_key` | `post:/posts/x/`、`memo:1232`、`page:/about/` 三种 key 互相归一化 |
| `created`（毫秒） | `created_at`（秒） | 时间原样保留 |
| `mailMd5` | 由 `email` 现算 | 邮箱本身不入 HTML，导出时重新算 md5 |
| `master` | `is_admin` | 博主身份保留 |
| `counter[].time` | `thread_stats.views` | 导入取 `max`，**不会把已有阅读量改小** |

### 3. 幂等（重要）

导入端按 `(thread_key, created_at, nick, content)` 判重，还带 `options.dedupe` 开关。所以：

- **同一个文件导入两遍是安全的**，第二遍全部走 `skipped`，不会翻倍
- 往返测试（导出 → 再导入）结果 `imported 0 / skipped 26`，说明 key 归一化和 `_id` 派生都稳
- 本地全量验证：1150 条 Twikoo 评论端到端导入耗时 **40.4 秒**

线程 key 归一化是幂等的地基，`normalizeThreadKey()` 认得这些写法：

```
/posts/xxx/            → post:/posts/xxx/
https://hux.ink/posts/xxx/  → post:/posts/xxx/     （绝对地址先剥 path）
/posts/watermelon      → post:/posts/watermelon/   （补结尾斜杠）
/posts/posts/easy-go/  → post:/posts/easy-go/      （早年拼错的双层前缀）
/m/1233/               → memo:1233
/memos/1233            → memo:1233
```

### 3.1 楼层为什么会被挂错（已修，记一笔）

第一版导入有 476 条回复挂错了楼：有的变成了独立评论，有的 @ 到了另一个人头上。三个原因叠在一起：

**（1）`Number()` 化了 hex 主键。** Twikoo 的 `_id` 是 32 位 hex 字符串，代码里用 `Number(oldId)` 当 Map 的键，`Number('f479549b…')` 是 `NaN`——**所有 id 塌缩成同一个 `NaN` 键**，于是每条回复的父级都指向"最后导入的那一条"。改成一律用字符串当键。排序也一并改了：不再按 id 排，按 `createdAt` 升序（回复一定晚于被回复的那条），保证父评论先落库。

**（2）分批提交跨不过批次。** 管理页按 50 条一批串行 POST，内存里的 `idMap` 每批清零，父评论在上一批的话就接不上，回复只能当新评论。现在每条评论都留 `legacy_id`（老系统的 `_id`）和 `parent_legacy_id`，父级找不到时直接查库，跨批次也能接。

**（3）Twikoo 导出的顺序不是按时间排的。** 父评论完全可能出现在子评论后面好几批。光靠"先父后子"的排序救不回来，所以每批收尾都跑一次 `relinkFamilies()`：按 `parent_legacy_id` 把还没接上或接错的条目重挂一遍，再把 `root_id` 顺着父级带正。已经对了就是空操作，跑多少遍都一样。

顺带的好处：**重复导入同一份 JSON 不只是"不重复"，还能自动纠正以前挂错的楼层**。这轮就是这么把 259 条错位修回来的。

验证方式（值得每次改导入逻辑后跑一遍）：拿导出的 JSON 逐条比对 `_id` 的 `pid` 与库里的 `parent_id` 指向的 `legacy_id` 是否一致。修完的结果是 **476/476 全对**。

### 3.2 三种不规范的 url

老 Twikoo 里混着三种写法，归一化没管的话同一篇文章会被拆成两三个线程（评论"凭空少了一半"）：`/posts/watermelon`（少结尾斜杠）、`/posts/posts/easy-go/`（前缀双层）、`//posts/xxx/`（多一根斜杠）。`normalizeThreadKey()` 现在统一抹平，然后 `COLLATE`/`LIKE` 都只认一种写法。

### 4. 注意

- 迁移保留**原始时间**和**博主身份**，走的是管理员接口，不经过公开提交口
- Twikoo 里标了垃圾的评论以 `spam` 状态导入，前台不显示、后台可见
- `htmlToText()` 处理了 `<pre>` / `<code>` / `<strong>` / 实体转义，代码块前后的内容不会被吞（早期 bug：`<pre>` 和 `<code>` 共用占位符导致串味）
- 命令行脚本 `scripts/import-twikoo.mjs` 仍在，适合无头环境；日常用管理页那个面板就行

---

## 七、管理后台

有两个入口，随你用哪个：

**A. 评论区里就地处理**（日常最省事）
昵称框输入暗号 → 点「管理」→ 输口令。之后当前页面每条评论底下都有「垃圾 / 删除」按钮（要二次确认），处理完即时刷新。登录态存在 sessionStorage，关掉标签页即失效。

**B. 独立后台页面**（要批量看、按页面筛、彻底删除时用）
地址：`https://hux.ink/admin/comments.html`

- API 地址填 `https://comments.hux.ink/api/comments`
- 口令填 `COMMENTS_ADMIN_TOKEN`
- 两者都存在浏览器 localStorage，下次不用重填
- 支持：已通过 / 垃圾 / 已删除 / 全部，按 thread key 过滤，标记垃圾、软删除、彻底删除

> 后台页面本身是静态 HTML，登录态靠口令校验，服务端不存 session。所以**别把口令写进任何公开文件**。

---

## 八、反垃圾

全部在 `worker/src/service.js` + `util.js` 里，无需配置：

没有审核队列，所以这几条是**唯一的防线**——它们全部"失败得悄无声息"：机器人拿到的是和成功一样的响应，拿不到任何可以调参的反馈。

| 手段 | 行为 |
|---|---|
| 蜜罐字段 | 隐藏输入框被填写 → 假装成功，不落库 |
| 提交耗时 | 打开页面 < 2 秒就提交 → 假装成功，不落库 |
| 频率限制（短） | 同一 IP 30 秒内最多 3 条，超了返回 429「发言太快了，歇一会儿再来吧」 |
| 频率限制（长） | 同一 IP 1 小时内最多 10 条，超了返回 429「这一小时说得够多了，喝口水再来吧」 |
| 重复内容 | 同一页面 10 分钟内相同内容 → 拒绝 |
| 关键词打分 | 赌博/发票/加微信等 → 分数 ≥5 **直接丢掉**（以前是进待审核） |
| 链接密度 | 3 个以上链接 / 纯英文长文 / 重复字符 → 加分 |

阈值都在 `service.js` 开头：`RATE_WINDOW_SECONDS` / `RATE_MAX_IN_WINDOW` / `RATE_HOUR_WINDOW_SECONDS` / `RATE_MAX_PER_HOUR` / `SPAM_DROP_SCORE`。觉得慢速刷屏还能钻空子，就把 `RATE_MAX_PER_HOUR` 再调小一点。

真漏进来的垃圾也不难处理：进管理模式，那条评论底下有「垃圾 / 删除」，点一下就没了（软删除，记录还在库里）。

---

## 九、邮件通知（可选）

不配也能正常用，只是收不到提醒。

1. 注册 https://resend.com，拿到 API Key
2. 给它加 `hux.ink` 域名并配置 SPF/DKIM 记录
3. 设两个 secret：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put COMMENTS_MAIL_FROM   # 例如：博客评论 <comment@hux.ink>
```

`COMMENTS_ADMIN_EMAIL` 已经在 `wrangler.toml` 的 `[vars]` 里，改成你的邮箱即可。它现在只做两件事：接收新评论通知、迁移时识别哪几条是老博主——**不再用来判定博主身份**（身份只认 `COMMENTS_ADMIN_TOKEN`）。

通知逻辑：新评论发给站长；回复发给被回复的人（**前提是对方当初勾了「有人回复时邮件通知我」**，且不是自己回自己）。

---

## 十、数据备份

```bash
node scripts/comments-export.mjs \
  --api https://comments.hux.ink/api/comments \
  --token <口令> \
  --out comments-backup.json
```

建议丢进群晖的定时任务里每月跑一次（群晖反正还要留着当文件服务器）。

也可以直接用 wrangler 导出 SQLite：

```bash
npx wrangler d1 export comments --remote --output comments-backup.sql
```

---

## 十一、额度

Cloudflare 免费计划（够一个个人博客用很久）：

- **Workers**：10 万请求/天，单请求 CPU 10ms
- **D1**：5 GB 存储，500 万行读/天，10 万行写/天

按每天几百次页面访问算，用不到 1%。具体数字以 Cloudflare 官网为准。

---

## 十二、排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面完全没有评论区 | `params.comments.enable` 还是 false，或 Vercel 没重新构建 | 改配置 → push，等构建完成；确认 `git log` 里那次提交 |
| 评论区一直「加载中」 | API 地址错 / Worker 没部署 | 浏览器 F12 看 Network，`/api/comments` 是否 404 或 CORS 报错 |
| `db_not_initialized` | 线上没建表 | `npx wrangler d1 execute comments --remote --file=worker/schema.sql` |
| `需要管理口令` | 口令填错，或 secret 没设 | `npx wrangler secret put COMMENTS_ADMIN_TOKEN` 重设 |
| CORS 报错 | `COMMENTS_ALLOWED_ORIGIN` 不含博客域名 | 改成 `https://hux.ink` 后重新 deploy |
| `/m/1233/` 打开 404 | `vercel.json` 的 rewrite 没生效 | 确认 `vercel.json` 已提交，Vercel 重新部署 |
| 哔哔评论计数一直是 0 | `bbComments.api` 没注入 | 看 `/bb/` 源码里有没有 `window.bbComments`；检查 `params.comments.enable` |
| 本地打开 `/m/1233/` 是 404 但内容正常 | Vercel 的 rewrite 本地没有 | 正常现象，靠 `404.html` 兜底跳转，线上是 200 |
| 提交评论提示"发言太快" | 频率限制（30 秒 3 条） | 等一会儿；调试时清空 `.wrangler/state` 重来 |
| 头像是空白圆圈 | gravatar/cravatar 无此邮箱头像，回落成首字母 | 正常行为 |
| 控制台有 `cravatar` 的 404 | 邮箱没注册头像，`d=404` 触发兜底 | 正常行为，不影响功能 |

---

## 十三、为什么是 Worker + D1

这个方案是被你指定的，说几个事实供参考，方便你判断上线时机：

**优点**
- 没有服务器要维护，和"脱钩群晖"的目的一致
- D1 是 SQLite，schema、SQL、迁移脚本都很直接
- Cloudflare 免费额度对个人博客绰绰有余
- Worker 冷启动极快（通常毫秒级），比 Twikoo 的容器方案体验好
- 一套代码本地就能跑（wrangler 用 miniflare 模拟 D1），改完立刻验证

**需要注意**
- `*.workers.dev` 域名在国内可达性不稳定 → 务必绑自定义域（第 7 步）
- Worker 只能在 Cloudflare 上跑，不像 Node 那样能随便换宿主
- 邮件通知依赖 Resend，要额外配 SPF/DKIM

**和 Twikoo 的区别**
- Twikoo 是"一个容器 + MongoDB"，你已经有现成的；新系统是"零运维 + 托管数据库"
- Twikoo 的哔哔无法定位（假 path 问题）；新系统给了真实 URL
- Twikoo 的管理面板功能更全（表情、图片上传等）；新系统只做了必要的删除和垃圾标记（评论不审核，写完即公开）

---

## 十四、设计说明：几个刻意的选择

**为什么 ID 用自增而不是 UUID**
D1 的自增 ID 在单库内稳定，楼层号、`@回复`、深链接都用它，比 UUID 好读。代价是不能合并多个库——个人博客不需要。

**为什么回复只保留两层**
无限嵌套在手机上会挤成一列窄条。现在"回复的回复"会自动拍平到顶层评论下，但 `@昵称` 会指出真正被回复的人。这也是大多数博客评论区的做法。

**为什么邮箱只存哈希 + 明文**
- `email_hash`（MD5）：给 gravatar/cravatar 拼头像 URL，也给前端算"常客/元老"等级
- `email`（明文）：只有回复通知需要。它**永远不返回给前端**（`serialize()` 里没有这个字段）

**为什么地区用 Cloudflare 的 `request.cf`**
Worker 天然能拿到访问者的国家/城市，不依赖第三方 IP 库。中文访问者会因为 `Accept-Language` 拿到本地化的城市名。

**为什么评论列表一次全取**
单页上限 500 条，一次取完比分页简单，也避免"回复在第二页找不到父评论"的问题。到了这个量级该考虑的是分页或者归档，而不是优化这次查询。
