# 博客独立撰写发布页 `/beta/` —— 需求与实现说明（审计稿）

> 注：页面地址 2026-11-17 由 `/write/` 改为 `/beta/`（中间短暂用过 `/update/`），旧目录都已删除，`/write`、`/update` 由 `vercel.json` 的 redirect 307 转到 `/beta/`。下文出现的 `/api/write/*` 是接口路径，没有跟着改。

> 用途：交给第三方助手做代码/设计审计与校对。
> 仓库：`cosine00/hug00`（Hugo 静态站 + Cloudflare Worker）
> 线上：<https://hux.ink/beta/>（前端） / `https://comments.hux.ink`（API）
> 整理时间：2026-11-17，对应提交 `9517d1f`

---

## 0. 怎么读这份文档

- 第 1–2 节是**需求**（用户原话 + 我理解的验收标准）。
- 第 3–6 节是**实现路径**（架构、接口、数据结构、关键算法）。
- 第 7 节是**已知限制与风险**，按严重度分级，请重点看这里。
- 第 8 节是**已做过的验证**，第 9 节是**希望你重点核查的问题**。
- 如果你发现「文档描述」与「代码实际行为」不一致，以代码为准，并请指出。

---

## 1. 背景与目标

博客原来只有一个 `admin` 后台页，功能很全（文章、评论、友链、豆瓣同步等），但对「写一篇文章」这个动作来说太重，移动端尤其难用。

目标是**另起一个独立页面**，只做三件事：写文章、传图、发布。要求：

- 不动现有 admin 页面（不能改坏它）；
- 桌面可用，但**移动端（iPhone）优先**，体验接近原生 App；
- 适配 iOS 27，能「添加到主屏幕」当 webapp 用；
- 技术上不能把 GitHub 写权限放到浏览器里。

---

## 2. 需求清单（按轮次）

### 2.1 第一轮：页面定位与技术方案

**原话**

> 我现在有个博客后台管理页，集成了很多项功能，但我觉得对于写文章来说有点重。能不能给我新拟一个专门用于发博客文章的页面，只保留撰写文章、上传图片到图床及发布文章的功能。技术上有什么实现方案，我平常移动端是 iPhone，我想在移动端轻量化、友好化，适配 iOS 27，最好做成 webapp 那种最大程度模拟 app 的形式，有什么方案实现吗，先给我列举一下
>
> 不用动现在的 admin 页面，我想单独新建博客撰写发布页，我想要的是除了桌面端可用外，在 iPhone 移动端能够接近原生 app 的体验

**验收标准**

| 编号 | 要求 | 落地判定 |
| --- | --- | --- |
| A1 | 独立页面，不动 admin | 新增 `static/write/`，admin 零改动 |
| A2 | 只保留「写 / 传图 / 发」 | 无评论、无友链、无统计等入口 |
| A3 | 移动端优先 | 移动端全屏单栏；桌面端为次要形态 |
| A4 | 接近原生 App | PWA manifest + 主屏图标 + 独立窗口 + 安全区适配 + 无浏览器地址栏（standalone） |
| A5 | 适配 iOS 27 | `viewport-fit=cover`、`env(safe-area-inset-*)`、`100dvh`、输入框字号 ≥16px 防缩放、`visualViewport` 处理键盘 |
| A6 | 不把仓库写权限放前端 | PAT 与 R2 密钥只存在 Worker secret，浏览器只持 HttpOnly 会话 Cookie |

### 2.2 第二轮：登录与版式重构

**原话**

> 1、怎么登录啊 2、我觉得这个样式和布局还是不够友好，不方便写作，你再参考优秀笔记软件的移动端重构一版

**验收标准**

| 编号 | 要求 | 落地判定 |
| --- | --- | --- |
| B1 | 登录入口要显眼、可发现 | 未登录时顶部横幅 + 「⋯」菜单内「登录」行 + 点发布时自动弹登录并在登录后**续做原动作** |
| B2 | 写作区要沉浸 | 标题与正文同处一个滚动容器；无边框、无卡片、无多余色块；正文 17px/1.78 |
| B3 | 工具栏不能喧宾夺主 | 底栏只留 4 个键（图片 / Aa / 预览 / 收键盘）+ 字数；格式项收进 Aa 展开的 chip 条 |
| B4 | 参考笔记软件的信息层级 | 标题大字、元信息小字淡化、正文是唯一视觉重心 |

### 2.3 第三轮：草稿、标签、最近文章、版式润色

**原话**

> 1、草稿是自动保存吗，有没有草稿列表
> 2、标签与别名的输入还是不够优雅，另外标签能否获取已有标签列表进行选择
> 3、可否给个最近五篇已发布博文的列表，实现编辑修改，修改时不生成新文件，而是修改完替换原文件，然后重新构建更新
> 4、整个样式和布局再润色润色，在优化移动端的同时，也要注意桌面端，沉浸式一点，不要全宽页面

**验收标准**

| 编号 | 要求 | 落地判定 |
| --- | --- | --- |
| C1 | 自动保存 | 输入后 550ms 防抖落盘；顶部显示「编辑中…／已存 15:32」 |
| C2 | 草稿列表 | 「文章」面板 → 草稿页签；可切换、可新建、可删除；按修改时间倒序；显示时间与字数 |
| C3 | 标签输入优雅 | 标签变成 chip（点即删），输入框内联在标题下方，回车/逗号/失焦提交，退格删最后一个 |
| C4 | 已有标签可选 | 输入即过滤候选，候选带使用次数，点击加入 |
| C5 | 别名输入优雅 | 单独一行 `/posts/` + 输入框，占位符实时显示按标题推导的 slug |
| C6 | 最近五篇列表 | 「最近发布」页签，最新 5 篇，含日期/标签/字数 |
| C7 | 点进去可编辑 | 正文进编辑器，顶部提示「正在更新《标题》」，按钮变「更新」 |
| C8 | **改原文件，不生成新文件** | 提交带 `path`，后端读原文件 → 改字段 → 用原 sha 提交到同一路径 |
| C9 | 改完重新构建 | 提交到 `master`，Vercel 自动构建（见 7.6 的弱点说明） |
| C10 | 桌面端沉浸但不全宽 | ≥900px 时 940px 居中卡片，正文列 620px，背景为独立纸色 |

---

## 3. 整体架构

### 3.1 数据流

```
iPhone Safari (PWA)
  │  1. POST /api/comments/session  { token }        ← 管理口令，只输一次
  │  2. Set-Cookie: HttpOnly + SameSite=Lax + 30d
  │
  ├─ 草稿：localStorage（完全本地，不发网络）
  │
  ├─ 传图：POST /api/write/upload  (raw bytes)
  │        └→ Worker → R2 桶 image → https://img.hux.ink/images/YYYY/MM/...
  │        ← { url }，前端插入 ![](url)
  │
  └─ 发布：POST /api/write/post { title, content, tags, slug[, path] }
           └→ Worker → GitHub Contents API PUT content/posts/xxx.md (branch=master)
                    └→ Vercel 检测到 push → 构建 → 上线（约 1 分钟）
```

### 3.2 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 前端 | 单文件原生 JS（无框架、无构建） | Hugo 直接吐静态文件；改一行就生效，不需要 node_modules |
| 前端形态 | PWA（manifest + Service Worker） | iOS 加到主屏后独立窗口、无地址栏，最接近原生 |
| 后端 | 现有 Cloudflare Worker（`comments.hux.ink`） | 已有鉴权、CORS、D1、R2 绑定，不需要新服务 |
| 鉴权 | 复用 `COMMENTS_ADMIN_TOKEN` → HttpOnly Cookie + CSRF | 不新增口令；密钥不进浏览器 |
| 图床 | 现有 R2 桶 `image`（绑定名 `MEDIA`） | 与老 admin 共用，域名 `img.hux.ink` 已配好 |
| 文章存储 | GitHub Contents API 写 `content/posts/*.md` | 站点本来就在 GitHub，天然有版本历史 |
| 构建 | Vercel 监听 `master` | 无需自建 CI |

### 3.3 关键设计取舍

1. **为什么不让前端直连 GitHub**：老 admin 把 PAT 存 localStorage，手机上等于把仓库写权限放进 iCloud 备份。现在浏览器只有 HttpOnly Cookie，拿不到任何长期密钥。
2. **为什么复用评论的会话**：再开一套口令就多一个要记、多一个会泄露的点；评论后台的会话已经做了指纹绑定、CSRF、30 天过期。
3. **为什么用 GitHub Contents API 而不是 Git 协议**：单文件读写一个 PUT 就够，不需要 clone/push，Worker 里也能跑。
4. **为什么草稿只在本地**：草稿是私密内容，放服务端就要建表、做隔离、考虑清理；localStorage 零成本且离线可用。代价见 7.3。

---

## 4. 接口契约

所有接口在 Worker 侧，`Content-Type: application/json`（上传除外）。

### 4.1 `GET /api/write/health`

- **鉴权**：公开（不含密钥内容）
- **响应**

```json
{ "ok": true, "github": true, "repo": "cosine00/hug00", "branch": "master",
  "r2": true, "r2Public": "https://img.hux.ink" }
```

- **注意**：`github` 只表示「有没有配 `GITHUB_TOKEN`」，**不校验令牌是否有效**（见 7.1）。

### 4.2 `GET /api/write/posts?limit=5`

- **鉴权**：需要（`adminGate`）
- **参数**：`limit` 默认 5，夹在 1–12
- **逻辑**：读站点上的 `write-index.json`（Hugo 输出的 192 篇 `path / title / date / url`，约 28KB）→ 按 front matter `date` 倒序 → 取前 N → 并发读每个文件全文 → 解析元信息；索引读不到时降级为 GitHub 目录按文件名倒序，并把 `order` 标成 `filename_fallback`
- **响应**

```json
{ "ok": true, "total": 148, "posts": [{
  "path": "content/posts/2026-11-14 影彩.md", "name": "2026-11-14 影彩.md",
  "sha": "…", "title": "影彩", "slug": "vlog", "date": "2026-11-14 15:36:00",
  "tags": ["人间流浪", "折腾"], "draft": false, "url": "/posts/vlog/",
  "excerpt": "…", "words": 860, "content": "正文全文（已去尾部空白）"
}]}
```

- **失败**：401/403 → 分别映射成 `token_invalid` / `token_forbidden`；其他 → `commit_failed`

### 4.3 `GET /api/write/tags`

- **鉴权**：需要
- **逻辑**：抓 `https://hux.ink/tags/` → 正则解析 `<a href="/tags/x">名字</a> (N)` → 去重 → 按次数倒序；用 Cache API 缓存 900 秒
- **响应**

```json
{ "ok": true, "tags": [{ "name": "人间流浪", "count": 50 }], "fetchedAt": "…" }
```

- **注意**：抓取失败时返回 `{ ok: true, tags: [] }`，**不报错**（见 7.4）。

### 4.4 `POST /api/write/upload`

- **鉴权**：需要 + CSRF（`x-csrf-token`）
- **请求体**：图片原始字节，`Content-Type: image/*`
- **限制**：≤ 8MB；只收 `image/*`
- **Key 规则**：`images/{YYYY}/{MM}/w{YYYYMMDDHHmmss}-{6位随机}.{ext}`（北京时间）
- **缓存头**：`public, max-age=31536000, immutable`
- **响应**：`{ ok: true, key, url, size }`
- **错误**：`415 bad_type`、`400 empty_body`、`413 too_large`、`503 r2_not_configured`、`502 r2_put_failed`

### 4.5 `POST /api/write/post`
- **鉴权**：需要 + CSRF
- **请求体**

```json
// 新建
{ "title": "标题", "content": "Markdown 正文", "tags": ["折腾"], "slug": "可选" }
// 更新（多一个 path）
{ "path": "content/posts/2026-11-14 影彩.md", "title": "…", "content": "…", "tags": [], "slug": "" }
```

- **校验**：`title` 非空、`content.trim()` 非空、`tags` 最多 8 个
- **新建路径**：`content/posts/{北京日期} {安全化标题}.md`
- **更新路径校验**：必须匹配 `^content/posts/[^/\\]+\.md$`（防目录穿越）
- **更新冲突**：先读 sha → PUT；若 409/422 则重读 sha 再 PUT 一次；仍失败则报错
- **响应**

```json
{ "ok": true, "updated": false, "path": "content/posts/…", "name": "…",
  "sha": "…", "commit": "https://github.com/…/commit/…", "liveUrl": "/posts/xxx/" }
```

- **同名新建**：若文件名已存在（同一天同标题），自动取 sha 转为更新，返回 `updated: true`

### 4.6 `GET /api/write/images?limit=10`

- **鉴权**：需要
- **逻辑**：按北京时间倒推最多 24 个月，逐月 `R2 list`（每页 1000 条），凑够 `limit` 即停；过滤图片扩展名，按 `uploaded` 倒序
- **响应**

```json
{ "ok": true, "images": [{ "key": "images/2026/11/w20261117091200-a1b2c3.webp",
  "url": "https://img.hux.ink/images/2026/11/...", "size": 182000,
  "uploaded": "2026-11-17T06:12:00.000Z", "type": "image/webp" }] }
```

- **已知限制**：R2 `list` 按 key 升序，单月超过 1000 张时拿不到最新（当前图量远低于此）；`recentMonthPrefixes` 上限 24 个月，更早的图不会出现在面板里（仍可从文章里找到）。

---

## 5. 关键实现说明

### 5.1 鉴权与登录

- 复用评论后台：`POST /api/comments/session { token }`，口令即 `COMMENTS_ADMIN_TOKEN`。
- 服务端下发 `Set-Cookie: hux_admin=…; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`（30 天，`COMMENTS_SESSION_DAYS` 可覆盖）。
- Cookie 是 **host-only**（未设 `Domain`），只对 `comments.hux.ink` 生效；前端从 `hux.ink` 用 `credentials: 'include'` 请求，因同属 `hux.ink` 这一 registrable domain，`SameSite=Lax` 不拦截。
- 所有写操作要求 `x-csrf-token`，值从 `GET /api/comments/session` 的 `csrf` 字段取。
- 前端三个登录入口：顶部横幅、⋯ 菜单、点发布时自动弹。登录成功后若 `pendingPublish` / `pendingUpload` 有值，会自动续做。

### 5.2 草稿系统

**存储结构**（`localStorage['hux-write-v3']`）

```json
{ "activeId": "dabc123", "drafts": [{
  "id": "d…", "title": "", "tags": ["折腾"], "slug": "", "body": "",
  "createdAt": 1763366400000, "updatedAt": 1763366400000,
  "edit": { "path": "content/posts/…", "name": "…", "url": "/posts/…/" },
  "publishedAt": 0
}]}
```

- **自动保存**：`input` → `scheduleSave()` 550ms 防抖 → `flushSave()` → `persist()`；切后台（`visibilitychange`）、`pagehide` 也会 `flushSave()`。
- **上限**：30 篇。超出时保留当前编辑的那篇 + 按 `updatedAt` 倒序取 29 篇。
- **迁移**：首次打开若发现旧键 `hux-write-draft-v2`，转成一篇草稿并删除旧键。
- **切草稿**：`flushSave()` → `loadActive()` → 重设 scroll/undo 栈。
- **状态标记**：`edit` 非空即「更新模式」，顶部显示细条，发布按钮文案变「更新」。

### 5.3 标签选择器

- 已选标签渲染为 chip，chip 右侧 `×` 点击移除。
- 输入框内联在同一行；`input` 事件实时过滤候选（排除已选，最多 8 条）。
- 候选浮层 `position: fixed` 挂在 `<body>`，位置由 `placePicks()` 用 `getBoundingClientRect()` 计算，空间不足时翻到上方——**这是为了不被 `.doc` 滚动容器裁切**。
- 候选项 `mousedown` 先 `preventDefault()`，避免输入框失焦导致浮层关闭。
- 提交方式：点击候选、回车、逗号（中英文）、失焦、粘贴多个（按 `,，、空格` 拆分）。
- 退格在输入框为空时删掉最后一个 chip。

### 5.4 图片上传

1. `<input type="file" accept="image/*" multiple>` 或多选拖入。
2. **前端压缩**：短边不设限，长边压到 ≤1600px，输出 `image/webp`（quality 0.82），失败退回 `image/jpeg`（0.86）；已是 <220KB 的 webp/jpeg 直接传，不重编码。
3. 逐张串行上传（避免并发把移动网络打满），每张完成立即在光标处插入 `![](url)`。
4. 未登录时暂存 `pendingUpload`，登录后自动续传。

### 5.5 发布与就地更新

**新建**：生成 front matter（`title / author / date / lastmod / tags / draft:false`），文件名 `YYYY-MM-DD 标题.md`，直接 PUT。

**更新**（`patchFrontMatter`）：

- 解析原文件 → 拆成 `entries[]`（保留每条的原始缩进行）+ `body`。
- **受管字段**：`title / lastmod / tags / slug`，由本次请求重写。
- **其它字段原样保留**：`date / author / feature / description / hideInList / aliases …`，连缩进和顺序都不动。
- `lastmod` 插在 `date` 之后，让 diff 看起来自然。
- **正文用本次提交的 `content`**（早期版本这里用了原文件的 body，导致改动被吞，被单测抓到后修正）。
- 上传时带原 sha；409/422 重取 sha 再提交一次。

**YAML 安全**：`yamlString()` 对含 `:`、`#`、引号、特殊首字符的值加双引号并转义。`yamlValue()` 反向还原。

### 5.6 版式与 PWA

- **移动端**：`100dvh` 单栏，`padding-bottom: env(safe-area-inset-bottom)`，顶栏 `padding-top: env(safe-area-inset-top)`；键盘弹起时用 `visualViewport` 调整底栏位置；输入框 `font-size ≥16px` 防 iOS 自动缩放。
- **桌面端**（≥900px）：`width: min(940px, 100vw - 40px)` 居中圆角卡片，`box-shadow` 浮起，正文列 620px，标题 35px；滚动条 hover 才显示。
- **空文档**：隐藏标签/别名两行，只剩标题与正文，避免「表单感」。
- **PWA**：`manifest.webmanifest`（`display: standalone`、`theme-color`、180/512 图标）、`sw.js` 壳缓存（`hux-write-v3`），页面走「网络优先、失败回缓存」。
- **撤稿栈**：动作前 `flushHistory()` 存快照，动作后 `commitEdit()` 入栈，最多 80 步；避免防抖把连续输入拆成几十步。

---

## 6. 数据与命名约定

| 项 | 规则 |
| --- | --- |
| 文章路径 | `content/posts/YYYY-MM-DD 标题.md` |
| 文件名安全化 | 非法字符 `\/:*?"<>|` → `-`；空白折叠；截断 60 字符；空则 `未命名` |
| 日期来源 | Worker 端按 **UTC+8** 现算，不信任客户端时钟 |
| Slug 优先级 | front matter `slug` > 文件名去日期后 slugify |
| URL 预览 | `/posts/{slug}/` |
| 时区 | 中国无夏令时，固定 +8h 处理，无 DST 分支 |

---

## 7. 已知限制与风险

> 分级：**P0** 现在就影响使用；**P1** 应该修；**P2** 可接受但要知道。

### 7.1 P0：`GITHUB_TOKEN` 已失效

用 curl 直连 GitHub 调该 PAT 返回 `401 Bad credentials`。而 `/api/write/health` 只判断「有没有配」，仍显示 `github: true`，造成「看起来正常但发布会失败」的误判。

- 处理：重新建 fine-grained PAT（只勾 `cosine00/hug00`，`Contents: Read and write`），`npx wrangler secret put GITHUB_TOKEN`。
- 代码侧已加 `githubTrouble()`，401 会返回人话「GitHub 令牌失效或已过期」。
- **建议审计**：`health` 是否应该做一次轻量真实性探测（如 `GET /repos/{repo}`），代价是每次打开页面多一次 GitHub 请求。

### 7.2 已修复：最近五篇改为按 front matter 的 `date` 取

早期版本用 GitHub 目录按文件名倒序，依赖 `YYYY-MM-DD` 命名规范。现已改为读 Hugo 输出的 `write-index.json`（`path / title / date / url`，192 篇约 28KB），按真实 `date` 倒序。

- 索引读不到时（比如刚改完配置还没构建）降级为文件名排序，响应里 `order: 'filename_fallback'`，前端把副标题改成「按文件名排序（日期索引还没构建出来）」，不再整块 502。
- 代价：`write-index.json` 要等一次 Hugo 构建才更新，**刚发布的文章不会立刻出现在「最近五篇」里**（通常 1 分钟内）。
- **请审计**：这个「构建完成后才可见」的窗口是否可以接受；有没有必要在发布成功后主动触发一次构建。

### 7.3 P1：草稿只存在本机 localStorage

- 换设备、清缓存、Safari 长期不用被回收 → 草稿消失，**无导出/导入**。
- 上限 30 篇；单篇长文可能撞 5MB 配额，`persist()` 返回 false 时只提示「存不下（空间满）」，没有降级策略（如提示导出）。
- **请审计**：是否值得加「导出为 .md」按钮（成本低），或把草稿同步到 D1/R2（成本高）。

### 7.4 P1：标签候选会「静默失效」

- `handleWriteTags` 抓 `/tags/` 页面失败时返回 `{ ok: true, tags: [] }`，前端只看到「没有候选」，不会报错。
- 正则 `/<a[^>]+href="\/(?:tags|tag)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*\((\d+)\)/` 强依赖主题输出的 `</a> (N)` 结构，**主题一改就静默归零**。
- 缓存 900 秒：刚发布的新标签要等构建完成 + 缓存过期才出现在候选里（手输不受影响）。
- **请审计**：失败时是否应回 `ok:false` 或带 `degraded:true` 标记，让 UI 显示「候选暂不可用」。

### 7.5 P1：改 slug 会让旧链接 404

更新时 `slug` 被重写，URL 随之变化，但**没有写 `aliases`**，旧链接直接 404。

- 备选：改 slug 时自动在 front matter 追加 `aliases: ["/posts/旧slug/"]`。
- **请审计**：Hugo 的 `aliases` 生成的是 meta-refresh 跳转页，是否满足需求；会不会与现有字段冲突。

### 7.6 P1：「重新构建」没有闭环

需求原话是「修改完替换原文件，然后重新构建更新」。当前实现只做到「提交到 master，Vercel 自动构建」：

- 没有主动触发构建（未接 Deploy Hook）；
- 没有回传构建结果 —— 构建失败用户看不到，只会发现「文章没上线」；
- 提示语固定为「约 1 分钟生效」，是经验值不是事实。

- **请审计**：接 Vercel Deploy Hook 或轮询 commit status 的成本与收益。

### 7.7 P2：更新时 `tags` 会被归一化成 block 列表

原文件若写 `tags: [折腾, 书影音]`（inline 数组），更新后会变成：

```yaml
tags:
  - 折腾
  - 书影音
```

语义等价，但会产生无意义 diff。`title` 也会被提到 front matter 第一行。

### 7.8 P3（已实测，无实际影响）：`yamlString` 对「看起来像非字符串」的标题不加引号

判定规则是「首字符是字母/数字/下划线/中文，且不含 `:` `#`」→ 原样输出。于是：

- 标题 `2026` → `title: 2026` → YAML 里是**整数**
- 标题 `true` / `false` / `null` → YAML 里是**布尔或空值**

**已用 Hugo v0.160.1 实测**（最小站点 + `{{ .Title }}` / `{{ len .Title }}` / `{{ lower .Title }}`）：

```
title: 2026  → <h1>2026</h1><p>4</p><p>2026</p>   构建成功，无 error
title: true  → <h1>true</h1><p>4</p><p>true</p>   构建成功，无 error
```

Hugo 内部会把 YAML 标量转成字符串，**不会导致构建失败**，也不影响模板函数。仅有的副作用是 `hugo list all` 里 title 以 `2026` / `true` 呈现，若下游脚本按「必须是带引号的字符串」做正则匹配，可能在类型上踩坑。可以不管。

### 7.9 部分修复：列表用真实 permalink，发布面板仍是近似值

「最近五篇」的链接现在直接用索引里的 `.RelPermalink`，和 Hugo 实际生成的地址完全一致（早期把 `APEC-SHENZHEN-2026` 拼成大写，实际路径是小写，点进去 404）。

仍然近似的两处：

- **发布面板的 URL 预览**：`slugify()` 是自写的近似 Hugo `urlize`，标点和重音字符可能和最终结果不同；
- **新建文章后的 `liveUrl`**：`postUrl()` 现在会 `.toLowerCase()` 跟进 Hugo 默认的 `disablePathToLower=false`，但 `urlize` 的其他规则仍可能不同。

### 7.10 P2：HEIC 等格式在桌面端会失败

`compress()` 用 `new Image()` 解码。Chrome 桌面不支持 HEIC，选择 iPhone 原图（HEIC）会走到 `reject`，提示「这个格式读不了，试试截图再传」。iOS Safari 内部通常会转码，但不保证。

### 7.11 P2：并发编辑仍可能互相覆盖

冲突处理是「409 → 重读 sha → 用**我的内容**再提交一次」。两人同时改同一篇，后提交者仍会覆盖前者的改动，只是不会报错。没有「检测到他人修改，请合并」的提示。

### 7.12 P2：缺少的能力

- 没有删除文章 / 转为草稿（`draft: true`）的入口；
- 没有草稿全文搜索；
- 没有图片管理（传了但没插入的图会永久留在 R2）；
- 没有发布历史回看（只能去 GitHub 看 commit）；
- Service Worker 网络优先，离线能打开界面但不能发布（iOS 无 Background Sync，草稿在本地，重试即恢复）。

### 7.13 安全相关

- 登录口令 = `COMMENTS_ADMIN_TOKEN`。**谁拿到它，谁就拥有仓库写权限**（通过本接口）。口令强度、轮换策略需要单独确认。
- `COMMENTS_ALLOWED_ORIGIN` 是 `https://hux.ink,https://www.hux.ink`；无 `Origin` 的请求（curl、脚本）直接放行 —— 但写操作还要过 Cookie + CSRF，风险可控。
- 更新接口的路径校验是 `^content/posts/[^/\\]+\.md$`，能防 `../`，但不能防「写入任意已存在的 posts 文件」—— 这是功能本身（就是要改任意一篇），不算漏洞，但**没有「只能改自己刚创建的文件」的限制**。

---

## 8. 已做过的验证

| 项 | 方式 | 结果 |
| --- | --- | --- |
| front matter 往返 | 对全部 148 篇跑 `splitFrontMatter` → `patchFrontMatter` → 再解析 | 通过，正文与字段无损 |
| 后端单测 | `node --test tests/write-api.test.mjs` | 7 条全过 |
| 全站回归 | `node --test tests/*.test.mjs` | 53 条通过 |
| 真实仓库更新 | 建临时分支 → 调 `handleWritePost` 更新某篇 → 校验 → 删分支 | date 保留、lastmod 更新、正文替换、master 未受影响 |
| 前端语法 | 抽出内联 `<script>` 跑 `node --check` | 通过 |
| UI 走查 | 无头 Chrome + CDP，390×844 与 1440×900 各截 12 张 | 已修：桌面标题被裁、更新条显示文件名、空文档表单感、chip 与输入框基线不齐 |
| 线上状态 | `curl /api/write/health` | `github:true, r2:true`（但 token 实际已失效，见 7.1） |
| 日期索引 | 线上 `/write-index.json`：192 篇，校验日期严格倒序 | 通过 |
| 最近五篇 | 用真实仓库跑 `handleWritePosts`，含 `obsidian/` 子目录 | 5 篇按 date 正确倒序，sha / 标签 / 正文齐全 |
| 玻璃样式 | 无头 Chrome 量 76 个按钮的 `backdrop-filter`，并截图走查 | 确认内层控件取消二次模糊后无白色光晕 |

**没做的验证**：真机 iPhone 上的键盘行为、主屏图标安装流程、iOS 27 实际表现、弱网/断网发布、多设备并发。

---

## 9. 希望你重点核查的 10 个问题

1. `patchFrontMatter` 的「保留未受管字段」逻辑，是否有 front matter 写法会让它丢字段或写坏 YAML？（重点：多行字符串 `|`、嵌套 map、注释行、`tags` 的 inline 与 block 混用）
2. `splitFrontMatter` 用 `indexOf('\n---', 3)` 找结束标记，正文若以 `---` 开头或 front matter 内含 `---` 行，会不会误判？
3. `yamlString` 的引号策略（7.8）已实测不影响 Hugo 构建，但类型不严谨。是否值得统一强制加引号，换取 front matter 的类型确定性？
4. 「最近五篇」现在走 `write-index.json`（7.2），但索引要等构建；发布成功后是否该主动触发构建，缩短这段不可见窗口？
5. 更新时 409 重试一次（7.11）是否够？是否应该改成「内容不一致就拒绝并提示」？
6. 改 slug 不写 `aliases`（7.5），旧链接 404 的影响面有多大？Hugo `aliases` 是否是最佳补法？
7. 标签候选的正则解析（7.4）是否可靠？有没有比「抓 HTML」更稳的方式（如让 Hugo 输出 `tags/index.json`）？
8. 草稿只在 localStorage（7.3）的丢失风险，是否值得用「导出 .md」这种低成本方案兜底？
9. 鉴权复用 `COMMENTS_ADMIN_TOKEN`（7.13）：口令泄露时的影响面是否可接受？是否需要把「评论管理」与「仓库写权限」拆成两个凭证？
10. 「发布后重新构建」（7.6）目前没有闭环，构建失败无感知。是否该接 Deploy Hook 或轮询 commit status？

---

## 10. 相关文件

| 文件 | 作用 |
| --- | --- |
| `static/write/index.html` | 前端全部（HTML + CSS + JS，约 2100 行，单文件） |
| `layouts/_default/home.writeindex.json` | 输出 `write-index.json`（只含 path / title / date / url） |
| `static/write/manifest.webmanifest` | PWA 清单 |
| `static/write/sw.js` | Service Worker（壳缓存 `hux-write-v3`） |
| `static/write/icon.svg` / `icon-180.png` / `icon-512.png` | 图标 |
| `worker/src/write.js` | 后端全部（约 610 行） |
| `worker/src/index.js` | 路由注册、`adminGate` 鉴权、CORS |
| `worker/src/session.js` | 会话与 Cookie（30 天、HttpOnly、SameSite=Lax） |
| `wrangler.toml` | `WRITE_GITHUB_REPO`、`WRITE_GITHUB_BRANCH`、`WRITE_SITE_ORIGIN`、`R2_PUBLIC_URL`、`[[r2_buckets]] MEDIA` |
| `tests/write-api.test.mjs` | 7 条后端测试 |

**部署方式**

```bash
# 前端：push 到 master，Vercel 自动构建
git push origin master

# 后端：改了 worker 才需要
npx wrangler deploy

# 密钥（不进仓库）
npx wrangler secret put GITHUB_TOKEN
```

**提交历史**

- `bb90b06` 新增独立撰写页 + 发布/上传接口
- `247dd5f` 移动端重构为单文档流
- `9517d1f` 草稿、标签选择、最近文章就地更新、桌面端版式

---

## 11. 补充：顶部自动隐藏、关稿后的入口页、博友分页

**顶栏为什么不做成「和工具行合并成一条」。** 合并要放下的东西是：左侧抽屉键、中间同步状态（兼工作台把手）、右侧保存/发布键，再加图片、Aa、预览、字号、字数、收键盘、关稿——手机 390px 宽下这一行 8 个可点目标，每个只剩 40px 出头，误触率会比省下的 52px 高度更贵。所以走「自动隐藏」：顶栏改成绝对定位叠在纸面上，正文从它下面滚过；往下读滑走，往上滚 6px 就回来，收起时 `.deck` 的 `margin-top` 一起让回去，等于真的多出两行正文。

- 判定只看方向不看位置（`tbAnchor` 记锚点），慢慢滚不会一阵一阵地闪；
- 收起的动画是 `transform` + `margin-top` 同时走 340ms，正文是容器上移，不是重排文字；
- 登录提示条与「正在更新」提示条挪进了 `.doc-inner`，跟着文档一起滚走，不再在顶上常驻一条。

**关掉当前稿（工具行最右的 ✕）。** 关掉不是删掉，内容仍在草稿里；一个字都没有的空白稿才算真扔掉。关掉后 `.stage` 里换成 `.homepane`：写新的一篇 + 草稿/最近发布/最近图片三个入口（点进去直接落到对应的抽屉内页，不用再点一层）。`paneClosed` 只管这一层，`activeDraft()` 等逻辑一律不动，所以同步、标签、发布都不用改。注意顺序：先 `docEl.scrollTop = 0` 再挂 `.closed`，因为 `.doc` 一旦 `display:none` 就没有布局，scrollTop 赋值不作数。

**博友在写分页。** `/desk-index.json` 一次给 40 条（仍是构建时算好的静态文件，约 9KB），前端先画 5 条，抽屉滚到底自动再添 5 条，底部留一行「再看五篇 · 还有 N 条」当暗示。翻页只在本地截取，**不会多发一次请求**，所以「多看几篇」不消耗 Workers/D1 额度。列表右上「全部」指向 `/recent/`（`content/recent.md`，`layout: friend`），不是 `/friend/`。

---

## 12. 状态栏两截字、顶栏收起的时机、/write/ 清退

**「已存」和「云端」是两件事，不是一件事的两种说法。** 顶栏中间那行字从原来的 `已存 20:16 · 已同步` 改成 `已存 20:16 · 云端 ✓`，前半截和后半截各管一件事：

| 半截 | 含义 | 什么时候变 | 丢了会怎样 |
| --- | --- | --- | --- |
| `已存 20:16` | 已写进这台设备的 localStorage | 每次停手 550ms 后 | 关掉网页就没了 |
| `云端 ✓` | 已备份到 Cloudflare D1 | 停手 1.2s 后上行成功 | 换设备/清缓存拉不回来 |

两截独立：本机永远先落地（0 请求），云端随后追（1 请求）。所以可能出现 `已存 20:16 · 上传中`、`已存 20:16 · 云端待重试`（断网）、`已存 20:16 · 仅本机`（没登录）——这些都不是错，只是处在不同的两截上。空稿没东西可存，只显示「新草稿」，不挂云端状态，免得让人以为存过什么。文案统一从 `saveLine(draft)` 一个出口出，别再各处拼字符串。

**顶栏收起的门槛。** 原来只要往下滚 6px 就收，此时标题和「添加标签」那一行还在视野里；而收起会把 `.deck` 整体上移 60px，于是标题、标签被一起顶出屏幕——看起来就像「自动隐藏把标题也藏了」。现在加一道 `headInSight()`：`.meta`（标题下面那一行，含标签/链接）的底边还在 `.doc` 顶部以下 10px 内，就不收；等它们真滚出去了才收，收的时候谁也看不见。往上滚仍然立即展开，第一时间能把标题看回来。

**`/write/` 彻底清退。** 删掉 `static/write/`（跳转页 + kill-switch SW），改由 `vercel.json` 的 redirects 把 `/write` 与 `/write/` 转到 `/beta/`（307，不用 308，免得到时候难改）。老设备上可能还挂着 scope 为 `/write/` 的 Service Worker 和 `hux-write*` 缓存，那个 SW 是 cache-first，只要活着就会一直吐旧页面；所以 `/beta/` 在 `load` 时顺手 `getRegistrations()` 注销 `/write/` 下的注册、删掉 `hux-write` 前缀的缓存，打开一次新页面就干净了。接口路径 `/api/write/*`、`write-index.json`、`worker/src/write.js` 都不是旧页面，保留。

---

## 13. 入口页三个去处、评论就地回复、保存节奏调松

**保存从「每敲几下就发一次」改成正常笔记软件的节奏。** 原来本机 0.55 秒落盘、云端 1.2 秒上行，等于一句话没打完就发了两三个请求。现在是：

| 触发 | 间隔 | 代价 |
| --- | --- | --- |
| 输入停顿后写 localStorage | 2.5 秒 | 0 请求 |
| 再往后上行到 D1 | 15 秒 | 1 请求（只带脏的那几篇） |
| 切后台 / 关页面 | 立刻落盘，并补推一次 | 1 请求 |

15 秒是「能忍的丢失窗口」和「请求量」的折中：真断了网，本地那份还在，下次打开 `pullDrafts` 会按 `updatedAt` 把漏推的重新标脏补上去。写两小时大约 40～60 次上行，比原来少一个数量级。

**入口页整体上移 + 底部三个入口。** `.hp-inner` 的下内边距从 0 加到 `clamp(38px,9vh,92px)`，`margin:auto` 剩下的空间上下重分，整块因此上移约 40～50px；空出来的位置放 `.hp-links`：三个 46×46 的圆角方块 + 线性图标 + 11px 小字，配色走 `--field` / `--line` / `--faint`，比上面那张卡片低一档，不跟「写新的一篇」抢视线。

- **Memos** → `https://drafts.hux.ink/`（新窗口）
- **博客主页** → `https://hux.ink/`（新窗口）
- **评论** → 从右滑入的抽屉，读最新 15 条，就地回复

**评论回复为什么另开一个接口。** 普通 `POST /api/comments` 的身份规则是「会话通过 + 提交的邮箱等于博主邮箱」，而回复框里根本没有邮箱这一栏。看起来最省事的改法是「会话通过且没带邮箱就当博主邮箱」，但那会直接废掉 `resolveSubmitterIdentity` 的安全断言（`tests/comment-identity.test.mjs` 里锁着「邮箱为空时即便带口令也不是博主」）。

所以新增 `POST /api/comments/reply { id, content }`：走 `adminGate`（口令头或会话 + CSRF），服务端用 `id` 自己查父评论拿 `thread_key`，再以 `COMMENTS_ADMIN_EMAIL` 和 `COMMENTS_ADMIN_NICK` 的身份调 `createComment`。前端只需要知道「回哪条、回什么」，页面上不出现博主邮箱，那条身份规则一个字没动。

- `GET /api/comments/admin` 的 SQL 加了 `LEFT JOIN threads`，顺带返回 `thread_title` / `thread_url`，抽屉里才能显示「哪一篇」而不是 `post:/posts/xxx/`。
- 博主回复放宽限流：访客 30 秒 3 条 / 小时 10 条，博主 30 秒 15 条 / 小时 80 条。手机上连着回三四条是常事。
- 回复落库后 `notify: false`（博主自己不订阅），但被回复的人仍会收到邮件（`notifyReply` 看的是父评论的订阅状态）。

## 14. 入口页变成默认落点、未登录不读草稿

**默认落点改了。** 以前打开 `/beta/` 直接落进编辑器，那是一张「上次那篇」的空白纸，光标在哪、写没写完全靠猜。现在启动时先 `enterHome()`：顶栏「未打开」、写作层隐藏、停在入口页，刷新和从主屏图标重开都一样。想写就点「写新的一篇」，想接着写就从「草稿」里挑——`loadActive()` 只负责把内容灌进 textarea，切不切回写作页交给 `reopenPane()`，所以入口页不会被它拽走。

**入口页上不再有「这篇」的信息。** 顺手修掉了三处串味：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| 顶栏中间 | `已存 21:27 · 云端 ✓` | `未打开` |
| 底部纸脊 | `叠不完 44 字 · 云端 ✓` | `回到入口`（右半边留空） |
| 右上角抽屉 | 保存 / 发布 / 导出 / 删除这篇 | 只留登录、导入、服务状态 |

`flushSave()` 在 `paneClosed` 时直接返回：关掉以后没有「正在编的那篇」，不该再往盘里写、也不该 15 秒发一次空请求。

**未登录＝未解锁。** 以前 localStorage 里的草稿不管有没有登录都会读出来、摆在列表里。现在：

- `store` 在启动时是 `sessionStore()`——内存里的一份空稿；`loadStore()` 只有在 `authed` 为真时才碰 localStorage。
- `persist()` 未解锁时直接返回 `false`，避免空稿把本机真正的草稿覆盖掉。
- 入口页换成「还没解锁 / 登录后才显示这台设备上的草稿」，主按钮变「登录」，草稿行副标题变「登录后显示」，抽屉里的草稿列表只有一行登录引导。
- 退出登录时 `lockStore()` 清空内存里的草稿、清空 textarea，再回到入口页。
- `GET /api/write/health` 从公开改为 `adminGate`：仓库名、分支、R2 公开地址本来谁都能 curl 到，现在只有带会话的人看得到；页面上未登录显示「登录后可见」。

**三个图标跟菜单行统一了。** 原来的 46×46 圆角方块 + 边框 + 文字，跟上面「草稿 / 最近发布 / 最近图片」的裸描边图标完全是两套语言。现在去掉容器和文字，图标 25px、`stroke:var(--accent)`、`stroke-width:1.7`，和 `.mr-ico` 同一套参数只放大一号；无障碍名字走 `aria-label`，点按有 `scale(.9)` 反馈。

- Service Worker 缓存名提到 `hux-update-v15`，新壳和旧缓存不打架。

## 15. 地址改 `/beta`，评论抽屉按楼加载，图标放大

**`/update/` → `/beta`。** `git mv static/update static/beta`，manifest 的 `id` / `start_url` / `scope` / 图标、SW 的 scope 与 SHELL、页面里的 `<link>` 和注册语句全部跟着换。`vercel.json` 的 redirects 变成 `/write`、`/write/`、`/update`、`/update/` → `/beta/`（307）。`/api/write/*` 是接口，不动。

老设备的善后：页面 load 时注销 scope 在 `/write/` 或 `/update/` 下的 Service Worker，并删掉 `hux-write*`、`hux-update*` 缓存；SW 缓存名从 `hux-update-v15` 换成 `hux-beta-v1`，`activate` 只清 `hux-` 前缀的旧缓存，不再碰同源别的缓存。**已经装到主屏的旧图标，其 `start_url` 仍是 `/update/`，会 307 跳到 `/beta` 但 PWA scope 不匹配，需要删掉重新添加一次。**

**评论抽屉按楼取。** 新增 `GET /api/comments/admin?tree=1`（`adminThreads`）：先按时间取最新 N 条记录摊成楼号，再把每一楼的楼主和全部回复补齐（`c.id IN (…) OR c.root_id IN (…)`），按「最近有动静」排序返回 `{ groups: [{…root, replies: []}] }`。

- 没有回复的独立评论就是单独一条，和以前一样；
- 是回复的，把整楼拉出来：楼主在上，回复缩进挂在左边竖线上，回复头部标「回复 @某人」；
- 已经在楼里出现过的回复不再单独成行，楼内不再重复标「哪一篇」（出处写在楼顶）；
- 楼主本身被他删/标 spam 时整楼不摆，避免回复悬空；
- 抽屉副标题改成「最新 N 楼 · 共 M 条」。

**三个图标放大。** 25px → 32px，`stroke-width` 1.7 → 1.6（放大后线条不显粗），点按区 44 → 54，间距 16 → 20。

## 16. iPhone 上「持续抖动」：视口同步与 iOS 抢滚动

**现象**：评论里回完一条之后页面持续上下跳；不动评论、只用双指放大也会抖。

**根因**（三处叠在一起，都出在 `syncViewport()` 那几行上）：

1. **`visualViewport` 的 `scroll` 被当成滚动事件处理。** 这个事件在 iOS 上不是「用户滚了页面」，而是「可视视口挪了」——双指缩放、平移、键盘弹起时每一帧都在发。原来的处理函数每次都写 `--app-h` / `--vv-top`，也就是每一帧都改一次根容器的高度和位移，等于页面自己跟着手指再动一遍。
2. **在 `scroll` 回调里调 `window.scrollTo(0, 0)`。** 文档本来是 `overflow:hidden`，这句唯一的作用是和 iOS 自己去滚可视视口的行为较劲：iOS 为了露出聚焦的输入框挪一点 → 我们把它扶回去 → iOS 再挪 → 再扶。评论回复框、标题输入框一聚焦就进入这个循环，所以「回完一条评论一直在跳」。
3. **面板按布局视口铺满整屏。** `.sheet{position:fixed;inset:0}` 高度跟着**布局视口**走，键盘弹起时 `--app-h` 已经缩了，面板还铺到键盘底下；iOS 为了让输入框可见只能去滚整页，又回到第 2 条。

再加上一个独立的放大器：顶栏自动隐藏会把 `.deck` 的 `margin-top` 改 60px，滚动容器的可滚范围跟着变，浏览器会夹一下 `scrollTop`，那一次 scroll 事件看起来就像「用户又滚回去了」，于是又展开顶栏、再夹一次——在内容底部附近能来回抖不停。

**改法**（都在页面自身，没动 iPhone 的手势能力）：

- `syncViewport()` 三条规矩：① `scale !== 1` 时直接返回，缩放期间不接管布局；② 不再调 `scrollTo`；③ 数值没变就不写 CSS 变量。
- 视口事件用 `requestAnimationFrame` 合并，同一帧只算一次。
- `window.scrollTo(0,0)` 只在 `focusout`（焦点和键盘都收干净）280ms 后扶正一次；缩放中不扶。
- `.sheet` / `.preview` 从 `inset:0` 改成 `top:var(--vv-top); height:var(--app-h)`，跟着可视视口走；面板的 `max-height` 从 `86vh`/`80vh` 改成相对容器高度，键盘弹起时抽屉整体缩短、内部自己滚。
- 顶栏收起/展开后 `rAF` 里重新锚定 `tbAnchor`，并在 340ms 内忽略自己造成的 scroll（`tbLockUntil`）。
- `openSheet` / 回复框 / 标题聚焦统一走 `focusSoft()`（`focus({preventScroll:true})`），不让浏览器顺带滚整页；键盘弹出后的「把光标带进视野」改成只动 `.doc.scrollTop`（`revealInDoc`），不再 `scrollIntoView`。
- `resize` 只在**宽度**变化时才 `growAll()`；键盘只改高度，不必重排整个正文。
- `.doc` 加 `overscroll-behavior:contain`，滚动到边界不再传给整页。

**验证**（无头 Chrome + 注入的 `visualViewport` 模拟缩放与键盘）：

| 场景 | 结果 |
| --- | --- |
| 连续 60 次 scale 1→2.18、height/offsetTop 抖动 | `--app-h` 不变、style 写入 0 次、`scrollTo` 调用 0 次 |
| 键盘把可视高度压到 480 | `--app-h` 480，`.sheet` 480，抽屉面板 480，落在可视区内 |
| 点「回复」聚焦输入框 | 输入框获得焦点，`window.scrollY` 与文档 `scrollTop` 均为 0 |
| 内容底部来回滚 20 次 | 顶栏只切换 1 次后稳定（改前会反复翻转） |

## 17. 发布后离开草稿箱、入口页下滑展开、右侧换个图标

**发完就不该还赖在草稿箱里。** 以前发布成功只是给草稿打上 `edit` + `publishedAt`，列表里就一直是「更新中」——那其实是「正在改一篇已上线的文章」，不是「还没写完」。现在发布/更新成功后走 `removeDraft(id)`：本机删掉、云端补一块墓碑（`dropRemote` 的 `deletedAt`）、回到入口页；想再改就进「最近发布」，那边会重新装一篇草稿出来。

历史遗留（老版本发布后留下的那批）由 `prunePublished()` 清：只清「有 `edit`、且 `publishedAt` 之后一个字没再改过（`updatedAt <= publishedAt`）」的条目，真改过的是待更新草稿，会留着。启动时清一次，`adoptRemote()` 合并云端之后再清一次——否则另一台设备一推就把它们又拉回来。

**入口页下滑展开工作台。** 顶部那条胶囊对拇指偏高，现在整页往下甩一下也能展开：单指、明显向下（`dy > 14` 且 `dy > dx * 1.2`）、且入口页本身还停在顶部才接管；双指（缩放）、横滑、往上回滚一概放过。拖动时沿用纸脊那套 `--fold-p` 进度实时跟手，松手超过 `min(deck*0.3, 88px)` 就停在工作台。`preventDefault` 只在判定为下拉之后才调，不会影响页面滚动。

**右侧按钮换成三点。** 原来左右两个都是「两栏面板」的同一个图标，只是一个分割线在左、一个在右，认不出哪个是哪个。右边改为横向三点（`svg.dots`，`fill:currentColor`），左边保持面板图标。

## 18. 「已发布还在草稿箱里」的真正原因：发布尾巴与时间戳判据

第 17 节那套清理上线后，`带劲的小曲儿` 仍然赖在草稿箱里，云端 `write_drafts` 也还留着它：

```
published_at 1794931352216  (11-18 00:02:32)
updated_at   1794931354679  (11-18 00:02:34)   ← 比发布晚 2463ms
deleted_at   0
```

2463ms 正好是 2.5 秒的自动保存防抖。老版本点完「发布」后只给草稿打了 `publishedAt` 就把人留在编辑器里，那个还在跑的防抖定时器随后落了一次盘，把 `updatedAt` 顶到发布之后两秒多。于是第 17 节的判据 `updatedAt <= publishedAt` 一次都没命中——**几乎每一篇**都会差这么一两秒。它没被清掉，就只能一直挂在列表里标「更新中」，还会被云同步带到其它设备。

改了三处：

- **判据给宽限。** 抽 `isPublishedStale()`：有 `edit`、有 `publishedAt`，且 `updatedAt - publishedAt <= 60s` 就算「发布尾巴留下的壳」。一分钟足够覆盖自动保存的尾巴；真过了一分钟还在动笔，那才是待更新的草稿，留着。
- **云端也别再拉回来。** `adoptRemote()` 的 `!local` 分支先过一遍 `isPublishedStale()`，命中的直接 `dropRemote()` 钉墓碑，不再 unshift 进本地列表（否则每次拉取都会先冒出来再被清掉，来回闪）。
- **清理由「登录后」触发。** 原来在启动时调 `prunePublished()`，那时 `authed` 还是 false，`persist()` 直接返回 false、`scheduleSync()` 也返回，清了个寂寞还写不进盘。现在挪进 `unlockStore()`（`loadStore()` 之后），这会儿能落盘也能推墓碑。

顺带修掉一个会让删除丢掉的 bug：`runSync()` 开头是 `if (!authed || syncing) return`。上一趟请求还在路上时，这次调度就被**静默丢弃**，连队列都不留——而 `dropRemote()` 的墓碑只活在内存里，页面一关就没了，云端那篇永远删不掉、下次拉取又回来。现在 `syncing` 时只记 `syncPending = true` 并返回在途的 promise，落地后若有待办再补发一趟（失败则 5 秒后重试，不原地打转）。

线上那条残留数据已用 `UPDATE write_drafts SET deleted_at = … WHERE id = 'dmwkujdw1qeo3'` 标记删除（`GET` 只返回 `deleted_at = 0`，所有设备立刻都看不到；`updated_at` 同步顶到最新，旧客户端即便推上来也会被判负）。

## 19. 手机上的写作区：用满屏宽、回车即分段

**宽度。** 手机上 `--gut` 是 30px（行号列 20px + 10px 缝），标题、元信息、工具栏、正文全都按它缩进，390 宽的机器正文只剩 328px。行号在手机上一行挤成两三个视觉行时反而添乱，索性在 `@media (max-width:899px)` 里把 `--gut` 归零、`.gutter{display:none}`：正文左右各 16px（`--padl`），390 宽拿到 358px。桌面（≥900px）照旧留着行号列。`renderGutter()` 开头加了一句 `offsetParent` 判断——隐藏时直接返回，不用再逐行量高度；跨断点时 `resize` 里补一次 `scheduleGutter()`。

**回车即分段。** 以前正文里敲一下回车只是插一个 `\n`：textarea 里看不出间隔，发出去 Goldmark 又把上下两行并回同一段——正是用户说的「换了个寂寞」。

- `keydown` 拦下最朴素的回车（不带 shift/alt/ctrl、不在输入法合成中、`keyCode !== 229`），插入 `\n\n`：textarea 当场空出一行，Markdown 里就是两个段落。光标左右已有的换行先吃掉，所以连按两下也不会攒出一大片空白，一段之间最多空一行。
- 新增 `paragraphize()`：给「普通正文行」之间补空行，块级行不动——连续的列表项、连续引用、连续表格行不插（否则一张列表会被拆成好几段），标题/列表/引用/表格前后补上（否则 Goldmark 认不出块边界），围栏代码块内部整体跳过。函数幂等。
- 落在四处：`loadActive()`（老稿子打开就补齐，看到的就是发布后的间隔）、`renderPreview()`（所见即所发）、发布 payload 的 `content`、导出 `.md` 的 `markdownOf()`。

**没做的事。** `body` 仍是 textarea，没有换成 contenteditable——行号镜像、Markdown 工具栏的选区替换、撤销栈、自动撑高全都挂在 `.value` 和 `selectionStart` 上，换编辑器的回归面太大。现在这套用「空行」表达段间距，和最终 HTML 的 `<p>` 一一对应，视觉与结果都是对的。
