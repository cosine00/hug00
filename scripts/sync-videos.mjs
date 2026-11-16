#!/usr/bin/env node
/**
 * 影彩（视频）数据同步
 *
 * 数据源只有一个：static/memos.json 里带 #影彩 标签的条目。
 * 条目的 content 形如：vlog03 [青海湖喂个鸟](https://www.bilibili.com/video/BV1G4WU6pEwQ) #影彩
 *
 * 地址支持四种写法，最终都要落到 BV 号：
 *   https://www.bilibili.com/video/BV1G4WU6pEwQ    ← 全程地址
 *   https://m.bilibili.com/video/BV14wss6LEBv      ← 移动端地址
 *   https://b23.tv/zNxZbJi                         ← 官方短链，跟一次 302 取落地页
 *   https://www.bilibili.com/video/av113456789     ← 老 av 号，查接口换成 BV
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
 *   node scripts/sync-videos.mjs --resolve https://b23.tv/zNxZbJi  # 只验证地址能不能解析
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
import { AVID_RE, collectLinks, extractBvid, findBvidInHtml, hostOf, isShortLink } from "./lib/bili-url.mjs"

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

/* ── 地址解析：把各种 B 站写法统一成 BV 号 ───────────────── */

/** 短链对桌面 UA 比较挑，重试时换成移动端。 */
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

/**
 * 跟一次 302。b23.tv 正常会直接跳到 www.bilibili.com/video/BV…，
 * fetch 默认 follow，res.url 就是落地地址；偶尔被风控成半截 HTML，
 * 就从页面里捞 BV 号。重试两次，其中一次换移动端 UA。
 */
async function resolveShortLink(url) {
  let lastErr = null
  for (const ua of [UA, MOBILE_UA, UA]) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": ua,
          Referer: "https://www.bilibili.com/",
          Accept: "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        signal: AbortSignal.timeout(15000),
      })
      const finalUrl = res.url || url
      const inUrl = extractBvid(finalUrl)
      if (inUrl) return { bvid: inUrl, url: finalUrl }
      if (!res.ok) throw new Error(`短链跳转返回 ${res.status}`)
      const inHtml = findBvidInHtml(await res.text())
      if (inHtml) return { bvid: inHtml, url: `https://www.bilibili.com/video/${inHtml}/` }
      // 页面打开了但里面没有视频：番剧、专栏、动态之类，交给调用方当「非视频」处理。
      return { bvid: "", url: finalUrl }
    } catch (err) {
      lastErr = err
      await sleep(600)
    }
  }
  throw new Error(`短链展开失败（${lastErr ? lastErr.message : "未知原因"}）`)
}

/** 老 av 号没有 BV，查一次 view 接口让 B 站自己换算。 */
async function bvidFromAid(aid) {
  const cookie = await getBuvidCookie()
  const res = await fetch(`https://api.bilibili.com/x/web-interface/view?aid=${aid}`, {
    headers: biliHeaders(cookie),
  })
  if (!res.ok) throw new Error(`av 号查询返回 ${res.status}`)
  const json = await res.json()
  const bvid = json?.data?.bvid || ""
  if (json.code !== 0 || !bvid) throw new Error(`av${aid} 查不到对应视频（${json.code} ${json.message || ""}）`)
  return bvid
}

/**
 * 从任意一条 B 站地址取 BV 号。
 * 返回 { bvid, url, via }；bvid 为空表示地址通、但不是视频页（不视为失败）。
 * skip 为真表示这条地址压根不是 B 站的东西，跳过就好（一条哔哔里常混着图片链接）。
 * 抛异常才代表「技术上没解析出来」——网络、风控、接口异常，调用方应当拦住写入。
 */
async function resolveVideoId(rawUrl) {
  const url = String(rawUrl || "").trim()
  const direct = extractBvid(url)
  if (direct) return { bvid: direct, url, via: "direct" }

  const aid = (url.match(AVID_RE) || [])[1]
  if (aid) return { bvid: await bvidFromAid(aid), url: `https://www.bilibili.com/video/av${aid}/`, via: "aid" }

  // 短链：b23.tv/zNxZbJi 这类，链接里根本没有 BV 号，只能跟一次跳转。
  if (isShortLink(url)) {
    const landed = await resolveShortLink(url)
    return { bvid: landed.bvid, url: landed.url, via: "short" }
  }

  // b 站自己的站内地址但既没 BV 也没 av（番剧、专栏、动态），当「非视频」处理。
  if (hostOf(url).endsWith("bilibili.com")) return { bvid: "", url, via: "bilibili-other" }

  return { bvid: "", url, via: "none", skip: true }
}

/**
 * 从 memo 里解析出 bvid、标题、vlog 编号。
 * 返回三种结果：{ bvid } 成功、{ skip } 不是视频（跳过即可）、{ error } 解析失败（要拦住写入）。
 */
async function parseMemo(memo) {
  const content = String(memo.content || "").replace(/\r/g, "")
  const links = collectLinks(content)
  if (!links.length) return { skip: "内容里没有链接" }

  const errors = []
  let hit = null
  for (const link of links) {
    let resolved
    try {
      resolved = await resolveVideoId(link.url)
    } catch (err) {
      errors.push(`${link.url}：${err.message}`)
      continue
    }
    if (resolved.skip) continue
    if (!resolved.bvid) {
      console.log(`  · ${link.url} 不是视频页（${resolved.via}），换下一个链接`)
      continue
    }
    if (resolved.via === "short") console.log(`  ⇢ 短链展开：${link.url} → ${resolved.url}`)
    if (resolved.via === "aid") console.log(`  ⇢ av 号换算：${link.url} → ${resolved.bvid}`)
    hit = { ...resolved, title: link.text || "" }
    break
  }

  if (!hit) {
    // 全部链接都不是视频 → 正常跳过；有技术性失败 → 报错，别让它悄悄消失。
    return errors.length ? { error: errors.join("；") } : { skip: "没有 B 站视频链接" }
  }

  // "vlog03 标题" 这种写法的前缀当成编号展示，正文标题仍取链接文字。
  const prefix = (content.match(/^\s*(vlog\s*\d+)/i) || [])[1] || ""
  const label = prefix ? prefix.replace(/vlog\s*/i, "VLOG ").replace(/\s+/g, " ").toUpperCase() : ""

  return { bvid: hit.bvid, title: hit.title, url: hit.url, label, memoId: String(memo.id || "") }
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

/**
 * --resolve <地址>：只验证一条地址能不能解析出 BV 号，读写任何数据文件都不碰。
 * 用来在本地确认短链、av 号、移动端地址是否都被认出来。
 */
const resolveIdx = process.argv.indexOf("--resolve")
if (resolveIdx !== -1) {
  const target = process.argv[resolveIdx + 1]
  if (!target) {
    console.error("用法：node scripts/sync-videos.mjs --resolve https://b23.tv/xxxxxxx")
    process.exit(1)
  }
  console.log(`解析 ${target}`)
  try {
    const r = await resolveVideoId(target)
    if (!r.bvid) {
      console.log(`  ⚠ 地址能打开，但不是视频页：${r.url}`)
      process.exit(0)
    }
    console.log(`  方式：${r.via}`)
    console.log(`  BV 号：${r.bvid}`)
    console.log(`  落地页：${r.url}`)
    const meta = await fetchMeta(r.bvid).catch((err) => {
      console.warn(`  ! 元数据没取到（${err.message}），BV 号本身是有效的`)
      return null
    })
    if (meta) console.log(`  标题：${meta.title}\n  发布：${meta.date}　时长：${mmss(meta.seconds)}　画幅：${meta.aspect}`)
  } catch (err) {
    console.error(`  ✕ 解析失败：${err.message}`)
    if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(String(err.message))) {
      console.error("  提示：本机挂着系统代理时，Node 的 fetch 默认不读 HTTPS_PROXY，先关代理或走全局模式再试。")
    }
    process.exit(1)
  }
  process.exit(0)
}

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
  const parsed = await parseMemo(memo)
  if (!parsed.bvid) {
    if (parsed.error) {
      // 地址解析不出来（短链打不开、av 号查不到）属于技术失败：
      // 这一条很可能本该出现在页面上，不能悄悄丢掉，一并拦住写入。
      failures.push(`memo ${memo.id}：${parsed.error}`)
      console.warn(`  ✕ memo ${memo.id} 地址解析失败：${parsed.error}`)
    } else {
      console.warn(`  · memo ${memo.id} ${parsed.skip || "不是视频"}，跳过`)
    }
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
  console.error(`\n✕ ${failures.length} 条 #${TAG} 同步失败（地址解析不出来，或拿不到元数据且无历史记录）：`)
  for (const f of failures) console.error(`   - ${f}`)
  console.error("已放弃写入，data/videos.json 保持原样。本机（家用 IP）跑一次即可补上：")
  console.error("   node scripts/sync-videos.mjs")
  console.error("只想验证某条地址能不能解析：node scripts/sync-videos.mjs --resolve <地址>")
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
