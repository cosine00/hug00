'use strict';

/**
 * 从 FlareMo 拉取哔哔，生成 static/memos.json。
 *
 * 与旧 Memos 方案的区别：
 *   1. 接口从 Memos `/api/v1/memo`（单数、无鉴权）换成 FlareMo `/api/v1/memos`（复数、PAT）
 *   2. 附件在 FlareMo 里是「正文外」的独立记录，读取要鉴权，博客拿不到；
 *      所以这里把附件先转存到 Cloudflare R2 图床，再把外链写进 resourceList，
 *      博客端的渲染逻辑完全不用改。
 *
 * 环境变量：
 *   FLAREMO_BASE       必填  https://drafts.hux.ink（不带 /api 后缀）
 *   FLAREMO_PAT        必填  memos_pat_xxx
 *   FLAREMO_PAGE_SIZE  选填  默认 50（实测 >80 服务端会 500，遇错自动降半重试）
 *   MEMO_STATES        选填  默认 NORMAL，逗号分隔
 *   R2_ACCESS_KEY_ID   转存必填
 *   R2_SECRET_ACCESS_KEY 转存必填
 *   R2_ENDPOINT        转存必填  例 https://<account>.r2.cloudflarestorage.com
 *   R2_BUCKET          转存必填
 *   R2_PUBLIC_DOMAIN   转存必填  例 img.hux.ink（可不带协议）
 *   R2_PREFIX          选填  默认 images/{yyyy}/{mm}
 *   DRY_RUN            选填  1=只拉数据不上传不写盘，输出到 memos.dryrun.json
 *
 * R2 变量名与 .github/scripts/upload_r2.py（Notion 同步）保持一致，沿用仓库已配的 secrets；
 * 同时兼容 R2_ACCOUNT_ID / R2_PUBLIC_URL 两种旧写法。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT_FILE = path.join(ROOT, 'static/memos.json');
const CACHE_FILE = path.join(__dirname, 'memo-attachment-cache.json');

const CFG = {
  base: String(process.env.FLAREMO_BASE || '').trim().replace(/\/+$/, ''),
  pat: String(process.env.FLAREMO_PAT || '').trim(),
  pageSize: Math.max(1, Math.min(80, Number(process.env.FLAREMO_PAGE_SIZE) || 50)),
  states: String(process.env.MEMO_STATES || 'NORMAL')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean),
  r2: {
    accountId: String(process.env.R2_ACCOUNT_ID || '').trim(),
    endpoint: String(process.env.R2_ENDPOINT || '').trim().replace(/\/+$/, ''),
    bucket: String(process.env.R2_BUCKET || '').trim(),
    accessKeyId: String(process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    publicUrl: String(process.env.R2_PUBLIC_DOMAIN || process.env.R2_PUBLIC_URL || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/^(?!https?:\/\/)/, 'https://'),
    prefix: String(process.env.R2_PREFIX || 'images/{yyyy}/{mm}').trim(),
  },
  dryRun: String(process.env.DRY_RUN || '') === '1',
  webOrigin: String(process.env.FLAREMO_BASE || '').trim().replace(/\/+$/, ''),
};

const REQUEST_TIMEOUT = 60000;
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 500;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fail(message) {
  throw new Error(message);
}

function assertConfig() {
  if (!CFG.base) fail('缺少 FLAREMO_BASE（例：https://drafts.hux.ink）');
  if (!CFG.pat) fail('缺少 FLAREMO_PAT（memos_pat_ 开头）');
  if (!CFG.dryRun) {
    const missing = Object.entries({
      R2_ACCESS_KEY_ID: CFG.r2.accessKeyId,
      R2_SECRET_ACCESS_KEY: CFG.r2.secretAccessKey,
      R2_BUCKET: CFG.r2.bucket,
      'R2_ENDPOINT 或 R2_ACCOUNT_ID': CFG.r2.endpoint || CFG.r2.accountId,
      'R2_PUBLIC_DOMAIN 或 R2_PUBLIC_URL': CFG.r2.publicUrl,
    }).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      fail(`缺少图床环境变量：${missing.join('、')}。只想验证数据可加 DRY_RUN=1。`);
    }
  }
}

function r2Origin() {
  if (CFG.r2.endpoint) {
    const url = new URL(CFG.r2.endpoint);
    return `${url.protocol}//${url.host}`;
  }
  if (CFG.r2.accountId) return `https://${CFG.r2.accountId}.r2.cloudflarestorage.com`;
  fail('缺少 R2_ENDPOINT（或 R2_ACCOUNT_ID）');
}

/* ------------------------------ 读接口 ------------------------------ */

async function request(url, { headers = {}, binary = false } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      let res;
      try {
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${CFG.pat}`,
            'User-Agent': 'huxink-blog-memo-sync/2',
            ...headers,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const error = new Error(`HTTP ${res.status} ${res.statusText} · ${url}\n${body.slice(0, 300)}`);
        error.status = res.status;
        throw error;
      }
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.json();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      // 4xx（除了限流）重试没有意义
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) break;
      await sleep(attempt * 1200);
    }
  }
  throw lastError;
}

async function listPage(pageSize, pageToken) {
  const url = new URL(`${CFG.base}/api/v1/memos`);
  url.searchParams.set('pageSize', String(pageSize));
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  try {
    const json = await request(url.toString());
    const rows = Array.isArray(json) ? json : (json.memos || json.data || []);
    return { rows, nextPageToken: json && json.nextPageToken ? json.nextPageToken : '' };
  } catch (error) {
    // 服务端偶发 500（实测 pageSize>=100 会挂），降半页重试一次
    if (pageSize > 10 && (!error.status || error.status >= 500)) {
      const smaller = Math.max(10, Math.floor(pageSize / 2));
      console.warn(`pageSize=${pageSize} 失败（${error.message.split('\n')[0]}），降为 ${smaller} 重试`);
      return listPage(smaller, pageToken);
    }
    throw error;
  }
}

async function pullAllMemos() {
  const all = [];
  const seenTokens = new Set();
  let pageToken = '';
  let pageSize = CFG.pageSize;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows, nextPageToken } = await listPage(pageSize, pageToken);
    if (!rows.length) break;

    all.push(...rows);
    console.log(`拉到 ${all.length} 条（第 ${page + 1} 页，本页 ${rows.length}）`);

    if (!nextPageToken) break;
    if (seenTokens.has(nextPageToken)) fail(`pageToken 重复，分页可能失效（第 ${page + 1} 页）`);
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
    await sleep(250);
  }

  if (all.length >= MAX_PAGES * CFG.pageSize) fail(`达到安全上限 ${all.length} 条，可能未取全`);
  return all;
}

/* ------------------------------ 图床 ------------------------------ */

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function safeSegment(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(bucket, key) {
  const parts = [bucket, ...String(key || '').split('/').filter(Boolean)];
  return `/${parts.map(safeSegment).join('/')}`;
}

function objectUrl(key) {
  return `${CFG.r2.publicUrl}/${String(key).split('/').map(safeSegment).join('/')}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function prefixNow(date = new Date()) {
  return CFG.r2.prefix
    .replace(/\{yyyy\}/g, date.getFullYear())
    .replace(/\{mm\}/g, pad(date.getMonth() + 1))
    .replace(/\{dd\}/g, pad(date.getDate()))
    .replace(/^\/+|\/+$/g, '');
}

function slugifyAscii(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function buildKey(filename, attachmentId) {
  const original = String(filename || 'image');
  const dot = original.lastIndexOf('.');
  const ext = (dot >= 0 ? original.slice(dot) : '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const base = slugifyAscii(dot >= 0 ? original.slice(0, dot) : original) || String(attachmentId).slice(0, 8).toLowerCase();
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex').slice(0, 5);
  return `${prefixNow(now)}/${stamp}-${rand}-${base}${ext || '.bin'}`;
}

async function putToR2(key, buffer, contentType) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const origin = r2Origin();
  const host = new URL(origin).host;
  const payloadHash = sha256Hex(buffer);
  const headers = {
    host,
    'content-type': contentType || 'application/octet-stream',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const headerKeys = Object.keys(headers).sort();
  const canonicalHeaders = headerKeys.map(k => `${k}:${String(headers[k]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = headerKeys.join(';');
  const canonicalRequest = ['PUT', canonicalUri(CFG.r2.bucket, key), '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${CFG.r2.secretAccessKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const url = `${origin}${canonicalUri(CFG.r2.bucket, key)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${CFG.r2.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    fail(`R2 上传失败 ${res.status}：${text.slice(0, 200)}（key=${key}）`);
  }
}

/* ------------------------------ 附件转存 ------------------------------ */

function attachmentIdOf(attachment) {
  const name = String(attachment.name || attachment.id || '');
  return name.split('/').pop();
}

function attachmentCreatedTs(attachment) {
  const raw = attachment.createTime || attachment.createdTs || attachment.create_time;
  if (typeof raw === 'number') return Math.round(raw > 1e12 ? raw / 1000 : raw);
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : Math.round(Date.now() / 1000);
}

function mirrorAttachment(attachment, cache) {
  const name = String(attachment.name || '');
  const id = attachmentIdOf(attachment);
  const filename = String(attachment.filename || `${id}.bin`);
  const type = String(attachment.type || attachment.contentType || 'application/octet-stream');
  const size = Number(attachment.size || 0) || 0;

  const cached = cache[name];
  if (cached && cached.url) {
    return {
      id,
      creatorId: 1,
      createdTs: attachmentCreatedTs(attachment),
      updatedTs: attachmentCreatedTs(attachment),
      filename,
      externalLink: cached.url,
      type: cached.type || type,
      size: cached.size || size,
      cached: true,
    };
  }
  return null;
}

async function transferAttachment(attachment, cache) {
  const name = String(attachment.name || '');
  const id = attachmentIdOf(attachment);
  const filename = String(attachment.filename || `${id}.bin`);
  const type = String(attachment.type || attachment.contentType || 'application/octet-stream');
  const buffer = await request(`${CFG.base}/file/attachments/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`, { binary: true });
  const key = buildKey(filename, id);
  await putToR2(key, buffer, type);
  const record = {
    url: objectUrl(key),
    key,
    filename,
    type,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
  };
  cache[name] = record;
  console.log(`  转存附件 ${filename} → ${record.url}（${buffer.length} 字节）`);
  return record;
}

/* ------------------------------ 字段映射 ------------------------------ */

function extractTags(content) {
  const matches = String(content || '').match(/#([^\s#]+)/g) || [];
  return matches.map(tag => tag.slice(1));
}

function memoIdOf(memo) {
  const name = String(memo.name || '');
  if (name.includes('/')) return name.split('/').pop();
  return memo.id;
}

function memoCreatedTs(memo) {
  const raw = memo.createTime || memo.createdTs || memo.create_time;
  if (typeof raw === 'number') return Math.round(raw > 1e12 ? raw / 1000 : raw);
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : 0;
}

function memoStateOf(memo) {
  return String(memo.state || 'NORMAL').toUpperCase();
}

/* ------------------------------ 主流程 ------------------------------ */

(async () => {
  assertConfig();

  const raw = await pullAllMemos();
  if (!raw.length) fail('接口没有返回任何哔哔，请检查 PAT 权限或 FLAREMO_BASE');

  const kept = raw.filter(memo => CFG.states.includes(memoStateOf(memo)));
  const dropped = raw.length - kept.length;
  if (dropped) console.log(`跳过状态非 ${CFG.states.join('/')} 的 ${dropped} 条`);

  const cache = fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    : {};

  const pending = [];
  kept.forEach(memo => {
    (Array.isArray(memo.attachments) ? memo.attachments : []).forEach(attachment => {
      const name = String(attachment.name || '');
      if (!name) return;
      if (!cache[name]) pending.push(attachment);
    });
  });

  console.log(`共 ${kept.length} 条哔哔；待转存附件 ${pending.length} 个（已有缓存 ${Object.keys(cache).length} 个）`);

  if (pending.length && !CFG.dryRun) {
    for (let i = 0; i < pending.length; i += 1) {
      await transferAttachment(pending[i], cache);
      // 逐个落盘，中途失败重跑不会重复上传
      fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
      await sleep(120);
    }
  }

  const failed = [];
  const memos = kept
    .map(memo => {
      const content = String(memo.content || '').trim();
      const resourceList = [];
      (Array.isArray(memo.attachments) ? memo.attachments : []).forEach(attachment => {
        const item = mirrorAttachment(attachment, cache);
        if (item) {
          delete item.cached;
          resourceList.push(item);
        } else {
          failed.push(`${memoIdOf(memo)} / ${attachment.filename || attachment.name}`);
        }
      });
      return {
        id: memoIdOf(memo),
        content,
        createdTs: memoCreatedTs(memo),
        resourceList,
        tags: extractTags(content),
      };
    })
    .filter(memo => memo.createdTs > 0)
    .sort((a, b) => b.createdTs - a.createdTs);

  if (failed.length) {
    const label = `有 ${failed.length} 个附件没有拿到图床地址`;
    if (CFG.dryRun) {
      console.warn(`${label}（DRY_RUN 不转存，属正常）：`);
      failed.slice(0, 10).forEach(line => console.warn(`  - ${line}`));
    } else {
      console.error(`${label}，memos.json 未写入：`);
      failed.slice(0, 10).forEach(line => console.error(`  - ${line}`));
      fail('附件转存不完整，保留原有 memos.json');
    }
  }

  const target = CFG.dryRun ? OUT_FILE.replace(/\.json$/, '.dryrun.json') : OUT_FILE;
  fs.writeFileSync(target, `${JSON.stringify(memos, null, 2)}\n`, 'utf-8');

  const withImages = memos.filter(m => m.resourceList.length).length;
  const imageCount = memos.reduce((sum, m) => sum + m.resourceList.length, 0);
  const inlineImages = memos.reduce((sum, m) => sum + (m.content.match(/!\[/g) || []).length, 0);
  console.log(
    `写入 ${memos.length} 条 → ${path.relative(ROOT, target)}` +
    `（带附件 ${withImages} 条 / 图床外链 ${imageCount} 张 / 正文内联图 ${inlineImages} 张）`
  );
  if (CFG.dryRun) console.log('DRY_RUN 模式：未上传、未覆盖正式文件');
})().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
