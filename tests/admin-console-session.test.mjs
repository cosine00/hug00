/**
 * 后台控制台（static/admin/index.html）的评论管理登录回归。
 *
 * 控制台不是评论前台，但它也会调 /admin 接口。要求同样是：
 * 口令只在「点保存」那一刻用一次，之后靠 HttpOnly 会话 Cookie；
 * 口令不写进 localStorage，写操作带 CSRF 头。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../static/admin/index.html'), 'utf8');

function extract(start, end) {
  const at = html.indexOf(start);
  assert.ok(at >= 0, `找不到代码片段：${start}`);
  const to = html.indexOf(end, at);
  assert.ok(to > at, `找不到片段结尾：${end}`);
  return html.slice(at, to);
}

const settingsCode = extract('function saveCfg(', 'function cleanPath(');
// cmApiBase 之后的一整段（含 CM_SESSION、cmSyncSession、cmLogin、cmFetch）
const cmCode = extract('function cmApiBase(', '/* ------------------------------ 路径与时间');

function makeSandbox({ stored = null, responses = [] } = {}) {
  const calls = [];
  const store = new Map(stored ? Object.entries(stored) : []);
  const queue = responses.slice();

  const sandbox = {
    location: { hostname: 'hux.ink', origin: 'https://hux.ink' },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    CFG: {
      commentsApi: 'https://comments.hux.ink/api/comments',
      commentsToken: '',
      token: 'gh-token',
    },
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      const next = queue.shift() || { ok: true, status: 200, data: { ok: true } };
      return {
        ok: next.ok !== false,
        status: next.status || 200,
        json: async () => next.data,
      };
    },
    JSON,
    Object,
    String,
    Boolean,
    Number,
    Promise,
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(settingsCode + cmCode, sandbox);
  return { sandbox, calls, store };
}

test('保存设置时不会把评论管理口令写进 localStorage', () => {
  const { sandbox, store } = makeSandbox();
  sandbox.CFG.commentsToken = 'super-secret-token';
  vm.runInContext('saveCfg()', sandbox);

  const saved = JSON.parse(store.get('hugo_admin_cfg'));
  assert.equal(saved.commentsToken, undefined, '口令不能进本地存储');
  assert.equal(saved.token, 'gh-token', 'GitHub Token 那套保持原样，别误伤');
});

test('读到历史遗留的口令：就地抹掉，不再继续用', () => {
  const { sandbox, store } = makeSandbox({
    stored: { hugo_admin_cfg: JSON.stringify({ commentsToken: 'old-token', token: 'gh' }) },
  });
  vm.runInContext('loadCfg()', sandbox);

  assert.equal(sandbox.CFG.commentsToken, '', '旧口令不能再被读进来用');
  const saved = JSON.parse(store.get('hugo_admin_cfg'));
  assert.equal(saved.commentsToken, undefined, '存储里也要清干净');
});

test('有会话时只靠 Cookie：不带口令头，写操作带 CSRF', async () => {
  const { sandbox, calls } = makeSandbox({
    responses: [{ ok: true, status: 200, data: { ok: true, admin: true, csrf: 'csrf-abc' } }],
  });
  sandbox.CFG.commentsToken = 'leftover-token';

  const result = await vm.runInContext(
    "cmSyncSession().then(()=>cmFetch('/admin',{method:'POST',body:'{}'}))",
    sandbox
  );
  assert.ok(result !== undefined);

  const me = calls[0];
  assert.match(me.url, /\/session$/);
  assert.equal(me.init.credentials, 'include', '跨源必须显式带 Cookie');

  const admin = calls[1];
  assert.equal(admin.url, 'https://comments.hux.ink/api/comments/admin');
  assert.equal(admin.init.credentials, 'include');
  assert.equal(admin.init.headers['x-admin-token'], undefined, '有会话就不该再出头');
  assert.equal(admin.init.headers['x-csrf-token'], 'csrf-abc');
});

test('没有会话时才退回口令头（兼容老配置）', async () => {
  const { sandbox, calls } = makeSandbox({
    responses: [{ ok: true, status: 200, data: { ok: true, admin: false } }],
  });
  sandbox.CFG.commentsToken = 'manual-token';

  await vm.runInContext("cmSyncSession().then(()=>cmFetch('/admin?limit=1'))", sandbox);

  const admin = calls[1];
  assert.equal(admin.init.headers['x-admin-token'], 'manual-token');
  assert.equal(admin.init.headers['x-csrf-token'], undefined, 'GET 不需要 CSRF');
});

test('口令换会话后会记住 CSRF，并把本地口令清空', async () => {
  const { sandbox, calls, store } = makeSandbox({
    responses: [{ ok: true, status: 200, data: { ok: true, admin: true, csrf: 'csrf-xyz' } }],
  });

  await vm.runInContext("cmLogin('typed-token')", sandbox);
  assert.equal(calls[0].init.body, JSON.stringify({ token: 'typed-token' }));
  assert.equal(calls[0].init.credentials, 'include');

  const session = vm.runInContext('CM_SESSION', sandbox);
  assert.equal(session.admin, true);
  assert.equal(session.csrf, 'csrf-xyz');

  sandbox.CFG.commentsToken = '';
  vm.runInContext('saveCfg()', sandbox);
  assert.equal(JSON.parse(store.get('hugo_admin_cfg')).commentsToken, undefined);
});

test('401/403 会把内存里的会话状态清掉，避免界面假装还有权限', async () => {
  const { sandbox } = makeSandbox({
    responses: [
      { ok: true, status: 200, data: { ok: true, admin: true, csrf: 'csrf-abc' } },
      { ok: false, status: 401, data: { ok: false, error: { code: 'unauthorized', message: '需要管理口令' } } },
    ],
  });

  await vm.runInContext('cmSyncSession()', sandbox);
  await assert.rejects(() => vm.runInContext("cmFetch('/admin?limit=1')", sandbox), /登录已失效|管理/);
  assert.equal(vm.runInContext('CM_SESSION.admin', sandbox), false);
});
