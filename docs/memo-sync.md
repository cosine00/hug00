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

`.github/workflows/fetch-memos.yml`，每两小时一次 + 手动触发。需要在仓库 Secrets 里配：

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
