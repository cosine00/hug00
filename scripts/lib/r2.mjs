/**
 * 往 Cloudflare R2 直传文件（S3 兼容接口，SigV4 签名）。
 *
 * 环境变量与 .github/scripts/fetch-memos.js、upload_r2.py 完全一致，
 * 所以仓库里已经配好的那套 secrets 可以直接复用：
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 *   R2_ENDPOINT（或 R2_ACCOUNT_ID）
 *   R2_PUBLIC_DOMAIN（或 R2_PUBLIC_URL）
 *   R2_PREFIX（默认 image/{yyyy}/{mm}
 *
 * 四个必填项缺任意一个，createR2Uploader() 返回 null，调用方自行降级。
 */

import crypto from "node:crypto"

const pad = (n) => String(n).padStart(2, "0")

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex")
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest()
}

function safeSegment(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function createR2Uploader(env = process.env) {
  const endpoint = String(env.R2_ENDPOINT || "").trim().replace(/\/+$/, "")
  const accountId = String(env.R2_ACCOUNT_ID || "").trim()
  const bucket = String(env.R2_BUCKET || "").trim()
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || "").trim()
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || "").trim()
  const publicUrl = String(env.R2_PUBLIC_DOMAIN || env.R2_PUBLIC_URL || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/^(?!https?:\/\/)/, "https://")
  const prefixTemplate = String(env.R2_PREFIX || "image/{yyyy}/{mm}").trim()

  const origin = endpoint ? `${new URL(endpoint).protocol}//${new URL(endpoint).host}` : accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ""
  if (!origin || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) return null

  const canonicalUri = (key) => `/${[bucket, ...String(key).split("/").filter(Boolean)].map(safeSegment).join("/")}`

  function prefix(date = new Date()) {
    return prefixTemplate
      .replace(/\{yyyy\}/g, date.getFullYear())
      .replace(/\{mm\}/g, pad(date.getMonth() + 1))
      .replace(/\{dd\}/g, pad(date.getDate()))
      .replace(/^\/+|\/+$/g, "")
  }

  async function put(key, buffer, contentType = "application/octet-stream") {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
    const dateStamp = amzDate.slice(0, 8)
    const host = new URL(origin).host
    const payloadHash = sha256Hex(buffer)
    const headers = {
      host,
      "content-type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    }
    const headerKeys = Object.keys(headers).sort()
    const canonicalHeaders = headerKeys.map((k) => `${k}:${String(headers[k]).trim().replace(/\s+/g, " ")}\n`).join("")
    const signedHeaders = headerKeys.join(";")
    const canonicalRequest = ["PUT", canonicalUri(key), "", canonicalHeaders, signedHeaders, payloadHash].join("\n")
    const scope = `${dateStamp}/auto/s3/aws4_request`
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n")
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), "auto"), "s3"), "aws4_request")
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")

    const res = await fetch(`${origin}${canonicalUri(key)}`, {
      method: "PUT",
      headers: {
        ...headers,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: buffer,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`R2 上传失败 ${res.status}：${String(text).slice(0, 160)}`)
    }
  }

  const urlOf = (key) => `${publicUrl}/${String(key).split("/").map(safeSegment).join("/")}`

  return { put, urlOf, prefix, bucket, publicUrl }
}
