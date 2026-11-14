/**
 * 博主会话（HttpOnly Cookie）回归测试。
 *
 * 覆盖需求里点名的几条：
 *   自动登录（新标签页 / 重开浏览器）、过期、主动退出与撤销、
 *   身份冒充、跨站请求（CSRF + Origin）。
 *
 * 库用 node:sqlite 顶一份 D1，跑的是真实的 SQL 和真实的 SQL 语义，
 * 不是「看起来对」的假对象。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/src/index.js';
import { createD1 } from './helpers/d1.mjs';

const ADMIN_TOKEN = 'unit-test-admin-token-9f2a';
const ADMIN_EMAIL = 'owner@example.com';
const ORIGIN = 'https://hux.ink';
const API = 'https://comments.hux.ink';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const env = {
  DB: createD1(),
  COMMENTS_ADMIN_TOKEN: ADMIN_TOKEN,
  COMMENTS_ADMIN_EMAIL: ADMIN_EMAIL,
  COMMENTS_ALLOWED_ORIGIN: ORIGIN,
  COMMENTS_SITE_URL: ORIGIN,
  COMMENTS_SALT: 'unit-test-salt',
};

beforeEach(() => {
  // 每个用例从干净的数据开始；settings 留着（ensureSchema 的版本标记在那里）
  for (const table of ['admin_sessions', 'comments', 'threads', 'thread_stats', 'comment_rate_events']) {
    try {
      env.DB.exec(`DELETE FROM ${table}`);
    } catch {
      /* 首次运行时表还没建，忽略 */
    }
  }
});

/* -------------------------------- 工具函数 -------------------------------- */

async function call(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.origin !== null) headers.set('Origin', options.origin || ORIGIN);
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.csrf) headers.set('x-csrf-token', options.csrf);
  headers.set('User-Agent', options.ua || BROWSER_UA);

  const init = { method: options.method || 'GET', headers };
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(options.body);
  }

  const pending = [];
  const response = await worker.fetch(new Request(API + path, init), env, {
    waitUntil: (promise) => pending.push(promise),
    passThroughOnException() {},
  });
  await Promise.all(pending);

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const setCookie = response.headers.get('set-cookie') || '';
  return {
    status: response.status,
    headers: response.headers,
    setCookie,
    cookie: setCookie ? setCookie.split(';')[0] : '',
    payload,
  };
}

async function login(token = ADMIN_TOKEN) {
  return call('/api/comments/session', { method: 'POST', body: { token } });
}

function commentBody(overrides = {}) {
  return {
    threadKey: 'post:/unit-test/',
    threadTitle: '单元测试',
    nick: 'owner',
    email: ADMIN_EMAIL,
    content: '这条是测试留言',
    elapsed: 9000,
    ...overrides,
  };
}

/* ------------------------------- 1. 登录签发 ------------------------------- */

test('口令换回 HttpOnly 会话 Cookie，属性齐全且有效期 30 天', async () => {
  const res = await login();

  assert.equal(res.status, 200);
  assert.equal(res.payload.admin, true);
  assert.equal(typeof res.payload.csrf, 'string');
  assert.ok(res.payload.csrf.length >= 32, 'CSRF 令牌要够长');

  const attrs = res.setCookie;
  assert.match(attrs, /^cm_admin=[a-f0-9]{64};/, '会话 id 是 64 位十六进制随机串');
  assert.match(attrs, /HttpOnly/, '脚本必须读不到');
  assert.match(attrs, /Secure/, '只在 HTTPS 上发');
  assert.match(attrs, /SameSite=Lax/);
  assert.match(attrs, /Path=\//);
  assert.match(attrs, /Max-Age=2592000/, '默认 30 天');

  // 跨源要带 Cookie，CORS 必须显式允许凭据
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  assert.match(res.headers.get('vary') || '', /Cookie/i);
});

test('Cookie 里不含口令原文', async () => {
  const res = await login();
  assert.ok(!res.setCookie.includes(ADMIN_TOKEN), 'Set-Cookie 不能把口令写进去');
  assert.ok(!JSON.stringify(res.payload).includes(ADMIN_TOKEN), '响应体也不能回显口令');
});

/* ------------------------------- 2. 自动登录 ------------------------------- */

test('新标签页只带 Cookie 就自动是博主（不用再输口令）', async () => {
  const first = await login();
  const { cookie, payload } = first;

  const me = await call('/api/comments/session', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.payload.admin, true);
  assert.equal(me.payload.via, 'session');
  assert.equal(me.payload.csrf, payload.csrf, 'CSRF 令牌可从会话稳定重算');
  assert.ok(me.payload.expiresAt > Math.floor(Date.now() / 1000));

  // 不带 Cookie 的陌生人
  const stranger = await call('/api/comments/session');
  assert.equal(stranger.payload.admin, false);
  assert.equal(stranger.payload.csrf, undefined);
});

test('换浏览器（没有 Cookie）等于没登录', async () => {
  await login();
  const other = await call('/api/comments/session', {
    cookie: `cm_admin=${'0'.repeat(64)}`,
  });
  assert.equal(other.payload.admin, false, '伪造/失效的 id 一律不认');
});

/* -------------------------------- 3. 口令错 -------------------------------- */

test('口令不对：401，且不签发任何 Cookie', async () => {
  const res = await login('猜一个');
  assert.equal(res.status, 401);
  assert.equal(res.payload.error.code, 'invalid_token');
  assert.equal(res.setCookie, '');
});

test('后台没配口令时登录被拒，不会出现「空口令即通过」', async () => {
  const saved = env.COMMENTS_ADMIN_TOKEN;
  env.COMMENTS_ADMIN_TOKEN = '';
  try {
    const res = await login('anything');
    assert.equal(res.status, 503);
    assert.equal(res.payload.error.code, 'admin_disabled');
  } finally {
    env.COMMENTS_ADMIN_TOKEN = saved;
  }
});

/* -------------------------------- 4. 过期 --------------------------------- */

test('会话过期后自动失效，并顺手清掉记录', async () => {
  const { cookie } = await login();

  const before = await call('/api/comments/session', { cookie });
  assert.equal(before.payload.admin, true);

  env.DB.exec(`UPDATE admin_sessions SET expires_at = strftime('%s','now') - 10`);

  const after = await call('/api/comments/session', { cookie });
  assert.equal(after.payload.admin, false);

  const rows = env.DB._db.prepare('SELECT count(*) AS n FROM admin_sessions').get();
  assert.equal(rows.n, 0, '过期记录应当被删除');
});

test('过期会话不能再挂博主标', async () => {
  const { cookie, payload } = await login();
  env.DB.exec(`UPDATE admin_sessions SET expires_at = strftime('%s','now') - 10`);

  const res = await call('/api/comments', {
    method: 'POST',
    cookie,
    csrf: payload.csrf,
    body: commentBody(),
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.comment.isAdmin, false);
});

/* ---------------------------- 5. 退出与撤销 ----------------------------- */

test('主动退出：清 Cookie + 删记录，旧 Cookie 立刻作废', async () => {
  const { cookie, payload } = await login();

  const out = await call('/api/comments/session', { method: 'DELETE', cookie, csrf: payload.csrf });
  assert.equal(out.status, 200);
  assert.equal(out.payload.admin, false);
  assert.match(out.setCookie, /Max-Age=0/, '浏览器端要同时把 Cookie 清掉');

  const after = await call('/api/comments/session', { cookie });
  assert.equal(after.payload.admin, false);

  const rows = env.DB._db.prepare('SELECT count(*) AS n FROM admin_sessions').get();
  assert.equal(rows.n, 0);
});

test('退出要验 CSRF：别的站点诱导不了「一键登出」', async () => {
  const { cookie } = await login();
  const out = await call('/api/comments/session', { method: 'DELETE', cookie });
  assert.equal(out.status, 403);
  assert.equal(out.payload.error.code, 'csrf_failed');

  const still = await call('/api/comments/session', { cookie });
  assert.equal(still.payload.admin, true, '没带令牌不该被登出');
});

test('撤销所有设备：另一个浏览器的会话一起失效', async () => {
  const a = await login();
  const b = await login();

  const out = await call('/api/comments/session', {
    method: 'DELETE',
    cookie: a.cookie,
    csrf: a.payload.csrf,
  });
  assert.equal(out.status, 200);

  // 上面是「只退当前设备」，b 仍然有效
  const bStill = await call('/api/comments/session', { cookie: b.cookie });
  assert.equal(bStill.payload.admin, true);

  const all = await call('/api/comments/session?all=1', {
    method: 'DELETE',
    cookie: b.cookie,
    csrf: b.payload.csrf,
  });
  assert.equal(all.status, 200);
  assert.ok(all.payload.revoked >= 1);

  const aAfter = await call('/api/comments/session', { cookie: a.cookie });
  assert.equal(aAfter.payload.admin, false);
  const bAfter = await call('/api/comments/session', { cookie: b.cookie });
  assert.equal(bAfter.payload.admin, false);
});

test('换管理口令等于一键撤销：旧会话签的是旧口令', async () => {
  const { cookie } = await login();

  const saved = env.COMMENTS_ADMIN_TOKEN;
  env.COMMENTS_ADMIN_TOKEN = 'rotated-token';
  try {
    const after = await call('/api/comments/session', { cookie });
    assert.equal(after.payload.admin, false, '口令一换，所有旧会话立即失效');
  } finally {
    env.COMMENTS_ADMIN_TOKEN = saved;
  }
});

/* ------------------------------- 6. CSRF --------------------------------- */

test('会话发起的写操作必须带 CSRF 头', async () => {
  const { cookie, payload } = await login();

  const noToken = await call('/api/comments/admin', {
    method: 'POST',
    cookie,
    body: { action: 'approve', id: 1 },
  });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.payload.error.code, 'csrf_failed');

  const withToken = await call('/api/comments/admin', {
    method: 'POST',
    cookie,
    csrf: payload.csrf,
    body: { action: 'approve', id: 1 },
  });
  assert.equal(withToken.status, 200);

  // 只读接口不要求 CSRF（跨站读不到响应体，没有意义）
  const read = await call('/api/comments/admin?limit=1', { cookie });
  assert.equal(read.status, 200);
});

test('口令请求头这条路不受 CSRF 影响（curl / 迁移脚本）', async () => {
  const res = await call('/api/comments/admin', {
    method: 'POST',
    headers: { 'x-admin-token': ADMIN_TOKEN },
    body: { action: 'approve', id: 1 },
  });
  assert.equal(res.status, 200);
});

/* ---------------------------- 7. 跨站请求 ------------------------------- */

test('不在白名单的 Origin 一律 403（连登录都不给）', async () => {
  const res = await call('/api/comments/session', {
    method: 'POST',
    origin: 'https://evil.example',
    body: { token: ADMIN_TOKEN },
  });
  assert.equal(res.status, 403);
  assert.equal(res.payload.error.code, 'origin_forbidden');
  assert.equal(res.setCookie, '');
});

test('跨站来源不能发评论', async () => {
  const res = await call('/api/comments', {
    method: 'POST',
    origin: 'https://evil.example',
    body: commentBody(),
  });
  assert.equal(res.status, 403);
});

test('带 Cookie 但没 CSRF 的跨站评论：降级成访客，不挂博主标', async () => {
  const { cookie } = await login();
  const res = await call('/api/comments', {
    method: 'POST',
    cookie,
    body: commentBody(),
  });
  assert.equal(res.status, 200, '评论本身照收，丢的只是博主标识');
  assert.equal(res.payload.comment.isAdmin, false);
});

/* ---------------------------- 8. 身份冒充 ------------------------------- */

test('只填博主邮箱、没有会话：不是博主', async () => {
  const res = await call('/api/comments', {
    method: 'POST',
    body: commentBody({ email: ADMIN_EMAIL, nick: '冒充者' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.comment.isAdmin, false);
  assert.equal(res.payload.adminVerified, false);

  const rows = env.DB._db.prepare('SELECT is_admin FROM comments').all();
  assert.deepEqual(rows.map((r) => r.is_admin), [0], '落库必须是 0，不能只在前端藏起来');
});

test('会话 + 博主邮箱：自动挂上博主标', async () => {
  const { cookie, payload } = await login();
  const res = await call('/api/comments', {
    method: 'POST',
    cookie,
    csrf: payload.csrf,
    body: commentBody(),
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.comment.isAdmin, true);
  assert.equal(res.payload.adminVerified, true);
});

test('会话在手但邮箱不是博主的：仍按访客存', async () => {
  const { cookie, payload } = await login();
  const res = await call('/api/comments', {
    method: 'POST',
    cookie,
    csrf: payload.csrf,
    body: commentBody({ email: 'someone@else.com' }),
  });
  assert.equal(res.payload.comment.isAdmin, false, '口令/会话不能顶着别人的邮箱挂标');
});

/* --------------------------- 9. 管理员改评论 ---------------------------- */

test('会话能改任意评论，但同样要过 CSRF', async () => {
  // 先用访客身份建一条 1 分钟前的评论
  await call('/api/comments', { method: 'POST', body: commentBody({ email: 'guest@else.com' }) });
  const id = env.DB._db.prepare('SELECT id FROM comments ORDER BY id DESC LIMIT 1').get().id;
  env.DB.exec(`UPDATE comments SET created_at = strftime('%s','now') - 600 WHERE id = ${id}`);

  const { cookie, payload } = await login();

  const blocked = await call('/api/comments/edit', {
    method: 'POST',
    cookie,
    body: { id, content: '偷偷改一下' },
  });
  assert.ok(!blocked.payload || blocked.payload.ok !== true, '没有 CSRF 头不能改别人的评论');

  const ok = await call('/api/comments/edit', {
    method: 'POST',
    cookie,
    csrf: payload.csrf,
    body: { id, content: '博主改的' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.ok, true);
});
