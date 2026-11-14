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
 *   GET  /api/comments/session           当前浏览器是不是博主（读 HttpOnly Cookie）
 *   POST /api/comments/session           { token } 口令换会话 Cookie；{ action:'logout' } 退出
 *   DELETE /api/comments/session[?all=1] 退出当前设备 / 所有设备
 *   GET  /api/comments/admin?status=all|approved|spam|deleted
 *   POST /api/comments/admin            { action, id, threadKey }
 *   POST /api/comments/admin/import     { items: [...] }
 *   GET  /api/comments/admin/export
 *   GET  /api/bili?bvid=&cid=             影彩页取 B 站 720P 直链（代取，绕 CORS）
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
  buildSessionCookie,
  createSession,
  csrfOk,
  csrfTokenFor,
  isSecureRequest,
  readSession,
  revokeAllSessions,
  revokeSession,
} from './session.js';
import {
  clientIp,
  fail,
  formatRegion,
  json,
  readJson,
  sha256,
  timingSafeEqual,
  validateCommentInput,
} from './util.js';

const CORS_METHODS = 'GET,POST,DELETE,OPTIONS';
// x-csrf-token 必须在白名单里，否则浏览器预检不会放行带它的写请求
const CORS_HEADERS = 'Content-Type,x-admin-token,x-csrf-token,Authorization';

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
    // 同一个 API 对不同 Origin、以及对带不带 Cookie 的请求响应不同，缓存键要都覆盖
    Vary: 'Origin, Cookie',
  };

  if (allowAll) {
    // `*` 与 credentials 不能共存：有来源就回显来源，没有来源（curl、迁移脚本）才是 `*`
    headers['Access-Control-Allow-Origin'] = origin || '*';
    if (origin) headers['Access-Control-Allow-Credentials'] = 'true';
  } else if (origin && configured.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    // 会话 Cookie 是 HttpOnly 的，浏览器只在这个头存在时才肯跨源收发
    headers['Access-Control-Allow-Credentials'] = 'true';
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

/**
 * 两种凭据，任一即可通过：
 *   1) x-admin-token / Authorization: Bearer —— curl、迁移脚本、老前端；
 *   2) 浏览器里的 HttpOnly 会话 Cookie —— 正常访客不需要它。
 * 返回 { ok, via, session }，via 决定要不要再查 CSRF：
 * 请求头里的口令是调用方自己攥着的，天然没有跨站冒用的问题；Cookie 会被浏览器
 * 自动带上，所以只有 via === 'session' 的写操作才需要 CSRF 令牌。
 */
async function authorize(request, env) {
  const expected = String(env.COMMENTS_ADMIN_TOKEN || '');
  if (!expected) return { ok: false, via: 'none' };

  const provided =
    request.headers.get('x-admin-token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    '';
  if (provided && timingSafeEqual(provided, expected)) return { ok: true, via: 'token' };

  const session = await readSession(env, request);
  if (!session.ok) return { ok: false, via: 'none', reason: session.reason };
  return { ok: true, via: 'session', session: session.session };
}

const isMutation = (request) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method);

/**
 * 后台写操作闸门：先认证，再对 Cookie 会话验 CSRF。
 * 口令头那条路不查 CSRF —— 跨站请求没法自己加这个头，也就带不了口令。
 */
async function adminGate(request, env) {
  const auth = await authorize(request, env);
  if (!auth.ok) return { ok: false, response: await rejectUnauthorized(request, env) };
  if (auth.via === 'session' && isMutation(request) && !(await csrfOk(request, env, auth.session))) {
    return { ok: false, response: fail(403, 'csrf_failed', '会话校验没通过，刷新页面再试一次') };
  }
  return { ok: true, auth };
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

  // 后台会话：口令换 Cookie、问当前身份、退出
  if (path === '/api/comments/session' || path === '/comments/session') {
    return handleSession(request, env, url);
  }

  // 影彩页：代理取 B 站 720P 直链（站外 iframe 播放器只给 360P）
  if (path === '/api/bili' || path === '/bili') {
    return handleBiliPlay(url, ctx);
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

/* ------------------------------ B 站播放直链 ------------------------------ */

const BILI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BILI_MUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
// 直链有效期约 2 小时，缓存 45 分钟留足余量。
const BILI_CACHE_SECONDS = 2700;

/**
 * B 站对机房 IP 的风控比家用 IP 严，裸请求经常直接 412。
 * 随手带一个随机 buvid3（格式 UUID + infoc），命中率会高不少。
 */
function biliCookie() {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte, i) => {
    const v = i === 6 ? (byte & 0x0f) | 0x40 : i === 8 ? (byte & 0x3f) | 0x80 : byte;
    return v.toString(16).padStart(2, '0');
  }).join('');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return `buvid3=${uuid.toUpperCase()}infoc; b_nut=${Math.floor(Date.now() / 1000)}`;
}

function biliHeaders(bvid, mobile = false) {
  return {
    'User-Agent': mobile ? BILI_MUA : BILI_UA,
    Referer: `https://www.bilibili.com/video/${bvid}/`,
    Origin: 'https://www.bilibili.com',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Cookie: biliCookie(),
  };
}

/** 路线一：playurl 接口 + platform=html5，直接给 mp4（首选，最省事）。 */
async function biliPlayurl(bvid, cid) {
  const api =
    'https://api.bilibili.com/x/player/playurl' +
    `?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}` +
    '&qn=80&fnval=1&fourk=1&platform=html5&high_quality=1&try_look=1';

  const res = await fetch(api, { headers: biliHeaders(bvid) });
  if (!res.ok) throw new Error(`playurl HTTP ${res.status}`);

  const payload = await res.json().catch(() => null);
  if (!payload || payload.code !== 0) throw new Error(`playurl code ${payload && payload.code}`);

  return pickDurl(payload.data, 'playurl');
}

/**
 * 路线二：抓移动端播放页 HTML 里的 window.__playinfo__。
 * Workers 的出口 IP 被 api 子域风控时，普通网页往往还放行。
 */
async function biliPlayinfoPage(bvid) {
  const res = await fetch(`https://m.bilibili.com/video/${bvid}/`, { headers: biliHeaders(bvid, true) });
  if (!res.ok) throw new Error(`page HTTP ${res.status}`);

  const html = await res.text();
  const matched = html.match(/window\.__playinfo__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!matched) throw new Error('page 里没有 __playinfo__');

  let payload;
  try {
    payload = JSON.parse(matched[1]);
  } catch (err) {
    throw new Error('__playinfo__ 解析失败');
  }
  return pickDurl(payload.data, 'page');
}

/** 从 playurl / __playinfo__ 的 data 里挑一条 durl（音视频合一的 mp4）。 */
function pickDurl(data, via) {
  const stream = ((data && data.durl) || [])[0] || {};
  if (!stream.url) throw new Error(`${via} 没有 durl`);
  return {
    url: stream.url,
    backup: Array.isArray(stream.backup_url) ? stream.backup_url.slice(0, 2) : [],
    // quality：64=720P，80=1080P，16=360P
    quality: (data && data.quality) || 0,
    duration: Math.round(((data && data.timelength) || 0) / 1000) || 0,
    bytes: stream.size || 0,
    via,
  };
}

/**
 * 取 B 站视频流直链。
 *
 * 为什么要有这个接口：站外 iframe 播放器（player.bilibili.com）对未登录访客
 * 只给 640×360，改任何参数都无效（实测 videoWidth 恒为 640）。而 playurl 接口
 * 在 platform=html5 下能给到 720P 的 mp4，且不校验 Referer，可以直接喂给 <video>。
 * 浏览器直连 api.bilibili.com 会被 CORS 挡住，所以由 Worker 代取。
 */
async function handleBiliPlay(url, ctx) {
  const bvid = String(url.searchParams.get('bvid') || '').trim();
  const cid = String(url.searchParams.get('cid') || '').trim();
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !/^\d{1,20}$/.test(cid)) {
    return fail(400, 'bad_request', 'bvid / cid 不合法');
  }

  const cache = globalThis.caches && globalThis.caches.default;
  const cacheKey = new Request(`https://bili-cache.hux.ink/${bvid}/${cid}`, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  // 两条路线依次试，都失败就把原因拼起来，方便一眼看出卡在哪。
  const reasons = [];
  let stream = null;
  for (const attempt of [
    () => biliPlayurl(bvid, cid),
    () => biliPlayinfoPage(bvid),
  ]) {
    try {
      stream = await attempt();
      break;
    } catch (err) {
      reasons.push(err.message);
    }
  }

  if (!stream) return fail(502, 'bili_upstream', reasons.join(' | '));

  const response = json(
    {
      ok: true,
      url: stream.url,
      backup: stream.backup,
      quality: stream.quality,
      duration: stream.duration,
      bytes: stream.bytes,
      via: stream.via,
    },
    200,
    { 'Cache-Control': `public, max-age=${BILI_CACHE_SECONDS}` }
  );

  if (cache && ctx && ctx.waitUntil) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
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

    // 博主身份由 service 层统一判定：凭据在服务端校验通过 + 邮箱等于博主邮箱，
    // 缺一不可。邮箱本身不构成任何凭据（它是公开的）。
    //
    // 跨站请求降级：带 Cookie 却没有 CSRF 头，说明这条请求不是我们的页面发的
    //（别的站点诱导浏览器自动带上 Cookie 也凑不出这个头），于是只按访客身份落库。
    // 不直接报错是因为评论区首要是「能留言」，丢一个博主标远好过丢掉一条评论。
    const auth = await authorize(request, env);
    const adminTrusted = auth.ok && (auth.via === 'token' || (await csrfOk(request, env, auth.session)));
    const result = await createComment(env, value, {
      ip: clientIp(request),
      ua: String(request.headers.get('user-agent') || ''),
      region,
      admin: adminTrusted,
    });

    if (!result.ok) return fail(result.status || 400, result.code, result.message);

    // 通知是副作用：await 后落定，失败不影响提交结果（Worker 里不能用浮动 Promise）
    if (result.comment && !result.spam) {
      // 哔哔的邮件标题统一成「哔哔 · ID」：前端不同版本分别传过日期、正文摘要、纯 id，
      // 这里按 thread_key 重算一遍，邮件不再跟前端走
      const memoKeyMatch = /^memo:(.+)$/.exec(String((result.thread && result.thread.key) || ''));
      const mailThreadTitle = memoKeyMatch ? `哔哔 · ${memoKeyMatch[1]}` : (value.threadTitle || '');

      // 博主自己发的评论不给自己发通知。判定只认服务端落库的 is_admin，
      // 不再拿提交上来的邮箱去比：否则随便填个博主邮箱，就能让自己的评论
      // 不进通知栏 —— 冒充着博主说话，博主还收不到信。
      const adminEmail = String(env.COMMENTS_ADMIN_EMAIL || '').trim().toLowerCase();
      const isSelf = Boolean(result.comment && result.comment.isAdmin);

      // 被回复的人如果就是博主本人，只发「有人回复了你」那一封（带原评论上下文），
      // 不再重复发全站新评论通知——同一个事件别寄两封信
      const parentEmail = (result.notify && result.notify.parentEmail) || '';
      const parentWantsNotify = Boolean(result.notify && result.notify.parentWantsNotify);
      const replyToAdmin = Boolean(
        parentEmail &&
          parentWantsNotify &&
          parentEmail.toLowerCase() === adminEmail &&
          parentEmail !== value.email
      );

      const tasks = [];
      const createdAt = (result.comment && result.comment.createdAt) || 0;
      // 页面提交必然带线程标题，标题为空说明是绕过前端直接打接口（扫描器就爱这么干），
      // 这种不往博主邮箱里塞通知，免得被人拿来刷信箱
      if (!isSelf && !replyToAdmin && mailThreadTitle) {
        tasks.push(
          notifyNewComment(env, {
            threadTitle: mailThreadTitle,
            threadUrl: result.thread && result.thread.url,
            nick: value.nick,
            content: value.content,
            website: value.website,
            region,
            createdAt,
          })
        );
      }

      if (parentEmail && parentWantsNotify && parentEmail !== value.email) {
        tasks.push(
          notifyReply(env, {
            toEmail: parentEmail,
            threadTitle: mailThreadTitle,
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
      // 口令是否校验通过：前端据此区分「邮箱填错」和「口令过期」
      adminVerified: Boolean(result.adminVerified),
      comment: result.comment,
      message: result.comment ? '评论成功' : '已提交',
    });
  }

  return new Response(null, { status: 405, headers: { Allow: 'GET,POST,OPTIONS' } });
}

/* --------------------------- /comments/session ---------------------------- */

/**
 * 博主会话。
 *   GET    → { admin, csrf, expiresAt }：Cookie 是 HttpOnly 的，脚本读不到，
 *            只能由服务端回答「我们现在算不算登录」。新标签页、重开浏览器都走这一条。
 *   POST   → { token } 登录；{ action: 'logout' | 'revoke-all' } 退出
 *   DELETE → 退出当前设备；?all=1 退出所有设备
 *
 * 退出必须落到库里删行，而不是只清 Cookie：别处留着的同一份 Cookie 也就一起废了。
 */
async function handleSession(request, env, url) {
  const secure = isSecureRequest(request);

  if (request.method === 'GET') {
    const auth = await authorize(request, env);
    if (!auth.ok) return json({ ok: true, admin: false });
    // 用请求头口令调进来的（脚本），CSRF 无从谈起，也不给它发
    if (auth.via === 'token') return json({ ok: true, admin: true, via: 'token', csrf: '' });
    return json({
      ok: true,
      admin: true,
      via: 'session',
      csrf: await csrfTokenFor(env, auth.session.sid),
      expiresAt: auth.session.expiresAt,
    });
  }

  const cleared = { 'Set-Cookie': buildSessionCookie('', 0, secure) };

  async function logout(all) {
    const auth = await authorize(request, env);
    if (!auth.ok) return json({ ok: true, admin: false }, 200, cleared);
    if (auth.via === 'session' && !(await csrfOk(request, env, auth.session))) {
      return fail(403, 'csrf_failed', '会话校验没通过，刷新页面再试一次');
    }
    const removed = all ? await revokeAllSessions(env) : await revokeSession(env, auth.session || {});
    return json({ ok: true, admin: false, revoked: removed }, 200, cleared);
  }

  if (request.method === 'DELETE') {
    return logout(url.searchParams.get('all') === '1');
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    const action = String((body && body.action) || 'login');
    if (action === 'logout') return logout(false);
    if (action === 'revoke-all') return logout(true);

    const expected = String(env.COMMENTS_ADMIN_TOKEN || '');
    if (!expected) return fail(503, 'admin_disabled', '后台还没配置管理口令');
    const token = typeof (body && body.token) === 'string' ? body.token.trim() : '';
    if (!token) return fail(400, 'token_required', '请填写管理口令');

    // 口令是唯一还能被暴力猜的东西，按 IP 限速（和后台接口共用一套计数表）
    const ipHash = await sha256(`login|${clientIp(request)}|${env.COMMENTS_SALT || 'comments-salt'}`);
    const limited = await consumeRateLimit(env, {
      actorHash: ipHash,
      shortSeconds: 600,
      shortMax: 10,
      longSeconds: 3600,
      longMax: 30,
    });
    if (!limited.ok) return fail(429, 'rate_limited', '口令尝试次数过多，请稍后再试');
    if (!timingSafeEqual(token, expected)) return fail(401, 'invalid_token', '口令不对');

    const created = await createSession(env, request);
    if (!created) return fail(500, 'session_failed', '登录失败，请稍后再试');
    return json(
      {
        ok: true,
        admin: true,
        via: 'session',
        csrf: await csrfTokenFor(env, created.sid),
        expiresAt: created.expiresAt,
      },
      200,
      { 'Set-Cookie': buildSessionCookie(created.sid, created.maxAge, secure) }
    );
  }

  return new Response(null, { status: 405, headers: { Allow: 'GET,POST,DELETE,OPTIONS' } });
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
  // 这里不给 403：访客拿 edit_token 改自己的错别字跟博主身份无关，
  // 会话没有 CSRF 头时只是「不算博主」，而不是整条请求作废。
  const auth = await authorize(request, env);
  const admin = auth.ok && (auth.via === 'token' || (await csrfOk(request, env, auth.session)));
  const result = await editComment(env, {
    id: body.id,
    content: body.content,
    token: typeof body.token === 'string' ? body.token.slice(0, 120) : '',
    admin,
  });
  if (!result.ok) return fail(result.status || 400, result.code, result.message);
  return json(result);
}

/* ------------------------------ /comments/admin --------------------------- */

async function handleAdmin(request, env, url) {
  const gate = await adminGate(request, env);
  if (!gate.ok) return gate.response;
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
  const gate = await adminGate(request, env);
  if (!gate.ok) return gate.response;
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
  const gate = await adminGate(request, env);
  if (!gate.ok) return gate.response;
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
