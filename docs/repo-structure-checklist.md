# 仓库结构检查表（第 2 版 · 主题内嵌后）

> 更新时间：2026-10-28 14:00
> 对应状态：`themes/ivy` 已内嵌进项目 + A/B/C 三档清理已执行（改动尚未提交）
> 校验方式：全仓库只读扫描（`git ls-files`、引用检索跨 `layouts/ content/ static/js/ static/admin/ .github/ scripts/`）+ 一次完整 `hugo` 构建（产物已删除）
> 版本：Hugo 0.160.1 extended / Windows

图例：✅ 在用 ｜ ⚠️ 在用但需要注意 ｜ 🔧 扩展点（空文件，故意保留）｜ ❌ 无引用

---

## 0. 全景：这是一个仓库装了五套系统

| 系统 | 目录 / 文件 | 部署方式 |
| --- | --- | --- |
| Hugo 静态站 | `content/` `layouts/` `static/` `assets/` `config.toml` | Vercel（GitHub push 自动构建） |
| 评论后端 | `worker/` + `wrangler.toml` | Cloudflare Workers + D1（`comments.hux.ink`） |
| Vercel 函数 | `api/` | Vercel Serverless（2 个，当前全仓库无引用） |
| 定时抓取 | `.github/workflows/` + `.github/scripts/` | GitHub Actions（6 条流水线） |
| 发布后台 SPA | `static/admin/` | 随站点发布，口令 + GitHub API 保护 |

**当前规模**

| 目录 | 文件数 | 体积 | 说明 |
| --- | --- | --- | --- |
| `content/` | 200 | 1.4M | 188 篇文章 + 12 个页面 |
| `layouts/` | 42 | 263K | 4477 行模板 |
| `static/` | 35 | 8.1M | 其中 `audio/` 6.5M、`memos.json` 533K |
| `assets/` | 7 | 2.0M | 其中 `activities.json` 1.2M、`rss.json` 483K |
| `worker/` | 6 | 132K | 评论后端源码 |
| `.github/` | 12 | 124K | 6 个 workflow + 5 个脚本 |
| `docs/` | 3 | 76K | 说明文档 |
| `api/` `scripts/` `tests/` | 2 / 3 / 3 | 52K | 辅助 |

仓库总体积 **13M**（不含 `.git` / `node_modules` / `public`）。

---

## 1. 与 Hugo 官方骨架的差异

官方 `hugo new project` 的骨架只有 9 项，且 **v0.146.0 起模板系统重写**：`_default/` 目录概念被移除，`partials/` → `_partials/`，`shortcodes/` → `_shortcodes/`，`index.html` → `home.html`，新增 `all.html` 兜底。旧命名靠兼容映射层继续工作。

| 官方（0.146+） | 本项目 | 影响构建 | 建议 |
| --- | --- | --- | --- |
| `layouts/_partials/` | `layouts/partials/`（22 个） | 否，legacy 映射 | 可迁移，见 §5 |
| `layouts/_shortcodes/` | `layouts/shortcodes/`（4 个） | 否 | 可迁移 |
| 页面模板直接放 `layouts/` 根 | `layouts/_default/`（16 个） | 否 | 可迁移 |
| `taxonomy.html` + `term.html` | `terms.html` 一个文件 | 否 | 迁移时注意语义 |
| `hugo.toml` | `config.toml` | 否，两者等价 | 可选 |
| `config/_default/*.toml` | 单文件 121 行，混装 8 类配置 | 否 | 可选 |
| `static/robots.txt` | 根目录 `robots.txt`（26B，`Disallow: /`） | 否——**根目录文件不会被拷贝** | 建议删除（见 P2-1） |
| `layouts/baseof.html` 兜底 | **无** | **是，潜在** | 建议补，见 P1-1 |
| `data/`、`i18n/` | 无 | 否，可选目录 | 不需要 |
| `themes/` | 已移除（内嵌） | 否 | 保持现状 |

**结论：Hugo 层面没有"必须改"的项。** 0.160.1 构建 235 页、零警告、零报错。上表的"可迁移"是为了不再依赖 legacy 映射，不是因为现在坏了。

---

## 2. 逐目录检查表

### 2.1 根目录

| 路径 | 用途 | 状态 | 能否改动 |
| --- | --- | --- | --- |
| `config.toml` | Hugo 站点配置（121 行：站点信息、菜单、params、markup、outputs） | ✅ | 可改，改后需回归 |
| `package.json` | 只有 5 个 `comments:*` 脚本 + devDep `wrangler` | ✅ | 可改 |
| `wrangler.toml` | Cloudflare Worker 配置（D1 绑定、环境变量） | 🔒 | 改前核对线上 secret |
| `vercel.json` | 仅 `/m/:id` → `/memo/` 两条 rewrite | ✅ | 可改 |
| `README.md` | 4 行，仅项目名 | ⚠️ 内容过少 | 可改 |
| `robots.txt` | 26 字节 `Disallow: /`，**Hugo 不拷贝根目录文件，线上不是这份** | ❌ | 删除或移进 `static/` |
| `.gitignore` | 忽略 `public`、`node_modules`、`.wrangler`、`.dev.vars`、`.hugo_build.lock` 等 | ✅ | 可改 |
| `.dev.vars.example` | 本地密钥模板（`wrangler dev` 用） | ✅ | 可改 |
| `.hugo_build.lock` | 构建锁，0 字节 | ⚠️ 已加 `.gitignore` 并 `git rm --cached`，**尚未提交** | — |
| `.vscode/settings.json` | 只有 `editor.fontSize` | ✅ | 可改 |
| `.github/` `.workbuddy/` `.preview/` `.wrangler/` | 见 §2.8 / 本地忽略目录 | — | — |

### 2.2 `content/`（200 个）

| 路径 | 绑定模板 | 线上路径 | 状态 |
| --- | --- | --- | --- |
| `_index.md` | `home.html` | `/` | ✅ |
| `about.md` | `single.html`（`layout: 'posts'`） | `/about/` | ✅ |
| `album.md` | `album.html` | `/album/` 光影 | ✅ |
| `archives.md` | `archives.html` | `/archives/` 归档 | ✅ |
| `bb.md` | `bbfocus.html` | `/bb/` 哔哔 | ✅ |
| `books.md` | `books.html` | `/books/` 阅读 | ✅ |
| `clip.md` | `clip.html` | `/clip/` 断章 | ✅ |
| `exercise.md` | `exercise.html` | `/exercise/` 悦动 | ✅ |
| `footprints.md` | `footprintmap.html` | `/footprints/` 足迹 | ✅ |
| `memo.md` | `memo-single.html` | `/memo/` | ✅ |
| `movies.md` | `movies.html` | `/movies/` 观影 | ✅ |
| `recent.md` | `friend.html`（`layout: "friend"`） | `/recent/` 订阅近况 | ✅ |
| `posts/` 顶层 `.md` | `single.html` | `/posts/:slug/`（permalink 拍平） | ✅ 147 篇 |
| `posts/notion/` | 同上 | 同上 | ✅ 31 篇，Notion 同步来源 |
| `posts/obsidian/` | 同上 | 同上 | ✅ 10 篇，Obsidian 来源 |

> `posts/notion` 与 `posts/obsidian` 是按**来源**分的物理目录，permalink 已拍平所以 URL 不受影响。新增文章建议统一放 `content/posts/` 顶层，把来源记在 front matter 里。

### 2.3 `layouts/`（42 个 / 4477 行）

**页面模板（16 个）**

| 文件 | 行数 | 渲染 | 依赖的 partial | 状态 |
| --- | --- | --- | --- | --- |
| `404.html` | 31 | 404 页 | header, footer | ✅ |
| `_default/home.html` | 11 | `/` | header, latest-posts, recent-memo, footer-cus | ✅ |
| `_default/list.html` | 23 | `/posts/`、`/tags/<tag>/`、`/categories/<cat>/` | header, footer-cus | ✅ |
| `_default/terms.html` | 14 | `/tags/`、`/categories/` 索引 | header, footer | ✅ |
| `_default/single.html` | 43 | 所有文章 | header, toc, footer | ✅ |
| `_default/album.html` | 587 | `/album/` | header | ⚠️ 未闭合 `</body>` |
| `_default/archives.html` | 109 | `/archives/` | header, heatmap, footer-cus | ✅ |
| `_default/bbfocus.html` | 86 | `/bb/` | header, comments/*, footer-empty | ✅ |
| `_default/books.html` | 237 | `/books/` | header | ⚠️ 未闭合 |
| `_default/clip.html` | 1030 | `/clip/` | header | ⚠️ 未闭合 |
| `_default/exercise.html` | 814 | `/exercise/` | header | ⚠️ 未闭合 |
| `_default/footprintmap.html` | 22 | `/footprints/` | header | ⚠️ 未闭合 |
| `_default/friend.html` | 18 | `/recent/` | header | ⚠️ 未闭合 |
| `_default/memo-single.html` | 24 | `/memo/` | header, comments/* | ⚠️ 未闭合 |
| `_default/movies.html` | 244 | `/movies/` | header | ⚠️ 未闭合 |
| `_default/rss.xml` | 49 | `/index.xml` 等 | — | ✅ |

> "未闭合"见 §4 P2-2：8 个模板只有 `header.html`（它负责开 `<body>`），没有对应的收尾，产物里 `</body></html>` 缺失。浏览器会自动纠正，所以肉眼看不出问题。

**Partials（22 个）**

| 文件 | 行数 | 被谁调用 | 用途 | 状态 |
| --- | --- | --- | --- | --- |
| `header.html` | 141 | 全部 16 个页面模板 | `<!DOCTYPE>` + `<head>` + 样式 + 导航 + 开 `<body>` | 🔒 全站骨架 |
| `footer.html` | 75 | 404, single, terms | 主体页脚 + 远程 waterfall/imgStatus + 内部 GA | ⚠️ 依赖第三方 |
| `footer-cus.html` | 39 | home, list, archives | 列表类页脚 | ✅ |
| `footer-empty.html` | 4 | bbfocus | 只闭合 `</article></body></html>` + GA | ✅ 补闭合就靠它 |
| `foot_custom.html` | 15 | footer, footer-cus | 页脚自定义内容（备案号等） | ✅ |
| `head_custom.html` | 0 | header | **空文件，head 扩展点** | 🔧 |
| `menu_extra.html` | 0 | menu | **空文件，菜单扩展点** | 🔧 |
| `menu.html` | 37 | header | 主导航（6 项：哔哔/归档/光影/悦动/断章/关于） | ✅ |
| `meta.html` | 5 | header | 文章元信息 | ✅ |
| `tagline.html` | 34 | header | 站点副标题 | ✅ |
| `latest-posts.html` | 51 | home | 首页最新文章 | ✅ |
| `recent-memo.html` | 125 | home | 首页哔哔流（marked.js 渲染） | ✅ |
| `heatmap.html` | 277 | archives | 归档页年度热力图 | ✅ |
| `toc.html` | 14 | single | 文章目录 | ✅ |
| `head_highlightjs.html` | 6 | **header（不带 `.html` 后缀调用）** | 代码高亮 CSS | ⚠️ 见 P1-2 |
| `footer_highlightjs.html` | 12 | **footer、footer-cus（同上）** | 代码高亮 JS | ⚠️ 见 P1-2 |
| `comments.html` | 43 | 评论页 | 评论区容器，按环境选新系统/旧 Twikoo | ✅ |
| `comments/enabled.html` | 10 | comments, recent-memo, bbfocus | 判断是否启用新评论（dev 恒真） | ✅ |
| `comments/api.html` | 19 | comments 等 3 处 | 注入 API 地址 | ✅ |
| `comments/admin-hash.html` | 12 | comments 等 3 处 | 输出 `sha256(博主邮箱)` 供前端识别博主 | ✅ |
| `comments/avatar.html` | 8 | comments 等 3 处 | 头像 URL 生成 | ✅ |
| `comments/turnstile.html` | 6 | comments 等 3 处 | Cloudflare Turnstile 人机验证（可选） | ✅ |

> **两个空文件（`head_custom.html`、`menu_extra.html`）不是垃圾**，是主题预留的扩展钩子，保持为空即可。

**Shortcodes（4 个）**

| 文件 | 行数 | 被引用次数 | 用途 |
| --- | --- | --- | --- |
| `douban.html` | 50 | 7 篇 | 豆瓣书影音卡片 |
| `audio.html` | 67 | 1 篇 | 音频播放器（`two-work-notes.mp3`） |
| `books.html` | 43 | 1 篇（about.md） | 读书墙 |
| `movies.html` | 42 | 1 篇（about.md） | 观影墙 |

> 上一版清单里 6 个"零调用"的 shortcode（album/gallery/figure/link/memos/music）已随主题内嵌一起删除，正文确认零使用。

### 2.4 `static/`（35 个 / 8.1M）

**根目录 4 个**

| 文件 | 大小 | 消费者 | 状态 |
| --- | --- | --- | --- |
| `memos.json` | 533K | 首页 `recent-memo`、`album`、`bbfocus`、后台；由 CI `fetch-memos.js` 生成 | ✅ **勿手改** |
| `friends.json` | 9K | 后台「订阅管理」页（读写 GitHub）+ CI `fetch-friend-circle.py`（生成 `assets/rss.json`） | ✅ **勿手改** |
| `favi.ico` | 15K | `friend.html` 的 `error_img`、`friendcircle-local.js` 兜底头像 | ✅ |
| `favicon.ico` | 9K | 浏览器自动请求 `/favicon.ico`（页面**没有** `<link rel="icon">`） | ✅ |

**`static/css/`（5 个 / 117K）** — 由 `header.html` 硬编码引入（第 17/78/80 行附近）

| 文件 | 大小 | 用途 |
| --- | --- | --- |
| `style.css` | 21K | 主样式 |
| `custom.css` | 22K | 站内自定义覆盖（改动最多的地方） |
| `palettes.css` | 27K | 配色方案 |
| `fonts.css` | 0K | 字体声明 |
| `comments.css` | 36K | 评论系统样式 |

**`static/js/`（20 个 / 416K）**

| 文件 | 大小 | 消费者 | 用途 |
| --- | --- | --- | --- |
| `comments.js` | 80K | comments, recent-memo, bbfocus, memo-single | 新评论系统前端（含博主识别、频率限制提示） |
| `bb-comments.js` | 13K | 同上 3 处 | 哔哔评论 UI |
| `bb-home.js` | 21K | recent-memo | 哔哔流渲染 |
| `bb-focus.js` | 17K | bbfocus | 哔哔整页视图 |
| `emaction.js` | 31K | recent-memo, bbfocus | 表情反应 |
| `exercise-ui.js` | 54K | exercise | 悦动页 UI |
| `exercise-map.js` | 28K | exercise | Mapbox 轨迹图 |
| `footprintmap.js` | 25K | footprintmap | 足迹地图 |
| `footprintmap.css` | 11K | footprintmap | 足迹地图样式（**CSS 放在 js 目录里**） |
| `friendcircle-local.js` | 7K | friend | 订阅近况（读 `assets/rss.json`） |
| `fclite.min.css` | 9K | friend | 同上样式（**CSS 放在 js 目录里**） |
| `marked.min.js` | 35K | 5 个模板 | Markdown 渲染（第三方） |
| `lately.min.js` | 3K | 4 个模板 | 相对时间（第三方） |
| `view-image.min.js` | 7K | 4 个模板 | 图片灯箱 **v2.0.2** |
| `view-image.js` | 7K | header、后台 | 图片灯箱 **v2.0.1**（旧版，见 P1-3） |
| `post-image-trigger.js` | 5K | single、后台 | 图片点击放大绑定 |
| `post-justified-gallery.js` | 6K | single, memo-single | 图片瀑布布局 |
| `poster-review.js` | 3K | header | 海报预览 |
| `font-switcher.js` | 2K | header | 字体切换 |
| `palette-switcher.js` | 2K | header | 配色切换 |

**`static/admin/`（5 个 / 553K）**

| 文件 | 大小 | 用途 | 状态 |
| --- | --- | --- | --- |
| `index.html` | 516K / 8986 行 | 后台 SPA 全量内联（发布、订阅、评论管理；含一套已死的 garden 编辑器） | ⚠️ 单文件巨石，见 P1-4 |
| `comments.html` | 18K | 独立的评论管理页 | ✅ |
| `sw.js` | 1K | Service Worker | ✅ |
| `manifest.webmanifest` | 1K | PWA 清单 | ✅ |
| `icon.svg` | 328B | PWA 图标 | ✅ |

**`static/audio/`（1 个 / 6.5M）**

| 文件 | 用途 |
| --- | --- |
| `two-work-notes.mp3` | 文章《2025-12-09 一键生成AI播客》的音频 |

> 单个文件占全仓库一半体积。若文章不再需要，是最大的一笔可回收空间。

### 2.5 `assets/`（7 个 / 2.0M）

| 文件 | 大小 | 消费者 | 说明 |
| --- | --- | --- | --- |
| `rss.json` | 483K | `friend.html`（`resources.Get`） | 友链朋友圈数据，CI 由 `friends.json` 生成 |
| `activities.json` | 1.2M | `exercise.html` | 运动记录，CI 同步 |
| `act.json` | 14K | `exercise.html` | 活动类型字典 |
| `activity-name-overrides.json` | 879B | `exercise.html` | 活动名称覆盖表 |
| `footprints.json` | 17K | `footprintmap.html` | 足迹数据 |
| `data/douban/book.csv` | — | `books.html`、`douban` shortcode | 阅读数据，CI `douban.yml` 生成 |
| `data/douban/movie.csv` | — | `movies.html`、`douban` shortcode | 观影数据，同上 |

> `data/douban/`（Hugo 的 `data/` 目录版本）已删除——它和 `assets/data/douban/` 重复且内容已分叉，模板只读 `assets` 那份。

### 2.6 `worker/`（6 个 / 132K）— 评论后端

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `src/index.js` | 路由 + 鉴权（admin 只认邮箱匹配）+ 输入校验 | 🔒 |
| `src/service.js` | 业务逻辑：发评论即 approved、垃圾分 ≥5 静默丢弃、双频限流（30s×3 / 1h×10） | 🔒 |
| `src/db.js` | D1 读写 + `ensureSchema()` 一次性迁移标记 | 🔒 |
| `src/mail.js` | Resend 通知邮件模板（信纸风） | 🔒 |
| `src/util.js` | 工具函数（哈希、校验、时间） | 🔒 |
| `schema.sql` | D1 建表语句 | 🔒 改表要写迁移 |

### 2.7 `api/`、`scripts/`、`tests/`

| 路径 | 用途 | 状态 |
| --- | --- | --- |
| `api/sync-sports.js` | Vercel 函数：同步运动数据 | ❌ 全仓库零引用，6 个 workflow 都不调它 |
| `api/trigger-notion.js` | Vercel 函数：触发 Notion 同步 | ❌ 同上 |
| `scripts/comments-export.mjs` | 导出 D1 评论（`npm run comments:export`） | ✅ |
| `scripts/import-twikoo.mjs` | 从 Twikoo 迁移评论到 D1（一次性） | ⚠️ 历史脚本 |
| `scripts/preview-mail.mjs` | 本地渲染邮件模板到 `.preview/` | ✅ |
| `tests/admin-heic-upload.cjs` | 后台 HEIC 上传逻辑单测（Node `vm`，无外部依赖） | ✅ |
| `tests/admin-mobile-regressions.cjs` | 后台移动端回归 | ✅ |
| `tests/admin-post-save.cjs` | 后台发文保存 | ✅ |

> 上一版清单说"tests 依赖 playwright-core 但未声明"——**这是错的**，三个测试只用 `node:assert/fs/vm/path`，无需额外依赖。

### 2.8 `.github/`（12 个）

| 文件 | 触发 | 产物 |
| --- | --- | --- |
| `workflows/fetch-memos.yml` | 定时 / 手动 | `static/memos.json` |
| `workflows/fetch-friend-circle.yml` | `static/friends.json` 变更 | `assets/rss.json` |
| `workflows/douban.yml` | 定时 | `assets/data/douban/*.csv` |
| `workflows/sync-activities-from-workoutpage.yml` | 定时 | `assets/activities.json` |
| `workflows/Notion-to-Hugo.yml` | 定时 | `content/posts/notion/*` |
| `workflows/Notion-sports-to-Hugo.yml` | 定时 | 运动数据 + 海报 |
| `scripts/fetch-memos.js` | 被上面调用 | — |
| `scripts/fetch-friend-circle.py` | 同上 | — |
| `scripts/sync_notion-sports.py` | 同上 | — |
| `scripts/update_poster.py` | 同上 | 豆瓣封面缓存 |
| `scripts/upload_r2.py` | 同上 | 图片上传 R2 |
| `cache/douban-poster-cache.json` | — | 海报缓存 |

> 6 条流水线写 6 个不同产物，**改动这些数据文件前先确认是不是 CI 生成的**，否则下次跑就被覆盖。

### 2.9 `docs/`（3 个）

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `comment-system.md` | 866 | 评论系统完整文档（架构、部署、secret、接口） |
| `repo-structure-checklist.md` | — | 本文件 |
| `licenses/ivy-LICENSE.md` | 24 | 原 ivy 主题许可（Unlicense/公有领域），内嵌后保留 |

---

## 3. 本轮已删除，不要复原

| 已删除 | 原因 |
| --- | --- |
| `themes/ivy/`（73 个文件） | 已内嵌为项目级 `layouts/` + `static/`，41 个文件逐字节一致 |
| `config.toml` 的 `theme = "ivy"` | 同上 |
| `static/js/bb.js` `bbb.js` `search.js` `fastsearch.js` `fuse.basic.min.js` `html-to-image.min.js` `friendcircle.js` `bb-lmm-mk.js` `waterfall.min.js` `imgStatus.min.js` | 产物引用数为 0（`waterfall`/`imgStatus` 走远程 `immmmm.com`） |
| `static/js/twikoo.all.min.js`（545K） | 旧评论系统已下线，只出现在不可达的 `else` 分支 |
| `static/memos/memos.js`、`static/memos/memos.json` | 零引用（数据在 `static/memos.json`） |
| `static/memos-recent.json`、`static/memos-random.json` | 零引用 |
| `static/images/`（5 张 / 2.86M） | 零引用（模板与全部正文均未使用） |
| `static/photos/`（2 张 / 252K） | 零引用（相册读 `memos.json`） |
| `data/douban/*.csv` | 与 `assets/data/douban/` 重复且分叉，模板只读 assets 版 |
| `content/search.md` + `layouts/_default/search.html` | 本地搜索下线（站点无任何入口链接） |
| `layouts/_default/index.json` + `[outputs] home` 的 `JSON` | 搜索数据源，唯一消费者已删，每次构建省 796K |
| `layouts/_default/baseof.html`、`layouts/partials/head.html` | 主题内死代码（无模板使用 `define`/`block`）。**代价见 P1-1** |
| 6 个零调用 shortcode、6 个未使用布局、2 个死 partial | 随主题内嵌清理 |

**已恢复、不要误删**：`static/friends.json`（后台 + CI 在用）、`layouts/partials/head_highlightjs.html`、`layouts/partials/footer_highlightjs.html`（被不带 `.html` 后缀调用）。

---

## 4. 遗留问题

### P1（会造成实际困扰）

**P1-1｜没有 `baseof.html` 兜底，`define` 风格模板会静默白屏**
Hugo 的规则：模板里写 `{{ define "main" }}` 而没有 `baseof.html` 时，**不报错，输出空白页**（已实测）。当前主题所有模板都是"`header.html` 开头 + `footer.html` 收尾"的独立式，所以暂时没事。但以后任何人写一个 define 风格模板就会掉坑，且构建零警告。
修法：新增 12 行 `layouts/_default/baseof.html`：
```gotemplate
{{ partial "header.html" . }}
<main class="main">{{ block "main" . }}{{ end }}</main>
{{ partial "footer.html" . }}
```
（`header.html` 负责开 `<body>`、`footer.html` 负责闭合，两者配平。）

**P1-2｜两个 `highlightjs` partial 是被"不带扩展名"的方式调用的**
`header.html:77` 是 `{{ partial "head_highlightjs" . }}`、`footer.html:66` 是 `{{ partial "footer_highlightjs" . }}`，**没有 `.html` 后缀**。用 `grep '"xxx.html"'` 统计引用会得到 0，误删后构建直接失败。维护时用：`grep -rn 'partial "head_highlightjs' layouts/`。

**P1-3｜`view-image` 两份并存且版本不同**
`view-image.js` 是 v2.0.1（`header.html` 与后台用），`view-image.min.js` 是 v2.0.2（4 个模板用），差异是工具栏底色 `rgba(255,255,255,0.1)` → `rgba(0,0,0,0.1)`（新版权威更深、对比更好）。建议统一到 2.0.2：删 `view-image.js`，把 `header.html:36` 和 `static/admin/index.html` 的引用改成 `.min.js`。

**P1-4｜`static/admin/index.html` 516K / 8986 行单文件**
内含两套并行编辑器（新版 `renderEditor` + 旧版 `gardenRenderEditor`，`garden` 字样出现 330 次），旧版无导航入口但底层函数仍被新版复用。想删删不掉、改容易改错。属于单独一轮重构，需后台回归测试。

**P1-5｜页脚依赖第三方域名**
`footer.html` 第 2-3 行从 `https://immmmm.com/` 加载 `waterfall.min.js` 与 `imgStatus.min.js`，**190 个页面都请求**。该站不可用则相册瀑布流与图片懒加载失效（实测当前 200 / 0.56-0.77s）。本地副本已在本次清理中删除，自托管需从 git 恢复：`git show HEAD:themes/ivy/static/js/waterfall.min.js > static/js/waterfall.min.js`（`imgStatus` 同理），再改 `footer.html` 两行路径。

### P2（整洁性）

**P2-1｜根目录 `robots.txt` 是死文件**
26 字节 `Disallow: /`，与线上实际返回的 Cloudflare 内容信号策略完全相反。Hugo 不拷贝根目录文件，所以它永远不生效。删掉，或挪进 `static/robots.txt`（挪进去就会真的生效，屏蔽全站——如果要保留那份 `Disallow` 请三思）。

**P2-2｜8 个页面模板没有闭合 `</body></html>`**
`album` `books` `clip` `exercise` `footprintmap` `friend` `memo-single` `movies` 只调用 `header.html`（它开了 `<body>`），没有收尾。产物里确实缺 `</body></html>`，浏览器会自动纠正所以看不出问题，但不符合 HTML 规范，也拿不到 footer 里的 GA。
修法：每个模板末尾加一行收尾 partial。`footer-empty.html` 现成可用，但它开头有一行 `</article>`，对没有 `<article>` 的页面会多出游离闭合标签（浏览器忽略，不合规范）。更干净的是新建 4 行 `layouts/partials/footer-close.html`，只输出：
```gotemplate
  {{ template "_internal/google_analytics.html" . }}
  </body>
</html>
```
然后在 8 个模板末尾各加 `{{ partial "footer-close.html" . }}`。

**P2-3｜CSS 散落在 `static/js/`**
`footprintmap.css`、`fclite.min.css` 在 `js/` 目录里。移到 `static/css/` 更合理，但要同步改 2 个模板。

**P2-4｜`config.toml` 单体 121 行**
混装站点信息、菜单、params（评论/主题/高亮）、markup、outputs。可拆成 `config/_default/{hugo,params,menus,markup,outputs}.toml`。纯整理，无功能收益。

**P2-5｜`README.md` 只有 4 行**
建议至少写清：本地预览命令（`hugo server`）、部署方式（push → Vercel）、评论后端部署（`npm run comments:deploy`）、六个 CI 各自写什么文件。

**P2-6｜`api/` 两个 Vercel 函数零引用**
`sync-sports.js`、`trigger-notion.js` 全仓库无引用、无文档，6 个 workflow 也不调。先去 Vercel 控制台看有没有外部定时任务在调用，没有就删。

**P2-7｜文件名历史遗留**
`content/posts/` 里有 `2023-02-29 审计军火库.md`（2023 无闰日）、`2023-01-01 Hello,Hugo.md`（逗号）、`2024-11-30 Now in Nov..md`（双点）。slug 已由 front matter 决定，改名不影响 URL，但搜索排序会受影响，属低优先。

---

## 5. 可选：迁移到 0.146+ 新命名

**要不要做**：现在不做也能正常构建（legacy 映射层），做的价值是不依赖未来可能移除的兼容层，且文件位置能和官方文档一一对应。

**改什么**

```bash
git mv layouts/partials   layouts/_partials
git mv layouts/shortcodes layouts/_shortcodes
git mv layouts/_default/*.html layouts/            # 16 个页面模板上移
git mv layouts/_default/rss.xml layouts/rss.xml
rmdir layouts/_default
git mv layouts/terms.html layouts/taxonomy.html    # 语义对齐：terms.html 不是新系统标识符
```

**必须验证**（改完立刻做，否则 `/tags/` 可能悄悄换成 `list.html` 渲染）：

1. `hugo` 构建零警告
2. 产物文件清单与改前完全一致（应无增无减）
3. `/tags/`、`/tags/<任一标签>/`、`/posts/`、`/`、任一文章页、`/index.xml` 逐字节一致

**不建议现在做**：`config.toml` → `hugo.toml` 改名（功能等价，且 `docs/comment-system.md` 有引用）、`layouts/` 按页面路径分区（本站页面少，分区反而更难找）。

---

## 6. 附：可复用的验收命令

```bash
# 1) 构建到临时目录，不看 public
hugo -d /tmp/hugo-check --cleanDestinationDir

# 2) 与某个基线比对（改动前后各跑一次，比目录清单 + 逐页内容）
diff <(cd /tmp/base && find . -type f | sort) <(cd /tmp/hugo-check && find . -type f | sort)

# 3) 逐页内容比对（忽略 Windows 的 CRLF 与语言标记）
for f in $(cd /tmp/base && find . -name '*.html'); do
  diff -q <(tr -d '\r' </tmp/hugo-check/$f | sed 's/lang="zh-cn"/lang="en-us"/g') <(tr -d '\r' </tmp/base/$f) >/dev/null || echo "DIFF $f"
done

# 4) 判断某个 partial 到底有没有人用（务必同时匹配带/不带扩展名）
grep -rn 'partial *"name-of-partial' layouts/

# 5) 判断某个静态文件有没有人用（务必连后台与 CI 一起查）
grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=public \
  'file-name' layouts/ content/ static/js/ static/admin/ .github/ scripts/ tests/
```
