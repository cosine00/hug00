/**
 * Cloudflare Worker 入口。
 *
 *   GET  /api/health
 *   GET  /api/comments?thread=<key>
 *   POST /api/comments
 *   POST /api/comments/edit              { id, content, token }     改自己的（博主可改任意条）
 *   GET  /api/comments/count?threads=<key,key>
 *   POST /api/comments/view              { threadKey, session, visitor }  阅读量（按会话去重）
 *   POST /api/comments/like              { threadKey, visitor, action }   点赞 / 取消
 *   GET  /api/comments/stats?threads=<key,key>&v=<visitor>
 *   GET  /api/comments/admin?status=all|approved|spam|deleted
 *   POST /api/comments/admin            { action, id, threadKey }
 *   POST /api/comments/admin/import     { items: [...] }
 *   GET  /api/comments/admin/export
 */

import {
  adminList,
  adminUpdate,
  editComment,
  exportTwikoo,
  importTwikoo,
  importNativeBackup,
  countComments,
  consumeRateLimit,
  createComment,
  exportAll,
  importComments,
  listComments,
  recordView,
  statsFor,
  toggleLike,
  unsubscribeComment,
} from './service.js';
import { notifyNewComment, notifyReply } from './mail.js';
import {
  clientIp,
  fail,
  formatRegion,
  json,
  readJson,
  sha256,
  validateCommentInput,
} from './util.js';

const CORS_METHODS = 'GET,POST,OPTIONS';
const CORS_HEADERS = 'Content-Type,x-admin-token,Authorization';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.COMMENTS_ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAll = !configured.length || configured.includes('*');

  const headers = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (allowAll) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  } else if (origin && configured.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function originAllowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return true; // CLI、服务端迁移脚本没有 Origin
  const configured = String(env.COMMENTS_ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return !configured.length || configured.includes('*') || configured.includes(origin);
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request, env))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

/* --------------------------------- 鉴权 ---------------------------------- */

function timingSafeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i += 1) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env, url) {
  const expected = env.COMMENTS_ADMIN_TOKEN;
  if (!expected) return false;
  const provided =
    request.headers.get('x-admin-token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    '';
  return timingSafeEqual(provided, expected);
}

/* --------------------------------- 路由 ---------------------------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (!originAllowed(request, env)) return fail(403, 'origin_forbidden', '来源不在允许列表');
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    if (!originAllowed(request, env)) {
      return withCors(fail(403, 'origin_forbidden', '来源不在允许列表'), request, env);
    }

    try {
      const response = await route(request, env, url, ctx);
      return withCors(response, request, env);
    } catch (error) {
      console.error('[comments] unhandled:', error && error.stack ? error.stack : error);
      const message = String((error && error.message) || '');
      if (/no such table/i.test(message)) {
        return withCors(
          fail(500, 'db_not_initialized', '数据库还没建表，先执行 wrangler d1 execute 初始化'),
          request,
          env
        );
      }
      return withCors(fail(500, 'internal_error', '服务暂时不可用，请稍后再试'), request, env);
    }
  },
};

async function route(request, env, url, ctx) {
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health' || path === '/health') {
    return json({
      ok: true,
      service: 'comments',
      runtime: 'cloudflare-worker',
      hasDb: Boolean(env.DB),
      time: new Date().toISOString(),
    });
  }

  if (path === '/api/comments' || path === '/comments') {
    return handleComments(request, env, url, ctx);
  }

  if (path === '/api/comments/count' || path === '/comments/count') {
    return handleCount(request, env, url);
  }

  if (path === '/api/comments/view' || path === '/comments/view') {
    return handleView(request, env);
  }

  if (path === '/api/comments/like' || path === '/comments/like') {
    return handleLike(request, env);
  }

  if (path === '/api/comments/stats' || path === '/comments/stats') {
    return handleStats(request, env, url);
  }

  if (path === '/api/comments/edit' || path === '/comments/edit') {
    return handleEdit(request, env, url);
  }

  if (path === '/api/comments/admin' || path === '/comments/admin') {
    return handleAdmin(request, env, url);
  }

  if (path === '/api/comments/admin/import') {
    return handleImport(request, env, url);
  }

  if (path === '/api/comments/admin/export') {
    return handleExport(request, env, url);
  }

  if (path === '/api/comments/unsubscribe' || path === '/comments/unsubscribe') {
    return handleUnsubscribe(request, env, url);
  }

  return fail(404, 'not_found', '接口不存在');
}

/* ------------------------------ /comments -------------------------------- */

async function handleComments(request, env, url, ctx) {
  if (request.method === 'GET') {
    const thread = url.searchParams.get('thread') || '';
    if (!thread) return fail(400, 'thread_required', '缺少 thread 参数');

    // 没有审核队列：pending 参数已废弃，老前端带过来也无所谓，直接忽略
    const data = await listComments(env, {
      threadKey: thread,
      limit: url.searchParams.get('limit') || undefined,
      offset: url.searchParams.get('offset') || 0,
    });
    return json({ ok: true, ...data });
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    const checked = validateCommentInput(body);
    if (!checked.ok) {
      const [code, message] = checked.errors[0];
      return fail(400, code, message);
    }

    const value = checked.value;
    const region = formatRegion(request);
    const turnstile = await verifyTurnstile(env, value.turnstileToken, clientIp(request));
    if (!turnstile.ok) return fail(403, 'captcha_failed', '人机验证没有通过，请重试');
    // 博主身份只认口令：前端带着缓存的 x-admin-token 提交才算，填对邮箱没用
    const result = await createComment(env, value, {
      ip: clientIp(request),
      ua: String(request.headers.get('user-agent') || ''),
      region,
      admin: authorized(request, env, url),
    });

    if (!result.ok) return fail(result.status || 400, result.code, result.message);

    // 通知是副作用：await 后落定，失败不影响提交结果（Worker 里不能用浮动 Promise）
    if (result.comment && !result.spam) {
      // 博主自己发的评论不给自己发通知（用博主邮箱提交即视为本人，不管有没有带口令）
      const adminEmail = String(env.COMMENTS_ADMIN_EMAIL || '').trim().toLowerCase();
      const authorEmail = String(value.email || '').trim().toLowerCase();
      const isSelf = Boolean(authorEmail) && authorEmail === adminEmail;

      const tasks = [];
      const createdAt = (result.comment && result.comment.createdAt) || 0;
      if (!isSelf) {
        tasks.push(
          notifyNewComment(env, {
            threadTitle: value.threadTitle,
            threadUrl: result.thread && result.thread.url,
            nick: value.nick,
            content: value.content,
            website: value.website,
            region,
            createdAt,
          })
        );
      }

      const parentEmail = result.notify && result.notify.parentEmail;
      const parentWantsNotify = result.notify && result.notify.parentWantsNotify;
      if (parentEmail && parentWantsNotify && parentEmail !== value.email) {
        tasks.push(
          notifyReply(env, {
            toEmail: parentEmail,
            threadTitle: value.threadTitle,
            threadUrl: result.thread && result.thread.url,
            nick: value.nick,
            content: value.content,
            createdAt,
            parentNick: result.notify.parentNick,
            parentContent: result.notify.parentContent,
            parentCreatedAt: result.notify.parentCreatedAt,
            unsubscribeUrl: result.notify.parentNotifyToken
              ? new URL(`/api/comments/unsubscribe?token=${encodeURIComponent(result.notify.parentNotifyToken)}`, request.url).href
              : '',
          })
        );
      }

      const notifications = Promise.all(tasks);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notifications);
      else await notifications;
    }

    return json({
      ok: true,
      // pending / firstTime 不再产生，留着字段只为不破坏老前端
      pending: false,
      firstTime: false,
      // 只回给提交人：1 分钟内可以自己改错别字
      editToken: result.editToken || null,
      comment: result.comment,
      message: result.comment ? '评论成功' : '已提交',
    });
  }

  return new Response(null, { status: 405, headers: { Allow: 'GET,POST,OPTIONS' } });
}

/* --------------------------- /comments/count ------------------------------ */

async function handleCount(request, env, url) {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET,OPTIONS' } });
  }

  const raw = url.searchParams.get('threads') || '';
  const threads = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!threads.length) return json({ ok: true, counts: {} });

  const normalized = await countComments(env, threads);
  // 同时兼容 "memo:1233" 与原始传入 key 两种访问方式
  const alias = {};
  threads.forEach((key) => {
    const hit = Object.keys(normalized).find(
      (k) => k === key || k.endsWith(`:${key.replace(/^\//, '')}`) || k.replace(/^[a-z]+:/, '') === key
    );
    alias[key] = hit ? normalized[hit] : 0;
  });

  return json(
    { ok: true, counts: alias, normalized },
    200,
    { 'Cache-Control': 'public, max-age=20, s-maxage=20' }
  );
}

/* ----------------------------- /comments/view ---------------------------- */

// 阅读量：同一 session 只记一次，刷新不虚增
async function handleView(request, env) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST,OPTIONS' } });
  }
  const body = await readJson(request);
  const result = await recordView(env, {
    threadKey: body.threadKey || '',
    session: typeof body.session === 'string' ? body.session.slice(0, 80) : '',
    visitor: typeof body.visitor === 'string' ? body.visitor.slice(0, 80) : '',
  });
  return json(result, result.ok ? 200 : 400);
}

/* ----------------------------- /comments/like ---------------------------- */

async function handleLike(request, env) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST,OPTIONS' } });
  }
  const body = await readJson(request);
  const result = await toggleLike(env, {
    threadKey: body.threadKey || '',
    visitor: typeof body.visitor === 'string' ? body.visitor.slice(0, 80) : '',
    action: body.action === 'unlike' ? 'unlike' : 'like',
  });
  return json(result, result.ok ? 200 : 400);
}

/* ----------------------------- /comments/stats --------------------------- */

async function handleStats(request, env, url) {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET,OPTIONS' } });
  }
  const threads = (url.searchParams.get('threads') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
  const visitor = (url.searchParams.get('v') || '').slice(0, 80);
  const stats = await statsFor(env, { threads, visitor });
  return json({ ok: true, stats }, 200, { 'Cache-Control': 'public, max-age=15, s-maxage=15' });
}

/* ----------------------------- /comments/edit ---------------------------- */

async function handleEdit(request, env) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST,OPTIONS' } });
  }
  const body = await readJson(request);
  const result = await editComment(env, {
    id: body.id,
    content: body.content,
    token: typeof body.token === 'string' ? body.token.slice(0, 120) : '',
    admin: authorized(request, env, new URL(request.url)),
  });
  if (!result.ok) return fail(result.status || 400, result.code, result.message);
  return json(result);
}

/* ------------------------------ /comments/admin --------------------------- */

async function handleAdmin(request, env, url) {
  if (!authorized(request, env, url)) return rejectUnauthorized(request, env);
  if (request.method === 'GET') {
    const data = await adminList(env, {
      status: url.searchParams.get('status') || 'all',
      threadKey: url.searchParams.get('thread') || '',
      limit: url.searchParams.get('limit') || 50,
      offset: url.searchParams.get('offset') || 0,
    });
    return json({ ok: true, ...data });
  }
  if (request.method === 'POST') {
    const body = await readJson(request);
    const result = await adminUpdate(env, {
      action: body.action,
      id: body.id,
      threadKey: body.threadKey,
    });
    return json(result, result.ok ? 200 : 400);
  }
  return new Response(null, { status: 405, headers: { Allow: 'GET,POST,OPTIONS' } });
}

async function handleImport(request, env, url) {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST,OPTIONS' } });
  }
  if (!authorized(request, env, url)) return rejectUnauthorized(request, env);
  const body = await readJson(request);
  if (body && (body.format === 'comments-native-v2' || Array.isArray(body.threads) || Array.isArray(body.threadStats))) {
    const sizes = [body.threads, body.comments, body.threadStats]
      .filter(Array.isArray)
      .map((items) => items.length);
    if (sizes.some((size) => size > 100)) {
      return fail(400, 'import_batch_too_large', '原始备份每批最多 100 条');
    }
    const result = await importNativeBackup(env, body);
    return json({ ok: true, mode: 'native', ...result });
  }
  // 两种载荷都收：{ items: [...] } 是本系统的中间格式，
  // 数组或 { comment, counter } 则直接当作 Twikoo 的导出文件处理
  if (Array.isArray(body) || Array.isArray(body.comment) || Array.isArray(body.counter)) {
    const commentCount = Array.isArray(body) ? body.length : (body.comment || []).length;
    const counterCount = Array.isArray(body.counter) ? body.counter.length : 0;
    if (commentCount > 8 || counterCount > 100) {
      return fail(400, 'import_batch_too_large', 'Twikoo 评论每批最多 8 条，阅读量每批最多 100 条');
    }
    const result = await importTwikoo(env, body);
    return json({ ok: true, mode: 'twikoo', ...result });
  }
  const result = await importComments(env, body.items || []);
  return json({ ok: true, mode: 'native', ...result });
}

async function handleExport(request, env, url) {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET,OPTIONS' } });
  }
  if (!authorized(request, env, url)) return rejectUnauthorized(request, env);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 1000, 5000);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const stamp = new Date().toISOString().slice(0, 10);

  // ?format=twikoo：导成 Twikoo 的 comment.json / counter.json，随时能搬回去
  if (url.searchParams.get('format') === 'twikoo') {
    const data = await exportTwikoo(env, limit, offset);
    return new Response(
      JSON.stringify({ format: 'twikoo', exportedAt: new Date().toISOString(), ...data }, null, 2),
      {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="twikoo-export-${stamp}.json"`,
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const data = await exportAll(env, limit, offset);
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="comments-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function rejectUnauthorized(request, env) {
  const ip = clientIp(request);
  const actorHash = await sha256(`admin|${ip}|${env.COMMENTS_SALT || 'comments-salt'}`);
  const limited = await consumeRateLimit(env, {
    actorHash,
    shortSeconds: 300,
    shortMax: 10,
    longSeconds: 3600,
    longMax: 30,
  });
  if (!limited.ok) return fail(429, 'rate_limited', '管理口令尝试过多，请稍后再试');
  return fail(401, 'unauthorized', '需要管理口令');
}

async function verifyTurnstile(env, token, ip) {
  const secret = String(env.TURNSTILE_SECRET_KEY || '');
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false };
  try {
    const body = new URLSearchParams({ secret, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const result = await response.json();
    return { ok: Boolean(result && result.success) };
  } catch (error) {
    console.error('[comments] turnstile verify failed:', error && error.message);
    return { ok: false };
  }
}

function unsubscribePage(token, done = false) {
  const safe = String(token || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const content = done
    ? '<h1>已关闭回复提醒</h1><p>这条评论以后不会再收到回复邮件。</p>'
    : `<h1>关闭回复提醒</h1><p>确认不再接收这条评论的回复邮件？</p>
       <form method="post"><input type="hidden" name="token" value="${safe}">
       <button type="submit">确认关闭</button></form>`;
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <title>评论邮件设置</title><style>body{font:16px/1.7 system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#3b3d42}button{padding:9px 16px;border:0;border-radius:8px;background:#42b983;color:white;cursor:pointer}</style>${content}`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function handleUnsubscribe(request, env, url) {
  if (request.method === 'GET') return unsubscribePage(url.searchParams.get('token') || '');
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET,POST' } });
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const result = await unsubscribeComment(env, token);
  return result.ok ? unsubscribePage('', true) : fail(400, 'token_invalid', '退订链接无效或已经使用');
}
