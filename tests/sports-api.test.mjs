/**
 * 工作台运动记录的读写接口（worker/src/sports.js）。
 *
 * 这块的东西一旦写错就是静默丢数据，所以拿假的 GitHub 响应把请求体拆开看：
 *   1. 手工记录与同步记录合成一张表，同步记录的名称取 overrides 里的；
 *   2. 新增的 run_id 是「日期 + 当日最大序号 + 1」，删过记录也不撞号；
 *   3. 改手工记录保留原 run_id，改时间不换身份；
 *   4. 同步记录改名只写 overrides.json，一个字节都不碰 activities.json；
 *   5. 撞车（409）要重读重写一次，不能直接把用户的修改丢掉；
 *   6. 触发抓取不带任何 inputs，只认白名单里的那一个 workflow。
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleSportsGet, handleSportsSave, handleRefresh } from '../worker/src/sports.js';

const env = {
  GITHUB_TOKEN: 'unit-test-token',
  WRITE_GITHUB_REPO: 'cosine00/hug00',
  WRITE_GITHUB_BRANCH: 'master',
};

const realFetch = globalThis.fetch;
const calls = [];

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function unb64(data) {
  return Buffer.from(String(data).replace(/\s+/g, ''), 'base64').toString('utf8');
}

/**
 * routes(path, init, state) 返回 { status, body }；
 * 传 204 时按无响应体处理（fetch 规范不允许 204 带 body）。
 */
function stubFetch(routes) {
  calls.length = 0;
  const state = { puts: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body });
    const path = url.replace('https://api.github.com', '');
    const route = routes(path, init, state);
    if (!route) throw new Error(`没准备好这个请求：${method} ${path}`);
    if (route.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.body || {}), {
      status: route.status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return state;
}

function postRequest(payload) {
  return new Request('https://comments.hux.ink/api/write/sports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function contentsBody(text) {
  return { sha: 'sha-' + text.length, content: b64(text) };
}

const ACT = [
  { run_id: 20261111002, name: '登月计划', moving_time: '0:57:00', type: 'Stair', start_date_local: '2026-11-11 06:58', summary_polyline: '', average_heartrate: 138, source: 'manual' },
  { run_id: 20261111001, name: '跳绳', moving_time: '0:20:00', type: 'RopeSkipping', start_date_local: '2026-11-11 20:10', summary_polyline: '', average_heartrate: 120, source: 'manual' },
];

const ACTIVITIES = [
  { run_id: 9, name: '星期四 晚间跑', distance: 7117, moving_time: '0:42:42', type: 'Run', start_date_local: '2026-09-18 18:14:57' },
  { run_id: 8, name: '通勤步行', distance: 1200, moving_time: '0:15:00', type: 'Walk', start_date_local: '2026-09-18 08:03:28' },
];

const OVERRIDES = { '2026-09-18 18:14:57': '下班跑路回家' };

/** 三个数据文件都能读到的标准桩 */
function baseRoutes(extra) {
  return (path, init, state) => {
    if (extra) {
      const hit = extra(path, init, state);
      if (hit) return hit;
    }
    if (path.indexOf('/contents/assets/act.json') > -1) return { body: contentsBody(JSON.stringify(ACT)) };
    if (path.indexOf('/contents/assets/activity-name-overrides.json') > -1) return { body: contentsBody(JSON.stringify(OVERRIDES)) };
    if (path.indexOf('/contents/assets/activities.json') > -1) return { body: contentsBody(JSON.stringify(ACTIVITIES)) };
    return null;
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ------------------------------ 读 ------------------------------ */

test('把手工记录和最近同步记录合成一张表，同步名称取 overrides', async () => {
  stubFetch(baseRoutes());
  const response = await handleSportsGet(env);
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.counts.manual, 2);
  assert.equal(payload.counts.synced, 2);

  const kinds = payload.items.map((item) => item.kind);
  assert.ok(kinds.includes('manual') && kinds.includes('synced'));

  const renamed = payload.items.find((item) => item.key === '2026-09-18 18:14:57');
  assert.equal(renamed.name, '下班跑路回家');
  assert.equal(renamed.source, '星期四 晚间跑');
  assert.equal(renamed.renamed, true);

  const walked = payload.items.find((item) => item.key === '2026-09-18 08:03:28');
  assert.equal(walked.name, '通勤步行');
  assert.equal(walked.renamed, false);

  // 时间倒序：11-11 的两条在 09-18 前面
  assert.equal(payload.items[0].when.slice(0, 7), '2026-11');
});

test('KM 只保留一位小数，手工记录没有距离就给 0', async () => {
  stubFetch(baseRoutes());
  const payload = await (await handleSportsGet(env)).json();
  const run = payload.items.find((item) => item.key === '2026-09-18 18:14:57');
  assert.equal(run.km, 7.1);
  const stair = payload.items.find((item) => item.key === '2026-11-11 06:58');
  assert.equal(stair.km, 0);
  assert.equal(stair.minutes, 57);
});

test('activities.json 超过 1MB 时走 git blobs 兜底，同步记录不会变空', async () => {
  stubFetch((path) => {
    if (path.indexOf('/contents/assets/act.json') > -1) return { body: contentsBody(JSON.stringify(ACT)) };
    if (path.indexOf('/contents/assets/activity-name-overrides.json') > -1) return { body: contentsBody(JSON.stringify(OVERRIDES)) };
    if (path.indexOf('/contents/assets/activities.json') > -1) {
      // 超过 1MB 时 contents API 只回元数据：content 是空串
      return { body: { sha: 'big-sha', content: '', encoding: 'none' } };
    }
    if (path === '/repos/cosine00/hug00/git/blobs/big-sha') {
      return { body: { content: b64(JSON.stringify(ACTIVITIES)), encoding: 'base64' } };
    }
    return null;
  });

  const payload = await (await handleSportsGet(env)).json();
  assert.equal(payload.counts.synced, 2);
  assert.ok(payload.items.some((item) => item.kind === 'synced'), '同步记录不能因为文件大就消失');
});

/* ------------------------------ 新增 ------------------------------ */

test('新增：run_id 取当日最大序号加一，字段与现有条目同构', async () => {
  stubFetch(baseRoutes((path, init) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/act.json') > -1) {
      return { body: { content: { sha: 'new-sha' }, commit: {} } };
    }
    return null;
  }));

  const response = await handleSportsSave(postRequest({
    action: 'add', kind: 'manual', name: '爬楼梯', type: 'Stair', minutes: 25, when: '2026-11-11 21:30',
  }), env);
  assert.equal(response.status, 200);

  const put = calls.find((call) => call.method === 'PUT');
  assert.ok(put, '应该有一次 PUT');
  const written = JSON.parse(unb64(JSON.parse(put.body).content));
  const created = written.find((item) => item.start_date_local === '2026-11-11 21:30');

  assert.ok(created, '新记录应该写进文件');
  assert.equal(created.run_id, 20261111003, '当日已有 001、002，新的应该是 003');
  assert.equal(created.moving_time, '0:25:00');
  assert.equal(created.source, 'manual');
  assert.equal(created.summary_polyline, '');
  assert.equal(written[0].start_date_local, '2026-11-11 21:30', '写回时按时间倒序');
});

test('新增：同一时间点已经有记录就明确拒绝，不静默覆盖', async () => {
  stubFetch(baseRoutes());
  const response = await handleSportsSave(postRequest({
    action: 'add', kind: 'manual', name: '重复', type: 'Workout', minutes: 30, when: '2026-11-11 06:58',
  }), env);
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error.message, /已经有一条/);
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
});

test('新增：时间格式不对时不落盘', async () => {
  stubFetch(baseRoutes());
  const response = await handleSportsSave(postRequest({
    action: 'add', kind: 'manual', name: '爬楼', type: 'Stair', minutes: 20, when: '11/11 21:30',
  }), env);
  assert.equal(response.status, 400);
});

/* ------------------------------ 修改 ------------------------------ */

test('改手工记录：保留原 run_id，改时间也不换身份', async () => {
  stubFetch(baseRoutes((path, init) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/act.json') > -1) {
      return { body: { content: { sha: 'new-sha' }, commit: {} } };
    }
    return null;
  }));

  const response = await handleSportsSave(postRequest({
    action: 'update', kind: 'manual', key: '2026-11-11 06:58',
    name: '爬楼三十层', type: 'Stair', minutes: 61, when: '2026-11-11 07:10',
  }), env);
  assert.equal(response.status, 200);

  const written = JSON.parse(unb64(JSON.parse(calls.find((c) => c.method === 'PUT').body).content));
  const edited = written.find((item) => item.start_date_local === '2026-11-11 07:10');

  assert.ok(edited);
  assert.equal(edited.run_id, 20261111002, 'run_id 跟着记录走');
  assert.equal(edited.name, '爬楼三十层');
  assert.equal(edited.moving_time, '1:01:00');
  assert.equal(written.some((item) => item.start_date_local === '2026-11-11 06:58'), false, '旧时间点应当消失');
});

test('改同步记录：只写 overrides，不碰 activities.json', async () => {
  stubFetch(baseRoutes((path, init) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/activity-name-overrides.json') > -1) {
      return { body: { content: { sha: 'ov-sha' }, commit: {} } };
    }
    return null;
  }));

  const response = await handleSportsSave(postRequest({
    action: 'update', kind: 'synced', key: '2026-09-18 08:03:28', name: '走着去上班',
  }), env);
  assert.equal(response.status, 200);

  const puts = calls.filter((call) => call.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.match(puts[0].url, /activity-name-overrides\.json/);
  assert.equal(calls.some((call) => call.method === 'PUT' && /activities\.json/.test(call.url)), false);

  const written = JSON.parse(unb64(JSON.parse(puts[0].body).content));
  assert.equal(written['2026-09-18 08:03:28'], '走着去上班');
  assert.equal(written['2026-09-18 18:14:57'], '下班跑路回家', '别的覆盖要留着');
});

test('同步记录改名清空 = 删掉这条覆盖，回到同步名称', async () => {
  stubFetch(baseRoutes((path, init) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/activity-name-overrides.json') > -1) {
      return { body: { content: { sha: 'ov-sha' }, commit: {} } };
    }
    return null;
  }));

  await handleSportsSave(postRequest({
    action: 'update', kind: 'synced', key: '2026-09-18 18:14:57', name: '',
  }), env);

  const written = JSON.parse(unb64(JSON.parse(calls.find((c) => c.method === 'PUT').body).content));
  assert.equal(Object.prototype.hasOwnProperty.call(written, '2026-09-18 18:14:57'), false);
});

test('改一条不存在的记录：404，而不是悄悄新增一条', async () => {
  stubFetch(baseRoutes());
  const response = await handleSportsSave(postRequest({
    action: 'update', kind: 'manual', key: '2020-01-01 00:00', name: '幽灵', type: 'Workout', minutes: 10, when: '2020-01-01 00:00',
  }), env);
  assert.equal(response.status, 404);
});

/* ------------------------------ 删除 ------------------------------ */

test('删除只移走那一条', async () => {
  stubFetch(baseRoutes((path, init) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/act.json') > -1) {
      return { body: { content: { sha: 'new-sha' }, commit: {} } };
    }
    return null;
  }));

  const response = await handleSportsSave(postRequest({
    action: 'delete', kind: 'manual', key: '2026-11-11 20:10',
  }), env);
  assert.equal(response.status, 200);

  const written = JSON.parse(unb64(JSON.parse(calls.find((c) => c.method === 'PUT').body).content));
  assert.equal(written.length, 1);
  assert.equal(written[0].start_date_local, '2026-11-11 06:58');
});

/* ------------------------------ 撞车 ------------------------------ */

test('写入撞车（409）时重读重写一次，修改不丢', async () => {
  const state = stubFetch(baseRoutes((path, init, st) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/act.json') > -1) {
      st.puts += 1;
      if (st.puts === 1) return { status: 409, body: { message: 'sha does not match' } };
      return { body: { content: { sha: 'new-sha' }, commit: {} } };
    }
    return null;
  }));

  const response = await handleSportsSave(postRequest({
    action: 'add', kind: 'manual', name: '跳绳', type: 'RopeSkipping', minutes: 18, when: '2026-11-12 07:00',
  }), env);

  assert.equal(response.status, 200);
  assert.equal(state.puts, 2, '第一次撞车，第二次应当成功');
});

test('连续两次撞车就把话说清楚，别假装成功', async () => {
  stubFetch(baseRoutes((path, init) => {
    if (init.method === 'PUT' && path.indexOf('/contents/assets/act.json') > -1) {
      return { status: 409, body: { message: 'sha does not match' } };
    }
    return null;
  }));

  const response = await handleSportsSave(postRequest({
    action: 'add', kind: 'manual', name: '跳绳', type: 'RopeSkipping', minutes: 18, when: '2026-11-12 07:00',
  }), env);

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error.message, /自动同步/);
});

/* ------------------------------ 抓取 ------------------------------ */

test('手工补抓只派发白名单里的那个 workflow', async () => {
  stubFetch((path, init) => {
    if (init.method === 'POST' && /\/actions\/workflows\/fetch-friend-circle\.yml\/dispatches$/.test(path)) {
      return { status: 204 };
    }
    return null;
  });

  const response = await handleRefresh(new Request('https://comments.hux.ink/api/write/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'friends' }),
  }), env);

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.queued, true);
  assert.equal(payload.label, '博友 RSS');

  const dispatch = calls.find((call) => /dispatches$/.test(call.url));
  const body = JSON.parse(dispatch.body);
  assert.equal(body.ref, 'master');
  assert.equal(body.inputs, undefined, '这个 workflow 不需要 inputs');
});

test('不认识的任务名直接拒绝，不会把任意 workflow 名拼进 URL', async () => {
  stubFetch(() => null);
  const response = await handleRefresh(new Request('https://comments.hux.ink/api/write/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: '../../evil' }),
  }), env);

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
