/**
 * 博主会话：管理口令换 HttpOnly Cookie。
 *
 * 为什么要有这一层
 * ────────────────
 * 以前「是不是博主」全靠前端把口令逐个请求头带上去，口令存在 sessionStorage 里：
 *   1) 每个标签页各存一份，新开一页就得重新登录一次；
 *   2) sessionStorage / localStorage 能被同源脚本读到，一次 XSS 就把长期口令送人。
 * 现在口令只在登录那一刻 POST 一次，换回一个 Cookie：
 *   cm_admin = <64 位十六进制随机 id>
 *   HttpOnly  脚本读不到（XSS 偷不走）
 *   Secure    只在 HTTPS 上发
 *   SameSite=Lax  跨站发起的表单/子资源请求不带它
 *   Path=/    只作用于 comments.hux.ink（不设 Domain，别把作用域扩到整个 hux.ink）
 *
 * 会话本身落在 D1（admin_sessions），所以能过期、能主动退出、能一键撤销所有设备；
 * 库里只存 sha256(id)，即使库被拖走也换不回能用的 Cookie。
 * token_fp 记录签发时的 COMMENTS_ADMIN_TOKEN 指纹 —— 换口令等于所有会话立刻失效。
 *
 * 作用域与跨源
 * ────────────
 * 博客在 hux.ink，API 在 comments.hux.ink：同一站点（same-site）、不同源（cross-origin），
 * 所以 SameSite=Lax 的 Cookie 会随前端 `credentials: 'include'` 的 fetch 正常发送；
 * 但正因为跨源，Worker 必须显式回 Access-Control-Allow-Credentials（见 index.js 的 CORS）。
 */

import { ensureSchema, first, run } from './db.js';
import { clientIp, hmacHex, randomHex, sha256, timingSafeEqual } from './util.js';

export const SESSION_COOKIE = 'cm_admin';
export const CSRF_HEADER = 'x-csrf-token';

/** 默认 30 天。COMMENTS_SESSION_DAYS 可以覆盖（上限一年，下限一天）。 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const DAY = 24 * 60 * 60;
const SID_RE = /^[a-f0-9]{64}$/;

export function sessionTtlSeconds(env) {
  const days = Number(env && env.COMMENTS_SESSION_DAYS);
  if (!Number.isFinite(days) || days <= 0) return SESSION_TTL_SECONDS;
  return Math.min(Math.max(Math.floor(days * DAY), DAY), 365 * DAY);
}

export function isSecureRequest(request) {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true; // 解析不出来就按生产处理，宁可多一个 Secure
  }
}

/** 从 Cookie 头里取单个值。值只可能是十六进制，不做 decode 也不会出错。 */
export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/**
 * 组 Set-Cookie。
 * 本地 wrangler dev 是 http://localhost:8787，带上 Secure 浏览器会直接丢掉，
 * 所以 Secure 按实际协议给：线上恒为 https，本地联调才降级。
 */
export function buildSessionCookie(value, maxAge, secure) {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return parts.join('; ');
}

/* ------------------------------ 口令指纹 ------------------------------- */

// 每个 isolate 只算一次：鉴权链路上每条评论都要用，重复算没意义。
let fingerprintCache = { token: null, fp: '' };

export async function adminTokenFingerprint(env) {
  const token = String((env && env.COMMENTS_ADMIN_TOKEN) || '');
  if (!token) return '';
  if (fingerprintCache.token === token && fingerprintCache.fp) return fingerprintCache.fp;
  const fp = await sha256(`admin-token|${token}`);
  fingerprintCache = { token, fp };
  return fp;
}

/* ------------------------------- 会话读写 ------------------------------- */

/**
 * 新建会话，返回 { sid, maxAge, expiresAt }。
 * sid 只在这一次响应里出现（写进 Cookie），之后服务端只认它的哈希。
 */
export async function createSession(env, request) {
  const token = String((env && env.COMMENTS_ADMIN_TOKEN) || '');
  if (!token) return null;

  await ensureSchema(env);

  const now = Math.floor(Date.now() / 1000);
  const ttl = sessionTtlSeconds(env);
  const sid = randomHex(32);
  const idHash = await sha256(`session|${sid}`);
  const fp = await adminTokenFingerprint(env);
  const ip = clientIp(request);
  const ipHash = ip ? await sha256(`${ip}|${env.COMMENTS_SALT || 'comments-salt'}`) : '';

  await run(
    env,
    `INSERT INTO admin_sessions
       (id_hash, token_fp, ip_hash, ua, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [idHash, fp, ipHash || null, String(request.headers.get('user-agent') || '').slice(0, 200), now, now, now + ttl]
  );

  // 顺手清掉过期一周以上的旧记录，别让表无限长。失败不影响登录。
  try {
    await run(env, `DELETE FROM admin_sessions WHERE expires_at < ?`, [now - 7 * DAY]);
  } catch {
    /* 清理是顺手的事 */
  }

  return { sid, maxAge: ttl, expiresAt: now + ttl };
}

/**
 * 校验请求带来的会话。
 * 返回 { ok, session:{ sid, idHash, expiresAt }, reason }
 * reason 只用于日志/测试，不回给客户端（别让人拿它探口令状态）。
 */
export async function readSession(env, request) {
  const token = String((env && env.COMMENTS_ADMIN_TOKEN) || '');
  if (!token) return { ok: false, reason: 'disabled' };

  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid || !SID_RE.test(sid)) return { ok: false, reason: 'none' };

  try {
    await ensureSchema(env);
    const idHash = await sha256(`session|${sid}`);
    const row = await first(
      env,
      `SELECT id_hash, token_fp, expires_at, revoked_at, last_seen_at
         FROM admin_sessions WHERE id_hash = ?`,
      [idHash]
    );
    if (!row) return { ok: false, reason: 'unknown' };

    const now = Math.floor(Date.now() / 1000);
    if (Number(row.revoked_at)) return { ok: false, reason: 'revoked' };
    if (Number(row.expires_at) <= now) {
      try {
        await run(env, `DELETE FROM admin_sessions WHERE id_hash = ?`, [idHash]);
      } catch {
        /* 删不掉也不放行 */
      }
      return { ok: false, reason: 'expired' };
    }

    // 口令换过了：这个会话是拿旧口令签的，直接作废
    if (row.token_fp !== (await adminTokenFingerprint(env))) {
      return { ok: false, reason: 'stale_token' };
    }

    // 一小时以上没动过才写一次，别每条评论都 UPDATE
    if (!row.last_seen_at || now - Number(row.last_seen_at) > 3600) {
      try {
        await run(env, `UPDATE admin_sessions SET last_seen_at = ? WHERE id_hash = ?`, [now, idHash]);
      } catch {
        /* 记不住活跃时间不影响鉴权 */
      }
    }

    return {
      ok: true,
      session: { sid, idHash, expiresAt: Number(row.expires_at) },
    };
  } catch (error) {
    // 表还没建好（或 D1 抽风）时不能让整条评论链路崩掉：按未登录处理
    console.error('[session] read failed:', error && error.message);
    return { ok: false, reason: 'db_error' };
  }
}

/* -------------------------------- CSRF --------------------------------- */

/**
 * CSRF 令牌 = HMAC(口令, "csrf|" + sid)。
 *
 * 不落库、不额外发 Cookie：只要服务端能从 Cookie 里拿到 sid，就能重算出同一串；
 * 而攻击者的页面读不到 sid（HttpOnly），也读不到这个令牌（跨源响应体被 CORS 挡住），
 * 更没法在表单提交里塞自定义头。
 */
export async function csrfTokenFor(env, sid) {
  const token = String((env && env.COMMENTS_ADMIN_TOKEN) || '');
  if (!token || !sid) return '';
  return (await hmacHex(token, `csrf|${sid}`)).slice(0, 40);
}

export async function csrfOk(request, env, session) {
  const provided = String(request.headers.get(CSRF_HEADER) || '');
  if (!provided || !session || !session.sid) return false;
  const expected = await csrfTokenFor(env, session.sid);
  return Boolean(expected) && timingSafeEqual(provided, expected);
}

/* -------------------------------- 撤销 --------------------------------- */

/** 退出当前设备：删行（不是只清 Cookie —— Cookie 可能还留在别处）。 */
export async function revokeSession(env, session) {
  if (!session || !session.idHash) return 0;
  const result = await run(env, `DELETE FROM admin_sessions WHERE id_hash = ?`, [session.idHash]);
  return result.changes;
}

/** 所有设备一起退出。口令泄露时的一键止损。 */
export async function revokeAllSessions(env) {
  const result = await run(env, `DELETE FROM admin_sessions`);
  return result.changes;
}
