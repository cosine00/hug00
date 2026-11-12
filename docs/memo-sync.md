# 哔哔同步链路（FlareMo → 博客）

从 2026-10-29 起，哔哔数据源从自建 Memos（`i.hux.ink:5233`）切换到 FlareMo（`drafts.hux.ink`）。

## 数据流

```
FlareMo (Cloudflare Workers + D1 + R2)
   │  GET /api/v1/memos?pageSize=50&pageToken=…        Bearer memos_pat_…
   ├─ 正文 content ────────────────────────────────┐
   │                                               │
   └─ attachments[]                                 │
        │  GET /file/attachments/{id}/{filename}    │  需要鉴权，博客拿不到
        ├─ 转存 → R2 img.hux.ink ──→ resourceList ──┤
        │                                          ▼
        └─────────────────────────── static/memos.json
                                            │
        ┌───────────────────────────────────┼──────────────────────┐
        ▼                ▼                  ▼                      ▼
    首页最近哔哔      哔哔页 /bb/         相册 /album/          剪藏 /clip/
   (bb-home.js)    (bb-focus.js)      (album.html)          (clip.html)
                                            │
                                            ▼
                                  影彩 /album/#video
                                  (scripts/sync-videos.mjs → data/videos.json)
```

`static/memos.json` 是唯一产物，格式与旧版保持同构：

```json
[{ "id": "1234 或 UUID", "content": "…", "createdTs": 1793063771,
   "resourceList": [ { "id", "creatorId", "createdTs", "updatedTs",
                       "filename", "externalLink", "type", "size" } ],
   "tags": ["人间流浪"] }]
```

按 `createdTs` 降序。

## 单条事件同步（2026-11-12 起）

发布、编辑、删除、改可见性、改附件时，FlareMo 不再让博客重拉全库，而是用
`workflow_dispatch` 的 `memo_id` / `action` 传入「哪一条、什么动作」，博客只查这一条，
再合并进现有 `static/memos.json`。

```
FlareMo 写操作 ──► workflow_dispatch(memo_id=1276, action=upsert)
                        │
                        ▼
        GET /api/v1/memos/1276        ← 只读一条
                        │
        ┌───────────────┼────────────────────┐
        ▼               ▼                    ▼
   PUBLIC+NORMAL    其他 visibility/state   404
   upsert 进 JSON   remove 出 JSON         remove 出 JSON
        │
        └─ 401/403/5xx/超时/响应异常 → 直接失败，不改写文件
```

判定只看接口返回的**当前**状态，`action` 仅用于日志——同一条 Memo 连续编辑时，
较旧的 `upsert` 事件可能晚于 `PUBLIC→PRIVATE` 执行，此时应以接口结果为准移除。

| 场景 | 接口结果 | 处理 |
| --- | --- | --- |
| 新建公开 | 200 + PUBLIC + NORMAL | 追加，按 `createdTs` 降序 |
| 编辑公开 | 200 + PUBLIC + NORMAL | 按 id 原位替换 |
| 公开→私密/受保护 | 200 + PRIVATE/PROTECTED | 移除 |
| 移入回收站 | 200 + state=TRASHED | 移除 |
| 恢复 | 200 + 恢复后的状态 | 公开则写回，否则移除 |
| 彻底删除 | 404 | 移除 |
| 改/加/删附件 | 200 + attachments[] | 重新生成该条 `resourceList`，仍走 R2 转存 |
| 鉴权失败/5xx/超时 | 401/403/5xx/网络错误 | 失败退出，保留旧文件，等每日全量兜底 |

拿不到 `memo_id` 的事件（Connect 二进制响应、附件删除这类响应里没有父 Memo 的写入）
会退回全量同步，不会静默跳过。

### 并发

`concurrency.group` 按 `memo_id` 分组：不同 Memo 的事件并行执行，同一条 Memo 的连续
编辑只保留最新一次待运行任务（每次都重新读接口，最后落盘的一定是最新状态）。

提交步骤在推送被拒时会 `git fetch` + `git reset --hard` 回到最新基线后**重放**本次同步，
而不是合并两份 JSON —— 脚本本身幂等，重放三次仍失败则整次运行失败，留给下一次事件或
每日全量。每日 03:17 的定时全量不带 `memo_id`，仍然是完整重建，用于核对删除与可见性漏报。

### 手动执行

- 全量：Actions → Fetch Memos → Run workflow，`memo_id` 留空。
- 单条补同步：同上，填 `memo_id=1276`（`action` 可留空）。

### 性能

一次普通事件 = 1 次单条查询（D1 实测 rows_read ≈ 5 行），不再是 24 页、约 3.4 万行。

## 两种图片来源

| 来源 | 存在哪里 | 谁渲染 |
| --- | --- | --- |
| `resourceList[].externalLink` | 图床 `img.hux.ink`，由本脚本转存 | 首页、哔哔页、相册、评论管理 |
| 正文里的 `![](url)` | 由图床直链，导入 Memos 时已内联 | 首页、哔哔页、相册（均有 markdown 图片解析） |

FlareMo 新上传的图走**第一种**：文件存在 FlareMo 自己的 R2，只有 `/file/attachments/{id}/{filename}` 这一个读法，且必须带 PAT 或 share_token。博客是匿名静态页，所以脚本必须先把附件转存到自己的图床，再把外链写进 `resourceList`。

历史那 579 张图走**第二种**：当年从 Memos 导入时附件被改写成正文里的 markdown 图片，URL 已经指向 `img.hux.ink`，所以不用转存。

> 不要在 `resourceList` 里重复塞正文已经内联过的图，前端会渲染两次。

## 影彩（视频）

光影页的第二个页签「影彩」不是图片，而是 B 站视频。数据跟图片同源——只看 `#影彩` 标签，不看手工配置文件。

> 从需求迭代到上线踩坑的完整过程、验收清单与交接要点，见文末 **《影彩视频页：需求、实现与踩坑全记录》**。

在 Memos 里发一条：

```
vlog03 [青海湖喂个鸟](https://www.bilibili.com/video/BV1G4WU6pEwQ) #影彩
```

`scripts/sync-videos.mjs` 会：

1. 从 `static/memos.json` 筛出 `#影彩` 条目，正则取出链接、标题和 `vlogNN` 编号
2. 用 bvid 调 B 站 view 接口，补全时长、发布日、简介、横竖屏
3. 封面取 B 站图床的 `@1280w.webp` 压缩版（1.4MB → 约 190KB），传进 R2：`image/{yyyy}/{mm}/video-cover-{bvid}.webp`，仓库里不存图
4. 写出 `data/videos.json`（按发布日倒序）

`fetch-memos.yml` 已接上这一步，贴完链接等一次同步就行，不用手动跑。本地想自己跑：

```bash
R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_ENDPOINT=… R2_BUCKET=… R2_PUBLIC_DOMAIN=img.hux.ink \
  node scripts/sync-videos.mjs
```

### 机房 IP 被 412 时的行为（重要）

B 站对机房 IP 的风控很凶：`api.bilibili.com` 的 view 接口从 GitHub Actions 跑，三条视频全部 `B 站接口 412`，而同一个请求在本地家宽是 200。

所以脚本里做了三层兜底，顺序是：

1. 先取 `x/frontend/finger/spi` 拿 `buvid3`/`buvid4` 当 Cookie，带着再请求 view（命中率高一些），失败重试一次
2. 接口还不行就去抓视频页 HTML 的 `og:title` / `og:image`，至少把标题和封面拿回来，`cid`、时长、发布日从上次的结果补
3. 连页面都 412，就**整条沿用 `data/videos.json` 里的旧记录**

最后还有两条硬约束，防止自动化把页面写坏：

- 有新增视频拿不到元数据、本地又没有历史记录时，脚本**直接非 0 退出、不落盘**（`data/videos.json` 保持原样），要强行写入得加 `--allow-partial`
- 解析结果为空但旧文件里还有记录时，同样拒绝写入

`fetch-memos.yml` 里这一步挂了 `continue-on-error: true`，所以 B 站抽风不会连累 `memos.json` 的正常提交。

> 加新 vlog 时如果 Actions 那边一直拿不到元数据，本地跑一次 `node scripts/sync-videos.mjs` 再提交就行；封面地址已在 `img.hux.ink` 上会被认出来，不会重复上传。

没配图床凭据时会退化成 B 站直链（页面加了 `referrerpolicy="no-referrer"` 绕过防盗链），本地预览照样能看，只是封面没落到自己的图床。

> 手头没有 R2 的 S3 凭据、只登录了 wrangler 时，也可以用 `wrangler r2 object put` 单张补传（key 要和脚本一致）：
>
> ```bash
> npx wrangler r2 object put "image/image/2026/11/video-cover-BV1G4WU6pEwQ.webp" \
>   --file=cover.webp --content-type=image/webp --remote
> ```
>
> 传完把 `data/videos.json` 里的 `cover` / `coverHost` 改成 `https://img.hux.ink/…` 与 `img.hux.ink`，下次同步脚本认得这个前缀，不会重复上传。

### 播放：用 B 站官方的 HTML5 移动播放器页

站外播放器（`player.bilibili.com`）对未登录访客只给 **640×360**：把播放器放到 1280、1920 宽，或者调 `high_quality=1`，实测 `video.videoWidth` 始终是 640，改不动。360P 在视网膜屏上被放大 4 倍，就是一眼可见的糊。

改用 B 站给分享场景准备的另一个页面 `www.bilibili.com/blackboard/html5mobileplayer.html`：它认 `qn=64`，同一个视频在 iframe 里 `videoWidth` 实测 **1280**，是真 720P，界面也干净（没有「下载 App」浮层）。`album.html` 的 `embedURL()` 直接拼这个地址：

```
https://www.bilibili.com/blackboard/html5mobileplayer.html
  ?bvid=<BV 号>&cid=<cid>&qn=64&as_wide=1&high_quality=1&danmaku=0&autoplay=1
```

> **为什么不用直链**：曾经做过 `GET /api/bili?bvid=&cid=`，由 Worker 调 `playurl` 拿 720P 的 mp4 直链喂给原生 `<video>`。本地 `wrangler dev` 能成，但**部署到 Cloudflare 后必然 412**——B 站对机房 IP 段做了风控，`playurl` 和 `m.bilibili.com` 页面都返回 412，补 `buvid3` Cookie 也没用。Worker 里那段代码（两条降级路线：playurl → 页面 `__playinfo__`）留着没删，将来出口不被拦可以直接换回来；前端目前不再调用它。

> 720P 是游客天花板（1080P/4K 需要登录态）。页面本身不放「原片」入口，想更高清就去 B 站对应视频页（`data/videos.json` 里的 `url`）。

### 评论与哔哔共用一条线程

每条影彩的评论挂在它对应的那条哔哔下面，用的是同一个 thread key：`memo:<memoId>`（`memoId` 由同步脚本从 memos.json 带进 `data/videos.json`）。

- 在影彩里发的评论，去哔哔页同一条目下能看到，反之也一样
- 影彩条目上的小药丸显示的就是这条哔哔的评论数，`.cm-pill` 与哔哔页同一套样式
- 评论前端（`comments.js` + `comments.css`）在 `album.html` 里按 `params.comments.enable` 加载；本地 `hugo server` 会自动指向 `wrangler dev`
- 没有 `memoId` 的视频条目不显示评论入口（比如手工塞进 JSON 的条目）


## 运行

```bash
export FLAREMO_BASE=https://drafts.hux.ink
export FLAREMO_PAT=memos_pat_xxxx
export R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…
export R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
export R2_PUBLIC_DOMAIN=img.hux.ink
node .github/scripts/fetch-memos.js
```

只验证数据映射、不碰图床和正式文件：

```bash
DRY_RUN=1 node .github/scripts/fetch-memos.js   # 输出 static/memos.dryrun.json
```

### 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `FLAREMO_BASE` | 是 | — | 不带 `/api` 后缀 |
| `FLAREMO_PAT` | 是 | — | `memos_pat_` 开头；匿名读不到 PRIVATE 哔哔 |
| `FLAREMO_PAGE_SIZE` | 否 | 50 | **实测 ≥100 服务端返回 500**，脚本遇 5xx 会自动降半重试 |
| `MEMO_STATES` | 否 | `NORMAL` | 逗号分隔，用于排除回收站里的条目 |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | 转存必填 | — | 与 Notion 同步脚本共用 |
| `R2_ENDPOINT` | 转存必填 | — | `https://<account>.r2.cloudflarestorage.com`；也认 `R2_ACCOUNT_ID` |
| `R2_PUBLIC_DOMAIN` | 转存必填 | — | 例 `img.hux.ink`，可省略协议；也认 `R2_PUBLIC_URL` |
| `R2_PREFIX` | 否 | `images/{yyyy}/{mm}` | 与后台一致 |
| `DRY_RUN` | 否 | — | `1` 时不上传、不写正式文件 |

### GitHub Actions

`.github/workflows/fetch-memos.yml`：公开 Memo 新建、编辑、删除或附件变更时由 FlareMo 触发；每天北京时间 03:17 执行一次兜底；保留手动触发入口。需要在仓库 Secrets 里配：

`FLAREMO_PAT`（新增）

图床那五个（`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ENDPOINT`、`R2_BUCKET`、`R2_PUBLIC_DOMAIN`）与 Notion 同步脚本共用，仓库里已经配好，不用重复添加。`FLAREMO_BASE` 有代码内默认值，不配也行。

可选 Repository variable：`R2_PREFIX`。

## 附件缓存

`.github/scripts/memo-attachment-cache.json` 记录 `attachments/{id}` → 图床 URL 的映射，**必须随仓库提交**（workflow 的 `file_pattern` 已包含）。否则每轮定时任务都会把全部附件重新上传一遍。

缓存只在附件转存成功后写入，且逐个落盘，所以中途失败重跑不会产生重复文件。

## 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `HTTP 500` 且 `pageSize>=100` | 服务端分页上限 | 保持默认 50，脚本会自动降半重试 |
| `HTTP 401` | PAT 失效 / 被撤销 | 在 FlareMo 重新签发 `memos_pat_`，更新 secret |
| 拉到的条数明显少于 FlareMo 里看到的 | 哔哔是 PRIVATE 且用了匿名请求 | 必须带 PAT |
| 附件 401 | 下载没带 PAT | 检查 `request()` 是否走了带 Authorization 的分支 |
| 某条哔哔有图但博客没图 | 附件没转存成功 | 看日志里「没有拿到图床地址」的清单；脚本此时**不会**写 memos.json |
| 定时任务一直失败 | 脚本是 ESM（`package.json` 的 `type: module`） | 不要用 `require()`，已改为 `import` |

## 与旧 Memos 方案的差异

| | 旧（Memos） | 新（FlareMo） |
| --- | --- | --- |
| 端点 | `/api/v1/memo`（单数） | `/api/v1/memos`（复数） |
| 鉴权 | 无 | `Authorization: Bearer memos_pat_…` |
| 分页 | `limit` + `offset` | `pageSize` + `pageToken` |
| 时间字段 | `createdTs`（epoch 秒） | `createTime`（ISO 8601） |
| id | 数字 | 历史条目保留数字，新发的是 UUID |
| 附件 | `resourceList[].externalLink` 直接可用 | 独立 `attachments[]`，需下载后转存 |
| 标签 | 正文 `#标签` 正则提取 | 同上（保持产物格式稳定） |


## 公开可见性保护

博客同步只允许 `visibility === "PUBLIC"` 的 Memo 写入 `static/memos.json`。PRIVATE 和 PROTECTED 在附件转存前即被过滤，因此其正文和附件不会进入公开博客或 R2 图床。公开 Memo 改为私密、受保护或删除后，下一次同步会从 JSON、BB 页面和 RSS 中移除。

---

# 影彩视频页：需求、实现与踩坑全记录

> 2026-11-11 ~ 11-12，共 11 轮迭代。上面几节是「怎么用」，这一节是「为什么长成现在这样」——换电脑、隔几个月回来接手时，看这一节就够了。

## 一句话结论

`/album/` 现在有两个页签：**时光**（原相册，图片仍来自 `memos.json`）和 **影彩**（B 站视频，来自 `memos.json` 里的 `#影彩` 标签）。影彩的数据由 `scripts/sync-videos.mjs` 生成 `data/videos.json`，封面自动转存到 `img.hux.ink`，播放走 B 站 HTML5 移动播放器页拿 **1280×720**，每条视频的评论与它对应的那条哔哔共用 `memo:<id>` 线程，条目右上角是复刻「发生」页的幽灵编号。

## 一、需求是怎么一步步长出来的

| 轮次 | 你提的要求 | 落地结果 |
| --- | --- | --- |
| 1 | 在「光影」页加一个「视频」页签，三条 B 站视频先做效果，**本地预览、不要提交** | 双页签骨架 + 三张卡（当时是手写 `data/videos.yaml`） |
| 2 | ①封面太糊 ②页签样式/大小要和哔哔页「最近 / 好运」完全一致 ③占满整行的卡片要在**原位**播放，不要另弹浮层 | 缩略图缩到与源图匹配；页签数值直接照抄 `bbfocus`；删掉 modal，改行内展开播放器 |
| 3 | ①视频也走 `memos.json`，取 `#影彩` 标签、解析正文里的 B 站链接 ②封面不进仓库，自动上传 R2 图床 ③页签改名「相册→时光」「视频→影彩」 | 新增 `scripts/sync-videos.mjs`、`scripts/lib/r2.mjs`，产出 `data/videos.json`；删掉 `videos.yaml` 与 `assets/videos` |
| 4 | ①播放还是糊 ②相册悬停文字变成了图片文件名，应该是正文前 20 字 ③影彩排版能不能更协调 | 播放换成 720P 方案；`looksLikeFilename()` 回退正文；列表改「影单」行式 |
| 5 | ①缩略图占页面一半宽、高度自适应 ②每个条目加评论入口，与哔哔共用评论 id ③点页面空白收起播放器，不要「收起」按钮 ④去掉播放器右下角「原片」按钮和链接 | 缩略图 `flex: 0 0 50%`；评论挂 `memo:<id>` 线程；document 级点击收起；删掉整行 stage-foot |
| 6 | 把「发生」页条目的右上角大数字复刻过来，放 `vlogXX`，正文不要重复 | `.video-seq` 幽灵编号，取 `label` 里的数字，正文只剩日期 |
| 7 | 文字块改回垂直居中；日期和评论按钮平时不显示，播放时才出现 | `align-items: center`；`.video-foot` 默认 `display:none` |
| 8 | 播放时显示的日期、评论按钮要与缩略图**底部齐平** | foot 脱流，绝对定位 `bottom:0` |
| 9 | 鼠标悬停到条目上也要显示日期和评论 | 同一套规则包进 `@media (hover: hover)` |
| 10 | 右上角「B 站主页 ↗」换成蓝色小电视 icon | 用你给的官方 SVG，`viewBox` 收紧 |
| 11 | 主页哔哔排除 `#影彩`，**哔哔页保留** | `hiddenMemoTags` 生效，并刷新脚本版本号绕过缓存 |

第 1 轮用的三条片子（明月山 `BV1G8411P7vM`、新手上路 `BV1z44y1S7mx`、七娘山 `BV1gG4y1H72n`）只是效果样张，第 3 轮改成从哔哔解析后就删掉了。当前线上是：

| 编号 | 标题 | bvid | 时长 |
| --- | --- | --- | --- |
| VLOG 03 | 青海湖喂个鸟 | `BV1G4WU6pEwQ` | 0:32 |
| VLOG 02 | 山林探索·龙华樟坑郊野径 Oct.24 | `BV1Q4WU6HE5v` | 0:53 |
| VLOG 01 | 奔赴山海之深圳天文台 Nov.08 | `BV1ZdWU6aEo9` | 1:59 |

## 二、现在的结构：一次点击发生了什么

```
在 Memos 发：vlog04 [标题](https://www.bilibili.com/video/BVxxxx)  #影彩
      │
      ├─ fetch-memos.yml ──→ static/memos.json（正文 + tags）
      │        └─ Sync 影彩 videos ──→ data/videos.json
      │                 ├─ B 站 view 接口补元数据（时长/发布日/简介/横竖屏/cid）
      │                 └─ 封面 @1280w.webp ──→ R2 ──→ img.hux.ink/image/yyyy/mm/video-cover-BVxxx.webp
      │
      └─ Hugo 构建
               ├─ layouts/_default/album.html     页签 + 播放/评论脚本
               ├─ layouts/partials/video-list.html 列表结构（Hugo 模板只读 data/videos.json）
               └─ static/css/videos.css           全部样式
                        │
                        └─ 点击条目 → iframe: blackboard/html5mobileplayer.html?qn=64 → 真 720P
```

| 文件 | 职责 | 改它时要连带做什么 |
| --- | --- | --- |
| `data/videos.json` | 唯一数据产物，按发布日倒序 | 由脚本生成，别手改；改了要跑构建 |
| `layouts/partials/video-list.html` | 每条的结构：封面按钮、编号、标题、元信息、评论药丸、播放槽、评论面板 | 改结构多半要同步 `videos.css` |
| `layouts/_default/album.html` | 页签切换、深链、播放/收起、评论挂载 | 改样式要升 `videos.css?v=`；改脚本逻辑不用 |
| `static/css/videos.css` | 全部样式，四套配色走语义变量 | 改完必须升 `album.html` 里的 `?v=`（强缓存 5 天） |
| `scripts/sync-videos.mjs` | memos → B 站 → R2 → JSON | 改完先 `--dry` 跑一遍 |
| `scripts/lib/r2.mjs` | R2 的 S3 SigV4 PUT | 只认 `R2_*` 五个环境变量 |
| `worker/src/index.js` | 评论接口；`/api/bili` 保留但前端已不调用 | 改动要 `npm run comments:deploy` |
| `.github/workflows/fetch-memos.yml` | 定时/事件触发同步，影彩步骤 `continue-on-error` | 加 secret 时两边都要看 |

## 三、关键实现细节

### 3.1 页签与深链

- 两个 pill 按钮 `#tab-album` / `#tab-video`（`.media-tab` + `data-target`，容器 `.media-tabs` 带 `role="tablist"`），样式整套抄 `bbfocus`（`padding: 5px`、`gap: 8px`、按钮 `8px 28px`、`border-radius: 9999px`、`font: inherit`），实测容器 196×56.8、按钮 88×44.8，与哔哔页完全同尺寸。
- 深链：`/album/#video` 直接落到影彩，`#album` 落到时光；切换用 `history.replaceState`，不新增历史。左右方向键也能切。
- **相册是懒加载**：首次切到「时光」才去 fetch `memos.json`，避免看视频时白拉一千多条哔哔。
- 切页签会 `stopVideo()`，不会留后台声音。

### 3.2 一行一条的「影单」排版

- `.video-row` 是 flex 行；`.video-poster` 是按钮，`flex: 0 0 50%`，里面 `.video-thumb` 用 `aspect-ratio: 16/9` 自己撑高度（行宽 738px 时实测 369×208）。竖屏片子不按半幅算，改为固定高度 + `9/16`。
- 文字区 `.video-body` 垂直居中（`align-items: center`），标题 + 可选摘要。
- `.video-foot`（日期 + 评论药丸）**默认 `display:none`**，三种情况才出现：`.is-playing`（播放中）、`@media (hover:hover)` 下悬停、`.is-commenting`（评论面板开着）。出现时是绝对定位 `bottom:0`，而 `.video-body` 在该状态下 `align-self: stretch`（高度等于缩略图），所以**底边与缩略图精确齐平**，标题也不会被顶走。
- 编号 `.video-seq` 绝对定位在整行右上角，因此 `.video-row` 必须 `position: relative`，且它不能放进 `.video-body`（否则会跟着垂直居中浮到行中间）。

### 3.3 播放：为什么是 iframe，而不是原生 `<video>`

`embedURL()` 拼的是：

```
https://www.bilibili.com/blackboard/html5mobileplayer.html
  ?bvid=<BV 号>&cid=<cid>&qn=64&as_wide=1&high_quality=1&danmaku=0&autoplay=1
```

用 CDP 读 iframe 里的 `video.videoWidth` 实测 **1280**（真 720P），而 `player.bilibili.com` 那条路无论容器多宽、`high_quality=1` 怎么加，恒为 **640**。

交互约定：

- 点整行任意处（除评论药丸）即播；再点一次收起；`Esc` 收起；切页签收起。
- **点空白收起**是 document 级监听，白名单三处：`.video-stage`（播放器内）、`.video-row`（条目本身）、`.video-comments`（评论面板）。少了第三项，在评论框打字时播放器会被收掉。
- 播放器展开后若落在视口外，`requestAnimationFrame` 里做一次最小幅度的平滑滚动。

### 3.4 评论：与哔哔共用一条线程

- 同步脚本把哔哔的 `id` 写进 `videos.json` 的 `memoId`；前端用 `threadKey = "memo:" + memoId` 调 `window.Comments.mount()`，与哔哔页同一条线程，两边评论互通。
- 条数是批量拉的：`GET /api/comments/count?threads=memo:1,memo:2,…` 一次请求，不用逐条。
- 在影彩里发完评论，监听 `comments:created` 事件本地把计数 +1，不必重拉。
- 没有 `memoId` 的条目（比如手工塞进 JSON 的）不渲染评论入口。
- 评论面板打开时给条目加 `.is-commenting`，这样鼠标移开、甚至视频收起，入口仍然在——否则面板会悬在半空没有关闭按钮。

### 3.5 右上角编号

- 数字从 `label` 里正则取：`findRE \d+ ("VLOG 03")` → `03`；取不到才退回 `%02d` 序号。以后新增 vlog 不用改模板。
- 样式复刻「发生」页的 `.card-sequence`：Georgia 斜体、`line-height: 1`、颜色 `--border-strong` 40% 透明（深色配色下也看得见），桌面 `4rem`（64px）、窄屏 `1.9rem`。
- `aria-hidden` + `pointer-events: none`，纯装饰；播放中那一条会透出一点主题色，与缩略图的细边呼应。
- 标题右侧留白桌面 `5rem`、窄屏 `2.4rem`，长标题不会压到数字。

### 3.6 B 站小电视图标

- 用你提供的官方 SVG（`viewBox="0 0 1024 1024"` 三个 path，原生色 `#1296DB`）。
- 图形在 1024 画布里留白极大（实测 bbox x≈150、y≈127、w≈724、h≈770），直接 1:1 会缩得很小，所以把 `viewBox` 收紧成 `142 119 740 786`，CSS 只给 `height`（桌面 26px / 窄屏 22px），宽度自适应。
- 站点全局 `a:hover` 会把链接染成主题色，必须在 `.video-head-link:hover` 里**显式再写一遍 `color: #1296db`**，否则一悬停就变色。

### 3.7 主页隐藏影彩，哔哔页保留

- 过滤在 `static/js/bb-home.js`：`hiddenMemoTags = new Set(['相册', '影彩', 'clip'])`，`shouldHideMemo()` 会 trim、去 `#`、转小写再比。**必须先过滤再执行「Now」置顶**，否则被隐藏的条目还能被顶到首条。
- 哔哔页 `/bb/` 走的是另一个脚本 `bb-focus.js`，里面没有这段过滤，所以影彩条目在哔哔页正常显示。

## 四、踩过的坑（现象 → 根因 → 解法）

| # | 现象 | 根因 | 解法 |
| --- | --- | --- | --- |
| 1 | `brew install hugo` 装不上 | 沙箱拦网络/写入 | 下官方 `darwin-universal` 包解压到 `~/.local/hugo/hugo`（v0.145.0 extended） |
| 2 | 封面糊 | B 站源图本身只有 999px 宽，第二条更是 453×255 | 展示宽度收窄 + 取 `@1280w.webp` + q92；**453×255 那条只能重传高清封面**，任何前端手段都救不回来 |
| 3 | 页签比哔哔页扁 | 自己估的 padding | 直接照抄 `bbfocus` 数值，再用浏览器量测比对（196×56.8 / 88×44.8 / 16px） |
| 4 | 点开视频弹出一个浮层 | 第一版用了 modal | 你明确否掉，删 modal，改行内 `.video-stage` 展开 |
| 5 | 相册悬停文字变成 `IMG_1234.jpg` | `memos.json` 的 `alt` 有的是文件名 | 新增 `looksLikeFilename()`（`IMG_` 前缀 / UUID / 相机文件名）判定为文件名就丢弃，回退正文，截断 20 字 |
| 6 | 站外播放永远是 360P | `player.bilibili.com` 对未登录访客锁死 640×360，调任何参数无效 | CDP 读 `videoWidth` 证实后放弃这条路 |
| 7 | 改成 Worker 代取直链，本地好、线上必 412 | Cloudflare 出口 IP 被 B 站风控；补 `buvid3`、加 `Origin`/`Accept` 都无效 | 换 `blackboard/html5mobileplayer.html?qn=64`，`videoWidth=1280`，界面也干净 |
| 8 | GitHub Actions 上 `view` 接口 412，三条约全挂 | 裸请求没带 buvid（不是「机房 IP 一律封」） | 先打 `x/frontend/finger/spi` 拿 `buvid3/buvid4`，带 Cookie 再请求 → 200 |
| 9 | **线上影彩页突然空白约 20 分钟** | 三条都 412 时脚本仍写了 `[]` 并自动提交 | 见下一节「事故复盘」，已加两道硬保护 |
| 10 | `<button>` 里塞评论按钮，HTML 被截断 | button 不能嵌套 button | `.video-row` 从 `<button>` 改成 `<div>`，键盘可达性交给内部 `.video-poster` 按钮 |
| 11 | 日期/评论一出现就把标题顶走 | foot 在文档流里 | foot 脱流 `bottom:0` + body `align-self: stretch` |
| 12 | 编号跟着文字跑到行中间 | `.video-seq` 的定位基准是 `.video-body` | 挪到 `.video-row` 下，row 加 `position: relative` |
| 13 | 图标一悬停就变紫灰 | 站点全局 `a:hover` 无差别染色 | 显式 `.video-head-link:hover { color:#1296db }` |
| 14 | 主页过滤写了却不生效 | `/js/*` 是 `max-age=432000`（5 天），而引用还是旧 `?v=20261109-01` | 改脚本必须同步升 `?v=`（现在是 `20261112-02`） |
| 15 | `git push` 报 `RPC failed / curl 18` | 本机网络与 GitHub 的老毛病 | 别急着重推，先 `git ls-remote origin master` 确认——通常已经推上去了 |
| 16 | 批量改 commit message 时静默失败 | `git cherry-pick` 没有 `-q` 参数 | 去掉 `-q`；改完用 `git diff <旧 tip> HEAD` 验证树完全一致 |
| 17 | R2 前缀两个写法 | workflow 变量是 `image/{yyyy}/{mm}`，`fetch-memos.js` 默认 `images/{yyyy}/{mm}` | 影彩脚本跟随 workflow 变量；将来统一目录前先确认用哪个 |

## 五、事故复盘：`data/videos.json` 被写成 `[]`

这是整个过程中唯一一次「线上真的坏了」，值得单独记。

**发生了什么**：手动触发一次 `Fetch Memos`，B 站三条全部 412，脚本把「拿不到元数据」当成「没有视频」，写出 `data/videos.json: []` 并随 workflow 自动提交（`4b21c66`）。影彩页因此空白约 20 分钟。

**怎么发现的**：`gh run view … --log` 里三行 `✕ … B 站接口 412`，紧跟一行 `写出 data/videos.json：0 条`。

**恢复**：把工作区里的 `videos.json` 备份回滚，重新跑一次同步（此时已修好 Cookie），`gh api` 确认远端恢复 3 条，线上复查封面与播放。

**加固（现在的行为）**：

1. 元数据获取顺序：`spi` 拿 cookie → `view` → 裸请求重试 → 视频页 `og:title`/`og:image` 兜底 → 仍失败则**整条沿用旧记录**
2. 新增视频解析失败且本地无历史 → **exit 1，不落盘**（要强行写得加 `--allow-partial`）
3. 解析结果为空但旧文件里有记录 → **exit 1，不落盘**
4. workflow 里这一步 `continue-on-error: true`，B 站抽风不连累 `memos.json` 与 RSS 的提交

**教训**：凡是「抓取失败」和「真的没有数据」在数据结构上无法区分的脚本，都不能让失败路径写出空集合。

## 六、怎么验收（每次改完照着走一遍）

```bash
# 1. 构建不报错
~/.local/hugo/hugo --renderToMemory --quiet && echo BUILD_OK

# 2. 本地预览（另开一个终端）
~/.local/hugo/hugo server --port 1313 --bind 127.0.0.1 --disableFastRender --noHTTPCache
# 想本地测评论（计数/发帖）再开：npx wrangler dev --port 8787
# 注意：播放已不依赖 Worker，wrangler 只影响评论
```

浏览器里逐项看：

- 页签切换、`#video` / `#album` 深链、左右方向键
- 点条目播放，同时只存在一个播放器；换一条上一条自动停；`Esc`、点空白、切页签都能收
- 悬停某条，日期与「评论」药丸贴缩略图底边出现；移开消失；播放中一直显示
- 打开评论 → 鼠标移开入口仍在 → 再点关闭 → 移开才收起
- 移动端 390 / 360 宽：无横向溢出、标题不与编号重叠、元信息不换行
- 四套配色（paper / night / sepia / mist）下编号与图标都可见
- 控制台无报错

当前实测基线：桌面行宽 738 → 缩略图 369×208；编号 64px；播放器 1280×720；封面 `naturalWidth = 1280`；主页 6 条无 vlog、哔哔页 12 条含 3 条 vlog。

## 七、交接速查

**加一条新 vlog（日常唯一要做的事）**

1. 在 Memos 发：`vlog04 [标题](https://www.bilibili.com/video/BVxxxx) #影彩`
2. 等 `Fetch Memos` 跑完（或手动 `node scripts/sync-videos.mjs`），确认 `data/videos.json` 多了一条、`coverHost` 是 `img.hux.ink`
3. 提交 `data/videos.json`，Vercel 自动构建

**本地只验证 B 站解析、不传图床**

```bash
node scripts/sync-videos.mjs --dry      # 打印结果，不写文件
node scripts/sync-videos.mjs --force    # 忽略已有封面，全部重传
```

**部署评论 Worker（影彩评论、计数依赖它）**

```bash
npm run comments:deploy     # wrangler deploy，需先 npx wrangler login
```

**依赖的环境变量 / Secrets**

- `FLAREMO_PAT`（哔哔拉取）
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` / `R2_BUCKET` / `R2_PUBLIC_DOMAIN`（与 Notion 同步共用）
- 评论 Worker 的 D1 / Turnstile 等按 `worker/` 目录内说明
- `config.toml` 里 `[params.bilibili] mid`（右上角图标跳转地址）
- `config.toml` 的 `[params.videos]`（`api` / `localApi`）**已废弃**：播放改 iframe 后前端不再读它，留着只是免得回退原生 `<video>` 时再补；确认不回退就可以删

**已知取舍与遗留**

- `/api/bili` 仍留在 Worker 里但前端不再调用：Cloudflare 出口必 412。哪天出口不被拦，可以直接换回原生 `<video>`（代码还在）。
- 720P 是游客天花板，1080P / 4K 需要登录态；页面不放「原片」入口。
- 封面清晰度受限于 B 站源图；源图小于 1280 宽时无解，只能重传。
- 改 `static/js/*.js` 后必须同步改引用处的 `?v=`，否则 5 天强缓存会让改动看起来没生效。
