#!/usr/bin/env node
/**
 * 影彩（视频）数据同步
 *
 * 数据源只有一个：static/memos.json 里带 #影彩 标签的条目。
 * 条目的 content 形如：vlog03 [青海湖喂个鸟](https://www.bilibili.com/video/BV1G4WU6pEwQ) #影彩
 *
 * 流程：
 *   1. 读 memos.json，筛 #影彩，解析出 Markdown 链接（标题 + B 站地址）
 *   2. 用 bvid 调 B 站 view 接口，取封面、时长、发布日、简介、画面比例
 *   3. 封面取 B 站图床的 1280 宽压缩版，传到 R2 图床（img.hux.ink），仓库里不落图
 *   4. 写出 data/videos.json 给 Hugo 用
 *
 * 用法：
 *   node scripts/sync-videos.mjs              # 能连图床就上传，否则退化为 B 站直链
 *   node scripts/sync-videos.mjs --force      # 忽略封面缓存，全部重传
 *   node scripts/sync-videos.mjs --dry        # 只打印，不写文件
 *   node scripts/sync-videos.mjs --allow-partial  # 有条目拿不到元数据时仍然写入
 *
 * 图床凭据（和 .github/scripts/fetch-memos.js 共用同一套，二选一即可）：
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_ENDPOINT / R2_PUBLIC_DOMAIN
 *   或者 Lsky 接口令牌：HUX_IMG_TOKEN（也可写在 .env.local 的 IMG_TOKEN）
 *
 * 防呆：B 站对机房 IP（GitHub Actions、Cloudflare Workers）经常直接返回 412。
 * 这时脚本会沿用 data/videos.json 里上一次成功的结果，绝不把文件写空；
 * 真有拿不到又没有历史数据的新视频时，直接以非 0 退出、不落盘，等有人本地补跑。
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createR2Uploader } from "./lib/r2.mjs"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const MEMOS = path.join(ROOT, "static/memos.json")
const OUT = path.join(ROOT, "data/videos.json")
const IMG_BASE = "https://img.hux.ink"
const TAG = "影彩"
const FORCE = process.argv.includes("--force")
const DRY = process.argv.includes("--dry")
const ALLOW_PARTIAL = process.argv.includes("--allow-partial")

/* ── 小工具 ─────────────────────────────────────────────── */

function readToken() {
  if (process.env.HUX_IMG_TOKEN) return process.env.HUX_IMG_TOKEN.trim()
  for (const name of [".env.local", ".dev.vars"]) {
    const p = path.join(ROOT, name)
    if (!fs.existsSync(p)) continue
    const line = fs
      .readFileSync(p, "utf8")
      .split("\n")
      .find((l) => /^\s*(IMG_TOKEN|HUX_IMG_TOKEN)\s*=/.test(l))
    if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "")
  }
  return ""
}

/** B 站图床有 i0/i1/i2 三个节点，个别网络下 i2 不通，统一收到 i0。 */
function normalizeCover(url) {
  return String(url || "").replace(/^http:\/\//, "https://").replace(/^https:\/\/i\d\.hdslb\.com/, "https://i0.hdslb.com")
}

/**
 * B 站图床支持在地址后加 @<宽>w.webp 直接出压缩图：
 * 原图 1918×1080 约 1.4MB，加 @1280w.webp 后 1280×722 只有约 190KB，比例不变。
 * 列表里 640px 宽在 2 倍屏正好 1280，够用又不浪费流量。
 */
const COVER_SUFFIX = "@1280w.webp"

function sizedCover(url) {
  const u = normalizeCover(url)
  return u.includes("@") ? u : u + COVER_SUFFIX
}

function mmss(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, "0")
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** 从 memos 的 content 里拆出 vlog 编号、标题、链接。 */
function parseMemo(memo) {
  const content = String(memo.content || "").replace(/\r/g, "")
  const link = content.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/)
  if (!link) return null
  const title = link[1].trim()
  const url = link[2].trim()
  const bvid = (url.match(/(BV[0-9A-Za-z]{10})/) || [])[1]
  if (!bvid) return null

  // "vlog03 标题" 这种写法的前缀当成编号展示，正文标题仍取链接文字。
  const prefix = (content.match(/^\s*(vlog\s*\d+)/i) || [])[1] || ""
  const label = prefix ? prefix.replace(/vlog\s*/i, "VLOG ").replace(/\s+/g, " ").toUpperCase() : ""

  return { bvid, title, url, label, memoId: String(memo.id || "") }
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 先要一个 buvid3/buvid4。B 站的风控在机房 IP 上尤其凶，
 * 手里没有这俩 cookie 时 api 更容易直接 412；有了它命中率明显高一些。
 * 拿不到也不致命，后面的请求就不带 cookie 再试。
 */
let buvidCookie = null
async function getBuvidCookie() {
  if (buvidCookie !== null) return buvidCookie
  buvidCookie = ""
  try {
    const res = await fetch("https://api.bilibili.com/x/frontend/finger/spi", {
      headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/" },
    })
    if (res.ok) {
      const json = await res.json()
      const b3 = json?.data?.b_3 || ""
      const b4 = json?.data?.b_4 || ""
      if (b3) buvidCookie = `buvid3=${b3}` + (b4 ? `; buvid4=${b4}` : "")
    }
  } catch {
    /* 拿不到就算了 */
  }
  return buvidCookie
}

function biliHeaders(cookie) {
  const headers = {
    "User-Agent": UA,
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  }
  if (cookie) headers.Cookie = cookie
  return headers
}

function metaFromView(d) {
  const w = d.dimension?.width || 0
  const h = d.dimension?.height || 0
  const iso = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "")
  return {
    title: d.title || "",
    cid: d.cid || (d.pages && d.pages[0] ? d.pages[0].cid : 0),
    cover: normalizeCover(d.pic || ""),
    date: iso(d.pubdate),
    seconds: d.duration || 0,
    aspect: h > w ? "portrait" : "landscape",
    intro: String(d.desc || "").trim(),
    owner: d.owner?.name || "",
  }
}

/** 主路：view 接口，先带 buvid 再裸奔，各重试一次。 */
async function fetchMeta(bvid) {
  const cookie = await getBuvidCookie()
  const variants = cookie ? [cookie, "", cookie] : ["", ""]
  let lastErr = null
  for (const c of variants) {
    try {
      const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
        headers: biliHeaders(c),
      })
      if (!res.ok) throw new Error(`B 站接口 ${res.status}`)
      const json = await res.json()
      if (json.code !== 0 || !json.data) throw new Error(`B 站接口返回 ${json.code} ${json.message || ""}`)
      return metaFromView(json.data)
    } catch (err) {
      lastErr = err
      await sleep(600)
    }
  }
  throw lastErr || new Error("B 站接口不可用")
}

/**
 * 兜底：直接抓视频页 HTML 里的 og:image / og:title。
 * 只能拿到标题和封面，cid、时长之类的留给调用方用上次的结果补。
 */
async function fetchMetaFromPage(bvid) {
  const cookie = await getBuvidCookie()
  const res = await fetch(`https://www.bilibili.com/video/${bvid}/`, { headers: biliHeaders(cookie) })
  if (!res.ok) throw new Error(`视频页 ${res.status}`)
  const html = await res.text()
  const pick = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]+)"`, "i"))
    return m ? m[1] : ""
  }
  const title = pick("og:title")
  const image = pick("og:image")
  if (!title && !image) throw new Error("视频页里没有元信息")
  return {
    title: title.replace(/\s*[-_].*哔哩哔哩.*$/, "").trim(),
    cid: 0,
    cover: image ? normalizeCover(image) : "",
    date: "",
    seconds: 0,
    aspect: "landscape",
    intro: "",
    owner: "",
  }
}

/** 取压缩版封面；万一 B 站变换参数失效，退回原图。 */
async function fetchCoverBytes(url) {
  const attempts = [
    { url: sizedCover(url), ext: "webp", mime: "image/webp" },
    { url: normalizeCover(url), ext: "jpg", mime: "image/jpeg" },
  ]
  let lastErr = null
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/" } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const type = res.headers.get("content-type") || ""
      if (!type.startsWith("image/")) throw new Error(`返回了 ${type}`)
      return { buf: Buffer.from(await res.arrayBuffer()), ext: attempt.ext, mime: attempt.mime }
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`封面下载失败：${lastErr ? lastErr.message : "未知原因"}`)
}

async function uploadToImgHost(file, name, token) {
  const form = new FormData()
  form.append("file", new Blob([file.buf], { type: file.mime }), `${name}.${file.ext}`)
  const res = await fetch(`${IMG_BASE}/api/v1/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    const hint = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)
    throw new Error(`图床返回 ${res.status}（${hint}）`)
  }
  if (!res.ok || json.status === false) {
    throw new Error(`图床上传失败（${res.status}）：${json.message || ""}`)
  }
  const url = json.data?.links?.url || json.data?.url
  if (!url) throw new Error("图床未返回图片地址")
  return url
}

/* ── 主流程 ─────────────────────────────────────────────── */

const memos = JSON.parse(fs.readFileSync(MEMOS, "utf8"))
const picked = memos
  .filter((m) => Array.isArray(m.tags) && m.tags.some((t) => String(t).trim() === TAG))
  .sort((a, b) => (b.createdTs || 0) - (a.createdTs || 0))

console.log(`memos.json 共 ${memos.length} 条，其中 #${TAG} ${picked.length} 条`)

const r2 = createR2Uploader(process.env)
const lskyToken = readToken()
const uploader = r2 ? "r2" : lskyToken ? "lsky" : ""

/** 优先 R2 直传（与哔哔同步共用凭据），没配 R2 再走图床接口令牌。 */
async function uploadCover(file, bvid) {
  if (r2) {
    const key = `${r2.prefix()}/video-cover-${bvid}.${file.ext}`
    await r2.put(key, file.buf, file.mime)
    return r2.urlOf(key)
  }
  if (lskyToken) return uploadToImgHost(file, `video-cover-${bvid}`, lskyToken)
  throw new Error("没有可用的图床凭据")
}

if (!uploader && !DRY) console.log("⚠ 未配置 R2 或图床令牌，封面暂用 B 站直链（不下载不落盘）。")

/** 上一次成功写出的结果，既当封面缓存，也当 B 站翻脸时的整条兜底。 */
const cache = new Map()
if (fs.existsSync(OUT)) {
  try {
    for (const v of JSON.parse(fs.readFileSync(OUT, "utf8"))) {
      if (v.bvid) cache.set(v.bvid, v)
    }
  } catch {
    /* 旧文件损坏就当作没有缓存 */
  }
}

const videos = []
const failures = []

for (const memo of picked) {
  const parsed = parseMemo(memo)
  if (!parsed) {
    console.warn(`  ✕ memo ${memo.id} 里没找到 B 站链接，跳过`)
    continue
  }

  const cached = cache.get(parsed.bvid)
  let meta = null
  let metaErr = null

  try {
    meta = await fetchMeta(parsed.bvid)
  } catch (err) {
    metaErr = err
  }

  if (!meta) {
    // 接口被风控时退一步抓页面，至少把标题和封面拿回来。
    try {
      const page = await fetchMetaFromPage(parsed.bvid)
      meta = page
      console.warn(`  ~ ${parsed.bvid} 接口不可用（${metaErr && metaErr.message}），改从视频页取到标题与封面`)
    } catch (err2) {
      metaErr = err2
    }
  }

  if (!meta) {
    // 拿不到就沿用上次的结果，绝不把已有条目弄丢。
    if (cached) {
      videos.push(cached)
      console.warn(`  ↺ ${parsed.bvid} 沿用上次结果（${metaErr && metaErr.message}）`)
      continue
    }
    failures.push(`${parsed.bvid}：${metaErr ? metaErr.message : "未知原因"}`)
    console.warn(`  ✕ ${parsed.bvid} 拿不到元数据，本地也没有历史记录：${metaErr && metaErr.message}`)
    continue
  }

  // 页面兜底拿不到 cid / 时长 / 发布日，用缓存补齐，避免「只有标题没有片长」。
  if (cached) {
    for (const key of ["cid", "date", "seconds", "aspect", "intro"]) {
      if (!meta[key] && cached[key]) meta[key] = cached[key]
    }
    if (!meta.cover && cached.cover) meta.cover = cached.cover
  }

  let cover = (cached && cached.cover) || ""
  // 图床上的地址原样复用；B 站直链统一补上 1280 宽压缩参数。
  const onImgHost = cover.startsWith(IMG_BASE) || (r2 ? cover.startsWith(r2.publicUrl) : false)
  let coverHost = onImgHost ? "img.hux.ink" : cover ? "bilibili" : ""
  if (coverHost === "bilibili") cover = sizedCover(cover)

  if (uploader && (FORCE || !onImgHost)) {
    try {
      const file = await fetchCoverBytes(meta.cover)
      cover = await uploadCover(file, parsed.bvid)
      coverHost = "img.hux.ink"
      console.log(`  ↑ ${parsed.bvid} 封面上传完成（${Math.round(file.buf.length / 1024)}KB via ${uploader}）→ ${cover}`)
    } catch (err) {
      console.warn(`  ! ${parsed.bvid} 封面上传失败，退回 B 站直链：${err.message}`)
      cover = sizedCover(meta.cover)
      coverHost = "bilibili"
    }
  }
  if (!cover) {
    cover = sizedCover(meta.cover)
    coverHost = "bilibili"
  }

  // 简介与标题重复（B 站简介常常就是标题本身）时就不展示了，省得页面重复一句话。
  const bare = (s) => String(s || "").replace(/[\s·・:：,，.。|\-—_()（）\[\]【】]/g, "").toLowerCase()
  const intro = String(meta.intro || "").split("\n")[0].trim()
  const summary = intro && !bare(meta.title).includes(bare(intro).slice(0, 12)) ? intro.slice(0, 90) : ""

  videos.push({
    bvid: parsed.bvid,
    cid: meta.cid || 0,
    label: parsed.label,
    title: meta.title || parsed.title,
    date: meta.date,
    duration: mmss(meta.seconds),
    seconds: meta.seconds,
    aspect: meta.aspect,
    cover,
    coverHost,
    summary,
    memoId: parsed.memoId,
    url: `https://www.bilibili.com/video/${parsed.bvid}/`,
  })
  console.log(`  ✓ ${meta.date || "----"} ${parsed.label || "-"} ${meta.title} · ${mmss(meta.seconds)} · ${meta.aspect} · ${coverHost}`)
}

videos.sort((a, b) => (a.date === b.date ? String(b.label).localeCompare(String(a.label)) : a.date < b.date ? 1 : -1))

// 有新增视频拿不到元数据时宁可不写：写下去会让这一条从页面上消失，
// 而「什么都没变」的错误比「少一条视频」容易发现得多。
if (failures.length && !ALLOW_PARTIAL) {
  console.error(`\n✕ ${failures.length} 条视频拿不到元数据，且没有历史记录可沿用：`)
  for (const f of failures) console.error(`   - ${f}`)
  console.error("已放弃写入，data/videos.json 保持原样。本机（家用 IP）跑一次即可补上：")
  console.error("   node scripts/sync-videos.mjs")
  console.error("确要写入不完整数据，加 --allow-partial。")
  process.exit(1)
}

if (!videos.length && cache.size) {
  console.error(`\n✕ 解析结果为空，但上次还有 ${cache.size} 条记录，已放弃写入以免清空页面。`)
  process.exit(1)
}

if (DRY) {
  console.log(JSON.stringify(videos, null, 2))
} else {
  fs.writeFileSync(OUT, JSON.stringify(videos, null, 2) + "\n")
  console.log(`\n写出 ${path.relative(ROOT, OUT)}：${videos.length} 条`)
}
