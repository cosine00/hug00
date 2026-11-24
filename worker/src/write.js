/**
 * 撰写页后端：图片进 R2、文章进 GitHub。
 *
 * 为什么新增这一层，而不是让前端直连
 * ──────────────────────────────────
 * 老后台是把 GitHub PAT 和 R2 密钥存在 localStorage 里、用浏览器直接签名上传。
 * 桌面端还能接受，手机上等于把仓库写权限塞进 iCloud 备份。这里改成：
 *   浏览器 → 会话 Cookie → Worker（拿着云端的密钥）→ GitHub / R2
 * 鉴权复用 comments 那套（COMMENTS_ADMIN_TOKEN 换 HttpOnly Cookie），没有新增口令。
 *
 * 接口
 * ────
 *   GET  /api/write/health    配置自检：GitHub token、R2 绑定是否就位
 *   GET  /api/write/posts?limit=5
 *                             最近发布的文章（含正文），用于「最近发布」里挑一篇来改
 *   GET  /api/write/images?limit=10
 *                             最近上传的图片，来自 R2
 *   GET  /api/write/tags      已有标签（带使用次数），给标签选择器做候选
 *   GET  /api/write/drafts    云端草稿（?since=毫秒 只取更新的）
 *   POST /api/write/drafts    { drafts: [...] } 批量上行，同 id 按 updated_at 定胜负
 *   POST /api/write/upload    原始字节 PUT 进 R2，返回公开地址
 *   POST /api/write/post      { title, content, tags, slug }            新建
 *                             { path, title, content, tags, slug }      更新原文件
 */

import { fail, json, readJson } from './util.js';
import { all, batch, ensureSchema } from './db.js';

const GITHUB_API = 'https://api.github.com';
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const AUTHOR = '落落vici';
const POSTS_DIR = 'content/posts';
const RECENT_LIMIT = 5;
const RECENT_IMAGE_LIMIT = 10;
const TAG_CACHE_SECONDS = 900;

const EXT_BY_TYPE = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
};

/** 统一用北京时间切年月，别让晚上发的图落到前一天。 */
function beijingParts(date = new Date()) {
  const t = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    yyyy: String(t.getUTCFullYear()),
    mm: pad(t.getUTCMonth() + 1),
    dd: pad(t.getUTCDate()),
    hh: pad(t.getUTCHours()),
    mi: pad(t.getUTCMinutes()),
    ss: pad(t.getUTCSeconds()),
    stamp: `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}`,
    datetime: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`,
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
  };
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomTail(len = 6) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return hex(buf).slice(0, len);
}

/** Worker 里没有 Buffer，btoa 只能吃 latin1，先转字节再分段拼接。 */
export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** GitHub Contents API 的 content 是带换行的 base64，先剥掉空白再解码成 UTF-8。 */
export function textFromBase64(data) {
  const binary = atob(String(data || '').replace(/[\r\n\s]/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export function repoOf(env) {
  return String(env.WRITE_GITHUB_REPO || '').trim();
}

export function branchOf(env) {
  return String(env.WRITE_GITHUB_BRANCH || 'master').trim() || 'master';
}

function publicBase(env) {
  const raw = String(env.R2_PUBLIC_URL || 'https://img.hux.ink').trim().replace(/\/+$/, '');
  return raw || 'https://img.hux.ink';
}

export function githubReady(env) {
  return Boolean(String(env.GITHUB_TOKEN || '').trim()) && Boolean(repoOf(env));
}

/** 401/403 是最常见也最难自查的故障，单独给一句人话。 */
export function githubTrouble(status, message) {
  if (status === 401) {
    return fail(502, 'token_invalid', 'GitHub 令牌失效或已过期：重新生成 PAT 后 npx wrangler secret put GITHUB_TOKEN');
  }
  if (status === 403) {
    return fail(502, 'token_forbidden', `GitHub 拒绝写入（403）：${message || '权限不足'}。确认令牌对这个仓库有 Contents 读写权限`);
  }
  return fail(502, 'commit_failed', `提交失败：${message}`);
}

/** YAML 里带冒号、井号、引号的值必须加引号，否则 front matter 会解析错。 */
function yamlString(value) {
  const text = String(value || '');
  if (!text) return '""';
  if (/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .,!?()（）\-—、：:；;]*$/.test(text) && !/[:#]/.test(text)) {
    return text;
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 反过来：把 "带引号" 的值还原成纯文本。 */
function yamlValue(raw) {
  let text = String(raw == null ? '' : raw).trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return text;
}

/** 文件名里不能出现的字符换成短横线；中文原样保留，Hugo 能处理。 */
function safeFileName(title) {
  return String(title || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60) || '未命名';
}

/** 允许 posts 下的分类子目录，但不接受反斜杠、空段或 . / .. 穿越。 */
function validPostPath(path) {
  const text = String(path || '');
  if (!/^content\/posts\/(?:[^/\\]+\/)*[^/\\]+\.md$/i.test(text)) return false;
  return !text.split('/').some((part) => part === '.' || part === '..' || !part);
}

function parseTags(input) {
  if (Array.isArray(input)) return input.map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  return String(input || '')
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** 粗粒度近似 Hugo 的 urlize，够拼一个可点的预览链接。 */
function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/['"’‘“”]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/* ----------------------------- front matter ----------------------------- */

/**
 * 把 Markdown 拆成「front matter 条目 + 正文」。
 * 只认顶格的 `key:`，缩进行（含 `  - tag` 这种列表项）归给上一条。
 */
export function splitFrontMatter(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) return { entries: [], body: source };
  const end = source.indexOf('\n---', 3);
  if (end === -1) return { entries: [], body: source };

  const header = source.slice(4, end);
  const nextLine = source.indexOf('\n', end + 1);
  const body = (nextLine === -1 ? '' : source.slice(nextLine + 1)).replace(/^(?:[ \t]*\n)+/, '');

  const entries = [];
  for (const line of header.split('\n')) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      if (entries.length) entries[entries.length - 1].lines.push(line);
      continue;
    }
    const match = line.match(/^([A-Za-z_][\w-]*):[ \t]?(.*)$/);
    if (!match) {
      if (entries.length) entries[entries.length - 1].lines.push(line);
      continue;
    }
    entries.push({ key: match[1], inline: match[2], lines: [] });
  }
  return { entries, body };
}

function entryValue(entries, key) {
  const found = entries.find((item) => item.key === key);
  return found ? yamlValue(found.inline) : '';
}

function entryTags(entries) {
  const found = entries.find((item) => item.key === 'tags');
  if (!found) return [];
  const inline = found.inline.trim();
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((t) => yamlValue(t))
      .filter(Boolean);
  }
  return found.lines
    .map((line) => yamlValue(String(line).replace(/^\s*-\s*/, '')))
    .filter(Boolean);
}

/** 文件名的日期前缀去掉就是 Hugo 的默认 slug。 */
function slugFromName(name) {
  return slugify(String(name || '').replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}[ -]*/, ''));
}

function postUrl(slug, name) {
  const key = String(slug || '').trim() || slugFromName(name);
  // Hugo 默认 disablePathToLower=false，会把路径转小写；这里跟着转，预览链接才不会 404
  return key ? `/posts/${key}/`.toLowerCase() : '';
}

/** 一篇文章的元信息，列表和更新都用它。 */
function buildMeta(path, sha, text) {
  const { entries, body } = splitFrontMatter(text);
  const name = path.split('/').pop();
  const fallbackTitle = String(name).replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}[ -]*/, '');
  const title = entryValue(entries, 'title') || fallbackTitle;
  const slug = entryValue(entries, 'slug');
  const date = entryValue(entries, 'date') || (String(name).match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
  const plain = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*`|\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    path,
    name,
    sha,
    title,
    slug,
    date,
    tags: entryTags(entries),
    draft: entryValue(entries, 'draft') === 'true',
    url: postUrl(slug, name),
    excerpt: plain.slice(0, 90),
    words: plain.replace(/\s+/g, '').length,
    content: body.replace(/\s+$/, ''),
  };
}

/* ------------------------------- 配置自检 ------------------------------- */

export function handleWriteHealth(env) {
  return json({
    ok: true,
    github: githubReady(env),
    repo: repoOf(env) || null,
    branch: branchOf(env),
    r2: Boolean(env.MEDIA),
    r2Public: publicBase(env),
  });
}

/* ------------------------------- GitHub ------------------------------- */

export async function githubRequest(env, path, init = {}) {
  const token = String(env.GITHUB_TOKEN || '').trim();
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'hux-ink-write',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { response, body };
}

export function contentEndpoint(env, path) {
  const encoded = String(path).split('/').map(encodeURIComponent).join('/');
  return `/repos/${repoOf(env)}/contents/${encoded}`;
}

export async function readPostFile(env, path) {
  const endpoint = `${contentEndpoint(env, path)}?ref=${encodeURIComponent(branchOf(env))}`;
  const { response, body } = await githubRequest(env, endpoint);
  if (!response.ok || !body || typeof body.content !== 'string') {
    return { error: (body && body.message) || `GitHub 返回 ${response.status}` };
  }
  return { sha: body.sha, text: textFromBase64(body.content) };
}

/* ------------------------------ 最近文章 ------------------------------ */

async function readPublishedPostIndex(env) {
  const origin = String(env.WRITE_SITE_ORIGIN || 'https://hux.ink').trim().replace(/\/+$/, '');
  const response = await fetch(`${origin}/write-index.json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'hux-ink-write' },
  });
  if (!response.ok) throw new Error(`文章日期索引返回 ${response.status}`);
  const body = await response.json();
  if (!body || !Array.isArray(body.posts)) throw new Error('文章日期索引格式不正确');
  const posts = body.posts
    .filter((item) => item && validPostPath(item.path) && item.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!posts.length) throw new Error('文章日期索引是空的');
  return posts;
}

/**
 * 索引还没构建出来时的兜底：用 GitHub 目录按文件名倒序。
 * 只列 content/posts 第一层，obsidian/ 这类子目录里的文章会漏 —— 所以只当降级用，
 * 返回体里 order 会标成 filename_fallback，前端据此提示。
 */
async function listPostsByFileName(env) {
  const endpoint = `${contentEndpoint(env, POSTS_DIR)}?ref=${encodeURIComponent(branchOf(env))}`;
  const { response, body } = await githubRequest(env, endpoint);
  if (!response.ok || !Array.isArray(body)) {
    const message = (body && body.message) || `GitHub 返回 ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body
    .filter((item) => item && item.type === 'file' && /\.md$/i.test(item.name) && !/^_/.test(item.name))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
    .map((item) => ({
      path: item.path,
      title: item.name.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}[ -]*/, ''),
      date: (item.name.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
      sha: item.sha,
    }));
}

export async function handleWritePosts(env, url) {
  if (!githubReady(env)) {
    return fail(503, 'github_not_configured', '还没配置仓库凭证：wrangler secret put GITHUB_TOKEN');
  }

  const limitParam = Number.parseInt(url.searchParams.get('limit'), 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : RECENT_LIMIT, 1), 12);
  let indexed;
  let order = 'front_matter_date';
  try {
    indexed = await readPublishedPostIndex(env);
  } catch (error) {
    console.error('[write] post index failed:', error && error.message);
    try {
      indexed = await listPostsByFileName(env);
      order = 'filename_fallback';
    } catch (fallbackError) {
      console.error('[write] fallback list failed:', fallbackError && fallbackError.message);
      return githubTrouble(fallbackError && fallbackError.status, '读不到文章目录，稍后再试');
    }
  }

  const picked = indexed.slice(0, limit);
  const loaded = await Promise.all(
    picked.map(async (item) => {
      const got = await readPostFile(env, item.path);
      if (got.error) {
        const name = item.path.split('/').pop();
        return { path: item.path, name, sha: '', title: item.title || name.replace(/\.md$/i, ''), date: item.date, tags: [], content: '', error: got.error };
      }
      const meta = buildMeta(item.path, got.sha, got.text);
      // 索引里有 Hugo 实际渲染出来的 RelPermalink，比我们自己拼的 slug 准（大小写、标点）
      if (item.url) meta.url = item.url;
      return meta;
    })
  );

  return json({ ok: true, total: indexed.length, order, posts: loaded });
}

/* ------------------------------ 最近图片 ------------------------------ */

/**
 * 图床里存在两套目录前缀：早年 admin 页写的是 `image/YYYY/MM/`，
 * 后来改成了 `images/YYYY/MM/`。两套都还有文件，只扫一套就会漏。
 */
const IMAGE_ROOTS = ['image/', 'images/'];

/** 从当月往前数 count 个月，返回 `YYYY/MM/` 片段（北京时间） */
export function recentMonthKeys(count = 12) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const keys = [];
  for (let offset = 0; offset < count; offset += 1) {
    const d = new Date(Date.UTC(year, month - offset, 1));
    keys.push(`${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/`);
  }
  return keys;
}

export async function handleWriteImages(env, url) {
  if (!env.MEDIA) return fail(503, 'r2_not_configured', 'R2 图床还没有绑定');
  const limitParam = Number.parseInt(url.searchParams.get('limit'), 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : RECENT_IMAGE_LIMIT, 1), 30);
  const objects = [];
  const months = recentMonthKeys(12);

  try {
    // 一批 3 个月 × 两套前缀并发；凑够 limit 就停，绝大多数情况第一批就够
    for (let i = 0; i < months.length && objects.length < limit; i += 3) {
      const prefixes = [];
      for (const key of months.slice(i, i + 3)) {
        for (const root of IMAGE_ROOTS) prefixes.push(root + key);
      }
      const pages = await Promise.all(
        prefixes.map((prefix) => env.MEDIA.list({ prefix, limit: 500, include: ['httpMetadata'] }))
      );
      for (const page of pages) {
        if (page && Array.isArray(page.objects)) objects.push(...page.objects);
      }
    }
  } catch (error) {
    console.error('[write] r2 list failed:', error && error.message);
    return fail(502, 'r2_list_failed', '读取最近图片失败，稍后再试');
  }

  const seen = new Set();
  const images = objects
    .filter((item) => {
      if (!item || !item.key) return false;
      if (!/\.(?:avif|gif|heic|jpe?g|png|webp)$/i.test(item.key)) return false;
      // 两套前缀不会重叠，但并发分页仍可能带回同一个 key，按 key 去重最稳
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => {
      const byUpload = new Date(b.uploaded || 0).getTime() - new Date(a.uploaded || 0).getTime();
      return byUpload || String(b.key).localeCompare(String(a.key));
    })
    .slice(0, limit)
    .map((item) => ({
      key: item.key,
      url: `${publicBase(env)}/${item.key}`,
      size: Number(item.size || 0),
      uploaded: item.uploaded ? new Date(item.uploaded).toISOString() : null,
      type: item.httpMetadata && item.httpMetadata.contentType ? item.httpMetadata.contentType : null,
    }));

  return json({ ok: true, images });
}

/* ------------------------------- 标签候选 ------------------------------- */

/**
 * 标签从已发布的 /tags/ 页面抓，比逐个读 148 个 Markdown 便宜得多。
 * 代价是刚发的新标签要等这次构建完成才出现在候选里 —— 手输仍然可以。
 */
export async function handleWriteTags(env) {
  const origin = String(env.WRITE_SITE_ORIGIN || 'https://hux.ink').replace(/\/+$/, '');
  const target = `${origin}/tags/`;

  const cacheKey = new Request(target, { method: 'GET' });
  let cache = null;
  try {
    cache = caches.default;
  } catch {
    cache = null;
  }
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let tags = [];
  try {
    const response = await fetch(target, {
      headers: { 'User-Agent': 'hux-ink-write', Accept: 'text/html' },
    });
    if (response.ok) {
      const html = await response.text();
      const pattern = /<a[^>]+href="\/(?:tags|tag)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*\((\d+)\)/g;
      const seen = new Set();
      let match = pattern.exec(html);
      while (match) {
        const name = match[2].replace(/<[^>]*>/g, '').trim();
        const count = Number.parseInt(match[3], 10) || 0;
        if (name && !seen.has(name)) {
          seen.add(name);
          tags.push({ name, count });
        }
        match = pattern.exec(html);
      }
    }
  } catch (error) {
    console.error('[write] tags fetch failed:', error && error.message);
  }

  tags.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  const result = json({ ok: true, tags, fetchedAt: new Date().toISOString() });
  if (cache && tags.length) {
    const copy = result.clone();
    const headers = new Headers(copy.headers);
    headers.set('Cache-Control', `public, max-age=${TAG_CACHE_SECONDS}`);
    cache.put(cacheKey, new Response(copy.body, { status: 200, headers })).catch(() => {});
  }
  return result;
}

/* -------------------------------- 传图 --------------------------------- */

export async function handleWriteUpload(request, env) {
  if (!env.MEDIA) {
    return fail(
      503,
      'r2_not_configured',
      'R2 还没绑定：wrangler.toml 里加 [[r2_buckets]]，binding = "MEDIA"，然后 wrangler deploy'
    );
  }

  const type = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) return fail(415, 'bad_type', '只接受图片');

  const buffer = await request.arrayBuffer();
  if (!buffer.byteLength) return fail(400, 'empty_body', '收到的是空文件');
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return fail(413, 'too_large', `图片 ${(buffer.byteLength / 1048576).toFixed(1)}MB，超过 8MB 上限`);
  }

  const parts = beijingParts();
  const ext = EXT_BY_TYPE[type] || 'bin';
  const key = `images/${parts.yyyy}/${parts.mm}/w${parts.stamp}-${randomTail()}.${ext}`;

  try {
    await env.MEDIA.put(key, buffer, {
      httpMetadata: {
        contentType: type,
        // 文件名带时间戳和随机尾巴，内容不会变，可以长缓存
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('[write] r2 put failed:', error && error.message);
    return fail(502, 'r2_put_failed', '写入图床失败，稍后再试');
  }

  return json({
    ok: true,
    key,
    url: `${publicBase(env)}/${key}`,
    size: buffer.byteLength,
  });
}

/* ------------------------------- 草稿同步 ------------------------------- */

/**
 * 草稿原来是纯 localStorage：换台设备就没了，清一次网站数据也就没了。
 * 这里落一份到 D1，但**本机仍然是工作副本**——断网、没登录都能照写，
 * 云端只在登录后负责搬运。冲突判据是 updated_at（毫秒），谁新听谁的。
 *
 * 两个细节值得记：
 *   1) 删除必须软删。硬删的话对端拉列表发现「本地有、云端没有」，会把它又推回来。
 *   2) 客户端时钟偏慢的设备会一直推不上去。所以被拒的一方会拿到云端版本并覆盖本地，
 *      先收敛再谈别的，不能让它卡在互相覆盖里。
 */
const DRAFT_MAX_BATCH = 40;
const DRAFT_MAX_ROWS = 200;
const DRAFT_BODY_LIMIT = 200000;

const DRAFT_COLUMNS =
  'id, title, body, tags, slug, edit_path, edit_name, edit_url, published_at, created_at, updated_at, deleted_at';

// 读的时候多带一个 source：Beta 前端要靠它认出「这篇是 Drafts 发来的」，
// 从而跳过打开时那段自动补段落（那会把 Markdown 里的软换行改成硬段落）。
// 写的时候不带它 —— 来源只有导入接口能写，客户端改不了，也就不会被同步冲掉。
const DRAFT_READ_COLUMNS = `${DRAFT_COLUMNS}, source`;

function draftFromRow(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch {
    tags = [];
  }
  if (!Array.isArray(tags)) tags = [];
  return {
    id: row.id,
    title: row.title || '',
    body: row.body || '',
    tags: tags.map((tag) => String(tag)).slice(0, 10),
    slug: row.slug || '',
    edit: row.edit_path
      ? { path: row.edit_path, name: row.edit_name || '', url: row.edit_url || '' }
      : null,
    publishedAt: Number(row.published_at || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    deletedAt: Number(row.deleted_at || 0),
    // '' 就是普通草稿；'drafts' 表示这篇是 Drafts 发来的
    source: row.source || '',
  };
}

/** 只放行形状对得上的草稿，别让一个畸形 id 把整批 upsert 带崩。 */
export function cleanDraft(input) {
  if (!input || typeof input !== 'object') return null;
  const id = String(input.id || '').trim();
  if (!/^[\w-]{2,64}$/.test(id)) return null;

  const body = String(input.body || '');
  if (body.length > DRAFT_BODY_LIMIT) return null;

  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const edit = input.edit && typeof input.edit === 'object' && String(input.edit.path || '').trim()
    ? {
        path: String(input.edit.path).trim().slice(0, 200),
        name: String(input.edit.name || '').slice(0, 200),
        url: String(input.edit.url || '').slice(0, 300),
      }
    : null;

  const updatedAt = Number(input.updatedAt) > 0 ? Math.floor(Number(input.updatedAt)) : Date.now();
  const createdAt = Number(input.createdAt) > 0 ? Math.floor(Number(input.createdAt)) : updatedAt;

  return {
    id,
    title: String(input.title || '').slice(0, 300),
    body,
    tags: JSON.stringify(tags.slice(0, 10)),
    slug: String(input.slug || '').slice(0, 200),
    editPath: edit ? edit.path : null,
    editName: edit ? edit.name : null,
    editUrl: edit ? edit.url : null,
    publishedAt: Number(input.publishedAt) > 0 ? Math.floor(Number(input.publishedAt)) : 0,
    createdAt,
    updatedAt,
    // 墓碑时间：前端删草稿时传 now，让另一台设备知道这篇是被删了，不是还没同步
    deletedAt: Number(input.deletedAt) > 0 ? Math.floor(Number(input.deletedAt)) : 0,
  };
}

export async function handleWriteDraftsGet(env, url) {
  await ensureSchema(env);
  const sinceParam = Number.parseInt(url.searchParams.get('since'), 10);
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : 0;
  const rows = await all(
    env,
    `SELECT ${DRAFT_READ_COLUMNS} FROM write_drafts
       WHERE updated_at > ? AND deleted_at = 0
       ORDER BY updated_at DESC LIMIT ${DRAFT_MAX_ROWS}`,
    [since]
  );
  return json({ ok: true, drafts: rows.map(draftFromRow), serverTime: Date.now() });
}

export async function handleWriteDraftsSave(request, env) {
  await ensureSchema(env);
  // 不用 util 的 readJson：它把请求体卡在 64KB，一篇长文（中文按字符算也占空间）
  // 加上 JSON 转义很容易顶上去。草稿这条线单独给一个更宽的口子。
  const text = await request.text();
  if (text.length > 400000) return fail(413, 'drafts_too_large', '这一批草稿太大了，分几次同步');
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return fail(400, 'bad_json', '草稿数据不是合法 JSON');
  }
  const incoming = payload && Array.isArray(payload.drafts) ? payload.drafts : [];
  const drafts = incoming.slice(0, DRAFT_MAX_BATCH).map(cleanDraft).filter(Boolean);
  if (!drafts.length) return json({ ok: true, saved: 0, skipped: 0, drafts: [], serverTime: Date.now() });

  // 一条语句一个草稿，放进同一个 batch：要么整批落地，要么一条都不落。
  // ON CONFLICT 的 WHERE 让「旧版本」变成 no-op，changes=0 就说明云端更新、该由云端胜出。
  const statements = drafts.map((draft) => ({
    sql: `INSERT INTO write_drafts (${DRAFT_COLUMNS})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title        = excluded.title,
            body         = excluded.body,
            tags         = excluded.tags,
            slug         = excluded.slug,
            edit_path    = excluded.edit_path,
            edit_name    = excluded.edit_name,
            edit_url     = excluded.edit_url,
            published_at = excluded.published_at,
            updated_at   = excluded.updated_at,
            deleted_at   = excluded.deleted_at
          WHERE excluded.updated_at > write_drafts.updated_at`,
    args: [
      draft.id,
      draft.title,
      draft.body,
      draft.tags,
      draft.slug,
      draft.editPath,
      draft.editName,
      draft.editUrl,
      draft.publishedAt,
      draft.createdAt,
      draft.updatedAt,
      draft.deletedAt,
    ],
  }));

  let results = [];
  try {
    results = await batch(env, statements);
  } catch (error) {
    console.error('[write] draft batch failed:', error && error.message);
    return fail(500, 'draft_save_failed', '草稿没写进云库，稍后再试');
  }

  const lost = drafts.filter((_, index) => Number((results[index] && results[index].meta && results[index].meta.changes) || 0) === 0);
  let conflicts = [];
  if (lost.length) {
    const marks = lost.map(() => '?').join(',');
    const rows = await all(env, `SELECT ${DRAFT_READ_COLUMNS} FROM write_drafts WHERE id IN (${marks})`, lost.map((d) => d.id));
    conflicts = rows.map(draftFromRow);
  }

  return json({
    ok: true,
    saved: drafts.length - lost.length,
    skipped: lost.length,
    drafts: conflicts,
    serverTime: Date.now(),
  });
}

/* -------------------------------- 发文章 -------------------------------- */

/** 新文章：按当前时间拼一套干净的 front matter。 */
function buildFrontMatter({ title, tags, slug, datetime }) {
  const front = [
    '---',
    `title: ${yamlString(title)}`,
    `author: ${AUTHOR}`,
    `date: "${datetime}"`,
    `lastmod: "${datetime}"`,
  ];
  if (tags.length) {
    front.push('tags:');
    for (const tag of tags) front.push(`  - ${yamlString(tag)}`);
  } else {
    front.push('tags: []');
  }
  if (slug) front.push(`slug: ${yamlString(slug)}`);
  front.push('draft: false', '---', '');
  return front.join('\n');
}

/**
 * 更新已有文章：保留 date、author 和一切我们不管的字段（feature、description……），
 * 只改写 title / lastmod / tags / slug，正文用这次提交的内容。
 * 这样 PC 上手动加的字段不会被手机覆盖掉。
 */
export function patchFrontMatter(text, { title, tags, slug, datetime, content }) {
  const { entries, body } = splitFrontMatter(text);
  const managed = new Set(['title', 'lastmod', 'tags', 'slug']);

  const head = [`title: ${yamlString(title)}`];
  for (const entry of entries) {
    if (managed.has(entry.key)) continue;
    head.push(entry.inline === '' ? `${entry.key}:` : `${entry.key}: ${entry.inline}`);
    for (const line of entry.lines) head.push(line);
  }

  const tail = [`lastmod: "${datetime}"`];
  if (tags.length) {
    tail.push('tags:');
    for (const tag of tags) tail.push(`  - ${yamlString(tag)}`);
  } else {
    tail.push('tags: []');
  }
  if (slug) tail.push(`slug: ${yamlString(slug)}`);

  // lastmod 紧跟在 date 后面，diff 看起来更像人写的
  const dateAt = head.findIndex((line) => /^date:/.test(line));
  const lines = dateAt >= 0 ? [...head.slice(0, dateAt + 1), ...tail, ...head.slice(dateAt + 1)] : [...head, ...tail];

  const cleanBody = String(content == null ? body : content).replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return `---\n${lines.join('\n')}\n---\n\n${cleanBody}\n`;
}

export async function handleWritePost(request, env) {
  if (!githubReady(env)) {
    return fail(
      503,
      'github_not_configured',
      '还没配置仓库凭证：wrangler secret put GITHUB_TOKEN，并在 [vars] 里写 WRITE_GITHUB_REPO'
    );
  }

  const body = await readJson(request);
  const title = String((body && body.title) || '').trim();
  const content = String((body && body.content) || '');
  if (!title) return fail(400, 'title_required', '标题不能为空');
  if (!content.trim()) return fail(400, 'content_required', '正文不能为空');

  const tags = parseTags(body && body.tags);
  const slug = String((body && body.slug) || '').trim().replace(/^\/+|\/+$/g, '');
  // 取请求到达的这一刻：用户点「发布」后前端立刻发请求，所以这基本就是点击时间（北京时间）
  const parts = beijingParts();
  const targetPath = String((body && body.path) || '').trim();

  /* ---------------------------- 更新原文件 ---------------------------- */
  if (targetPath) {
    if (!validPostPath(targetPath)) {
      return fail(400, 'bad_path', '只能更新 content/posts 下的 Markdown 文件');
    }

    const patch = { title, tags, slug, datetime: parts.datetime, content };
    let current = await readPostFile(env, targetPath);
    if (current.error) return fail(404, 'post_not_found', `读不到原文章：${current.error}`);

    const endpoint = contentEndpoint(env, targetPath);
    const put = (file) =>
      githubRequest(env, endpoint, {
        method: 'PUT',
        body: JSON.stringify({
          message: `post: 更新 ${title}`,
          content: base64Utf8(patchFrontMatter(file.text, patch)),
          branch: branchOf(env),
          sha: file.sha,
        }),
      });

    let result = await put(current);
    // 撞车（网页端刚改过）：重取 sha 再来一次，别把用户的手稿丢掉
    if (result.response.status === 409 || result.response.status === 422) {
      current = await readPostFile(env, targetPath);
      if (!current.error) result = await put(current);
    }

    if (!result.response.ok) {
      const message = (result.body && result.body.message) || `GitHub 返回 ${result.response.status}`;
      console.error('[write] update failed:', message);
      return githubTrouble(result.response.status, `更新失败：${message}`);
    }

    const commit = result.body && result.body.commit;
    return json({
      ok: true,
      updated: true,
      path: targetPath,
      name: targetPath.split('/').pop(),
      sha: (result.body && result.body.content && result.body.content.sha) || '',
      commit: commit && commit.html_url ? commit.html_url : '',
      liveUrl: postUrl(slug, targetPath.split('/').pop()),
    });
  }

  /* ----------------------------- 新建一篇 ----------------------------- */
  const fileName = `${parts.date} ${safeFileName(title)}.md`;
  const filePath = `${POSTS_DIR}/${fileName}`;
  const markdown = `${buildFrontMatter({ title, tags, slug, datetime: parts.datetime })}\n${content
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '')}\n`;

  const endpoint = contentEndpoint(env, filePath);
  const payload = {
    message: `post: ${title}`,
    content: base64Utf8(markdown),
    branch: branchOf(env),
  };

  let result = await githubRequest(env, endpoint, { method: 'PUT', body: JSON.stringify(payload) });
  let updated = false;

  // 同名文章已存在（比如标题重复）：取出 sha 当更新提交，别把用户挡在门外
  if (result.response.status === 422 || result.response.status === 409) {
    const existing = await githubRequest(env, `${endpoint}?ref=${encodeURIComponent(branchOf(env))}`);
    const sha = existing.body && existing.body.sha;
    if (sha) {
      result = await githubRequest(env, endpoint, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, sha, message: `post: 更新 ${title}` }),
      });
      updated = true;
    }
  }

  if (!result.response.ok) {
    const message = (result.body && result.body.message) || `GitHub 返回 ${result.response.status}`;
    console.error('[write] commit failed:', message);
    return githubTrouble(result.response.status, `提交失败：${message}`);
  }

  const commit = result.body && result.body.commit;
  return json({
    ok: true,
    updated,
    path: filePath,
    name: fileName,
    sha: (result.body && result.body.content && result.body.content.sha) || '',
    commit: commit && commit.html_url ? commit.html_url : '',
    liveUrl: postUrl(slug, fileName),
  });
}
