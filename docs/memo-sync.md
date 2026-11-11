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
