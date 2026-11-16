/**
 * B 站地址解析的离线测试：node --test scripts/lib/bili-url.test.mjs
 * 只覆盖不联网的纯函数，短链 302 那部分靠真实请求，无法在这里断言。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { AVID_RE, collectLinks, extractBvid, findBvidInHtml, hostOf, isShortLink } from "./bili-url.mjs"

test("extractBvid 认得全程地址和移动端地址", () => {
  assert.equal(extractBvid("https://www.bilibili.com/video/BV1G4WU6pEwQ"), "BV1G4WU6pEwQ")
  assert.equal(extractBvid("https://m.bilibili.com/video/BV14wss6LEBv"), "BV14wss6LEBv")
  // 带一堆分享参数也要认得
  assert.equal(
    extractBvid("https://www.bilibili.com/video/BV1ZdWU6aEo9?share_source=copy&spm_id_from=333.999"),
    "BV1ZdWU6aEo9",
  )
  // 号本身是 BV1Q4WU6HE5v，不能因为小写字母被截断
  assert.equal(extractBvid("BV1Q4WU6HE5v"), "BV1Q4WU6HE5v")
})

test("extractBvid 对短链和无关文本返回空", () => {
  assert.equal(extractBvid("https://b23.tv/zNxZbJi"), "")
  assert.equal(extractBvid("https://example.com/BV1G4WU6pEwQ"), "BV1G4WU6pEwQ")
  assert.equal(extractBvid("什么都没有"), "")
  assert.equal(extractBvid(null), "")
  assert.equal(extractBvid(undefined), "")
})

test("isShortLink 只认 b23.tv 那套域名", () => {
  assert.equal(isShortLink("https://b23.tv/zNxZbJi"), true)
  assert.equal(isShortLink("http://b23.tv/zNxZbJi"), true)
  assert.equal(isShortLink("https://www.b23.tv/zNxZbJi"), true)
  assert.equal(isShortLink("https://bili2233.cn/abc123"), true)
  assert.equal(isShortLink("https://www.bilibili.com/video/BV1G4WU6pEwQ"), false)
  assert.equal(isShortLink("https://m.bilibili.com/video/BV14wss6LEBv"), false)
  assert.equal(isShortLink("https://neodb.social/movie/xyz"), false)
  assert.equal(isShortLink("不是地址"), false)
})

test("hostOf 去掉 www. 并忽略大小写", () => {
  assert.equal(hostOf("https://WWW.B23.TV/x"), "b23.tv")
  assert.equal(hostOf("https://m.bilibili.com/video/BV14wss6LEBv"), "m.bilibili.com")
  assert.equal(hostOf(""), "")
})

test("findBvidInHtml 能从状态对象和站内链接里捞出 BV 号", () => {
  assert.equal(findBvidInHtml('{"bvid":"BV1G4WU6pEwQ","aid":113456789}'), "BV1G4WU6pEwQ")
  assert.equal(findBvidInHtml('<link rel="canonical" href="//www.bilibili.com/video/BV14wss6LEBv/">'), "BV14wss6LEBv")
  // "bvid" 这个键优先于页面里随便出现的 /video/ 链接
  assert.equal(findBvidInHtml('/video/BV1ZdWU6aEo9 和 "bvid":"BV1G4WU6pEwQ"'), "BV1G4WU6pEwQ")
  assert.equal(findBvidInHtml("<html>番剧页，没有视频</html>"), "")
  assert.equal(findBvidInHtml(""), "")
})

test("collectLinks 拆出全部 Markdown 链接，忽略裸地址以外的杂物", () => {
  const links = collectLinks(
    "vlog03 [青海湖喂个鸟](https://www.bilibili.com/video/BV1G4WU6pEwQ) #影彩 顺手看 https://b23.tv/zNxZbJi",
  )
  assert.equal(links.length, 2)
  assert.deepEqual(links[0], { text: "青海湖喂个鸟", url: "https://www.bilibili.com/video/BV1G4WU6pEwQ" })
  // 裸链接没有标题，交给 B 站标题兜底
  assert.deepEqual(links[1], { text: "", url: "https://b23.tv/zNxZbJi" })
})

test("collectLinks 支持一条 memo 里挂多个链接", () => {
  const links = collectLinks("先看图 [照片](https://img.hux.ink/a.webp)，视频 [盐田徒步](https://b23.tv/zNxZbJi)")
  assert.equal(links.length, 2)
  assert.equal(links[0].url, "https://img.hux.ink/a.webp")
  assert.equal(links[1].text, "盐田徒步")
  assert.equal(links[1].url, "https://b23.tv/zNxZbJi")
  assert.deepEqual(collectLinks("没有链接"), [])
})

test("collectLinks 认只有裸链接的哔哔，且不把中文标点吃进地址", () => {
  const links = collectLinks("https://b23.tv/oL0l0xw  #亦可赛艇")
  assert.equal(links.length, 1)
  assert.equal(links[0].url, "https://b23.tv/oL0l0xw")

  const punct = collectLinks("看这个 https://b23.tv/abc123，挺好看。")
  assert.equal(punct.length, 1)
  assert.equal(punct[0].url, "https://b23.tv/abc123")
})

test("AVID_RE 认老 av 号", () => {
  assert.equal("https://www.bilibili.com/video/av113456789".match(AVID_RE)[1], "113456789")
  assert.equal("https://www.bilibili.com/video/BV1G4WU6pEwQ".match(AVID_RE), null)
})
