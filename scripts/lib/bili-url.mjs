/**
 * B 站地址解析的纯函数部分：不联网、不读文件，方便直接单测。
 * 联网的部分（短链 302、av 号换 BV、view 接口）留在 scripts/sync-videos.mjs。
 */

/** BV 号。字符集比官方规范宽松一点，宁可多认几个，也不让历史编号认不出来。 */
export const BVID_RE = /BV[0-9A-Za-z]{10}/
export const AVID_RE = /\/video\/av(\d+)/i

/**
 * b23.tv 是 B 站官方短链；后面几个是同一套短链的备用域名。
 * b23.tv 落地后可能是 www.bilibili.com/video/BV…，也可能是番剧、专栏、用户空间。
 */
export const SHORT_LINK_HOSTS = new Set(["b23.tv", "bili2233.cn", "bili22.cn", "bili33.cn"])

/** 取主机名，去掉 www. 前缀；地址不合法时返回空串。 */
export function hostOf(url) {
  try {
    return new URL(String(url).trim()).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    return ""
  }
}

/** 这条地址是不是 b23.tv 这类短链（短链本身不含 BV 号，必须跟一次跳转）。 */
export function isShortLink(url) {
  return SHORT_LINK_HOSTS.has(hostOf(url))
}

/** 从任意字符串里抠出第一个 BV 号，没有就返回空串。 */
export function extractBvid(text) {
  const m = String(text || "").match(BVID_RE)
  return m ? m[0] : ""
}

/**
 * 短链落地页里 BV 号可能出现在两处：
 *   1. 页内 __INITIAL_STATE__ 之类的 "bvid":"BV…"
 *   2. 各种 /video/BV… 的相对或绝对链接
 * 重定向后的地址本身（res.url）由调用方先看一眼，那里优先级最高。
 */
export function findBvidInHtml(html) {
  const patterns = [/"bvid"\s*:\s*"(BV[0-9A-Za-z]{10})"/, /\/video\/(BV[0-9A-Za-z]{10})/]
  for (const re of patterns) {
    const m = String(html || "").match(re)
    if (m) return m[1]
  }
  return ""
}

/**
 * memos 的 content 里可能有好几个链接，全拆出来交给调用方挨个试。
 * 两种写法都认：
 *   [文字](https://…)   带标题的 Markdown 链接，标题优先用它
 *   https://…           直接贴的裸地址（历史上就有这种哔哔），标题留空交给 B 站标题兜底
 * Markdown 里已经出现过的不再重复计入。
 */
export function collectLinks(content) {
  const text = String(content || "")
  const links = []
  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  let m
  while ((m = mdRe.exec(text))) links.push({ text: m[1].trim(), url: m[2].trim() })

  // 裸地址：去掉 Markdown 链接后再扫，中文标点和右括号都不能算进 URL。
  const rest = text.replace(mdRe, " ")
  const bareRe = /https?:\/\/[^\s<>"'（）()，。；、\]】]+/g
  while ((m = bareRe.exec(rest))) links.push({ text: "", url: m[0].replace(/[.,;:!?]+$/, "") })

  return links
}
