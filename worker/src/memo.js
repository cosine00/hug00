/**
 * 「发哔哔」：把 Beta 后台写的一小段 Markdown 发到 FlareMo。
 *
 * 为什么走 FlareMo 的接口，而不是直接写 D1：
 *   FlareMo 的创建接口后面挂着它自己的业务流程（正文规范化、标签解析、
 *   修订记录、以及把 memo_id 推给 GitHub Actions 的单条同步事件）。
 *   绕过它去写库，这些都会漏掉，博客也收不到即时同步。
 *
 * 图片不经过这里：前端先走既有的 POST /api/write/upload 传进博客自己的
 * R2 图床（img.hux.ink），拿到公开地址后作为 `![](url)` 拼进正文。
 * 这样 FlareMo 和博客两头都直接能显示，也不用把图在 FlareMo 那边再存一份。
 */

import { fail, json } from './util.js';

const TIMEOUT_MS = 20000;
const MAX_LEN = 10000;
const MAX_IMAGES = 9;
const COOLDOWN_MS = 3000;

/* 单 isolate 内的节流：挡连点、挡双击，不追求跨边缘节点精确 */
const lastPostAt = new Map();
const seenRid = new Map();

function base(env) {
  return String(env.FLAREMO_BASE || 'https://drafts.hux.ink').trim().replace(/\/+$/, '');
}

function pat(env) {
  return String(env.FLAREMO_PAT || '').trim();
}

/** 只认自家图床的地址：正文里的图片一律来自刚上传的那几张，不让别的域混进来 */
function imageAllowed(url, env) {
  const publicBase = String(env.R2_PUBLIC_URL || 'https://img.hux.ink').trim().replace(/\/+$/, '');
  return url.indexOf(publicBase + '/') === 0;
}

async function callFlaremo(env, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(base(env) + path, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${pat(env)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把这次发布告诉博客那边的单条同步（workflow_dispatch 带 memo_id）。
 * 失败不算发布失败：每日 03:17 的全量会兜底，只是会慢一些。
 */
async function triggerSync(env, memoId) {
  const token = String(env.GITHUB_TOKEN || '').trim();
  if (!token) return 'no_token';
  const repo = String(env.WRITE_GITHUB_REPO || '').trim();
  if (!repo) return 'no_repo';
  const branch = String(env.WRITE_GITHUB_BRANCH || 'master').trim() || 'master';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/fetch-memos.yml/dispatches`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'hux-beta',
        },
        body: JSON.stringify({ ref: branch, inputs: { memo_id: String(memoId), action: 'upsert' } }),
      }
    );
    if (response.status === 204) return 'queued';
    const detail = await response.text().catch(() => '');
    console.error('[memo] dispatch failed:', response.status, detail.slice(0, 160));
    return 'failed';
  } catch (error) {
    console.error('[memo] dispatch error:', String((error && error.message) || error).slice(0, 120));
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

export async function handleWriteMemo(request, env) {
  if (!pat(env)) {
    return fail(503, 'flaremo_not_configured', '还没配 FlareMo 的令牌：npx wrangler secret put FLAREMO_PAT');
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return fail(400, 'bad_json', '请求体不是 JSON');
  }

  const text = String(body.content == null ? '' : body.content).replace(/\r\n/g, '\n').trim();
  const images = Array.isArray(body.images) ? body.images.map((item) => String(item || '').trim()) : [];
  const rid = String(body.rid || '').trim().slice(0, 64);

  if (!text && !images.length) return fail(400, 'empty_memo', '写两句再发');
  if (text.length > MAX_LEN) return fail(413, 'memo_too_long', `正文 ${text.length} 字，超过 ${MAX_LEN} 字上限`);
  if (images.length > MAX_IMAGES) return fail(413, 'too_many_images', `一次最多 ${MAX_IMAGES} 张图`);
  const outside = images.filter((url) => !imageAllowed(url, env));
  if (outside.length) return fail(400, 'bad_image', '图片地址不是本站图床的，重新传一次');

  // 幂等：同一个 rid 只认一次，前端重试也不会发两条
  if (rid && seenRid.has(rid)) {
    const hit = seenRid.get(rid);
    if (Date.now() - hit.at < 120000) return json({ ok: true, id: hit.id, sync: 'duplicate' });
  }

  const who = String(request.headers.get('cf-connecting-ip') || 'local');
  const now = Date.now();
  const last = lastPostAt.get(who) || 0;
  if (now - last < COOLDOWN_MS) return fail(429, 'too_fast', '刚发过，等两三秒再发');
  lastPostAt.set(who, now);

  // 图片按顺序接在正文后面，每张一行；正文自己要是已经贴了同样的地址就不重复加
  const lines = [text];
  images.forEach((url) => {
    if (text.indexOf(url) === -1) lines.push(`![](${url})`);
  });
  const content = lines.filter(Boolean).join('\n\n');

  let response;
  try {
    response = await callFlaremo(env, '/api/v1/memos', {
      content,
      visibility: 'PUBLIC',
    });
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || /abort/i.test(String(error.message || '')));
    console.error('[memo] create failed:', aborted ? 'timeout' : String((error && error.message) || error).slice(0, 120));
    return aborted
      ? fail(504, 'flaremo_timeout', 'FlareMo 没回音，过一会儿再试')
      : fail(502, 'flaremo_network', '连不上 FlareMo，检查网络再试');
  }

  const raw = await response.text().catch(() => '');
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (error) {
    payload = {};
  }

  if (!response.ok) {
    const detail = String((payload.error && payload.error.message) || payload.message || '').slice(0, 140);
    console.error('[memo] flaremo status', response.status, detail);
    if (response.status === 401 || response.status === 403) {
      return fail(502, 'flaremo_auth_failed', 'FlareMo 令牌无效或没写权限：重新 npx wrangler secret put FLAREMO_PAT');
    }
    if (response.status === 429) return fail(429, 'flaremo_busy', 'FlareMo 那边在排队，过十秒再试');
    return fail(502, 'flaremo_error', `FlareMo 返回 ${response.status}${detail ? '：' + detail : ''}`);
  }

  // DTO 的 name 形如 memos/1289，同步事件只要最后那截 id
  const name = String(payload.name || (payload.memo && payload.memo.name) || '');
  const id = name.indexOf('/') > -1 ? name.split('/').pop() : name;
  if (id && rid) seenRid.set(rid, { id, at: Date.now() });

  const sync = id ? await triggerSync(env, id) : 'no_id';
  console.log('[memo] created', id || '(no id)', 'len', content.length, 'images', images.length, 'sync', sync);

  return json({ ok: true, id, sync, chars: content.length, images: images.length });
}
