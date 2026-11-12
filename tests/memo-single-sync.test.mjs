/**
 * 单条同步的端到端测试：起一个假的 FlareMo（兼假 R2），把真正的
 * .github/scripts/fetch-memos.js 跑在临时目录里，验证事件级同步的
 * 写入/移除/幂等/失败保护，以及和全量同步产物的同构性。
 *
 * 跑法：node --test tests/memo-single-sync.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, '.github/scripts');

/* ------------------------------ 假服务端 ------------------------------ */

const server = {
  memos: new Map(), // id -> DTO
  list: [], // 全量接口返回的 DTO 数组（顺序即时间倒序）
  failures: new Map(), // id -> 'error401' | 'error500' | 'abort'
  puts: [], // R2 PUT 的 key
};

function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

const listener = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'PUT') {
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
    });
    req.on('end', () => {
      server.puts.push({ key: decodeURIComponent(url.pathname), bytes });
      res.writeHead(200);
      res.end();
    });
    return;
  }

  const attachment = /^\/file\/attachments\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (attachment) {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from('fake-image-bytes'));
    return;
  }

  const single = /^\/api\/v1\/memos\/([^/]+)$/.exec(url.pathname);
  if (single && req.method === 'GET') {
    const id = decodeURIComponent(single[1]);
    const failure = server.failures.get(id);
    if (failure === 'error401') return json(res, { code: 16, message: 'unauthorized' }, 401);
    if (failure === 'error500') return json(res, { code: 13, message: 'internal' }, 500);
    if (failure === 'abort') {
      req.socket.destroy();
      return;
    }
    const memo = server.memos.get(id);
    if (!memo) return json(res, { code: 5, message: 'Memo not found' }, 404);
    return json(res, memo);
  }

  if (url.pathname === '/api/v1/memos' && req.method === 'GET') {
    const pageSize = Math.max(1, Number(url.searchParams.get('pageSize')) || 50);
    const offset = Number(url.searchParams.get('pageToken')) || 0;
    const rows = server.list.slice(offset, offset + pageSize);
    const next = offset + pageSize < server.list.length ? String(offset + pageSize) : '';
    return json(res, { memos: rows, ...(next ? { nextPageToken: next } : {}) });
  }

  json(res, { code: 5, message: 'not found' }, 404);
});

let base = '';

test.before(async () => {
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${listener.address().port}`;
});

test.after(() => new Promise(resolve => listener.close(resolve)));

/* ------------------------------ 夹具 ------------------------------ */

function memoDto(id, options = {}) {
  const {
    content = `内容 ${id}`,
    visibility = 'PUBLIC',
    state = 'NORMAL',
    createTime = '2026-01-01T00:00:00.000Z',
    updateTime = createTime,
    attachments = [],
  } = options;
  return {
    name: `memos/${id}`,
    id,
    state,
    creator: 'users/owner',
    createTime,
    updateTime,
    content,
    visibility,
    tags: [],
    pinned: false,
    attachments,
    relations: [],
    reactions: [],
    snippet: '',
  };
}

function attachmentDto(name, extra = {}) {
  return {
    name,
    id: name,
    filename: `${name.split('/').pop()}.png`,
    type: 'image/png',
    size: 16,
    createTime: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function resetServer() {
  server.memos.clear();
  server.list = [];
  server.failures.clear();
  server.puts = [];
}

/** 造一个只含必要文件的临时仓库，脚本会在里面读写 static/memos.json。 */
function makeRepo(seedEntries = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-sync-'));
  fs.mkdirSync(path.join(dir, 'static'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.github/scripts'), { recursive: true });
  for (const file of fs.readdirSync(SCRIPTS)) {
    if (!file.endsWith('.js')) continue;
    fs.copyFileSync(path.join(SCRIPTS, file), path.join(dir, '.github/scripts', file));
  }
  fs.writeFileSync(
    path.join(dir, '.github/scripts/memo-attachment-cache.json'),
    '{}\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(dir, 'static/memos.json'),
    `${JSON.stringify(seedEntries, null, 2)}\n`,
    'utf-8',
  );
  return dir;
}

async function runSync(dir, env = {}) {
  const childEnv = {
    PATH: process.env.PATH,
    FLAREMO_BASE: base,
    FLAREMO_PAT: 'test-pat',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_ENDPOINT: base,
    R2_BUCKET: 'bucket',
    R2_PUBLIC_DOMAIN: 'img.test',
    ...env,
  };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  return await new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(dir, '.github/scripts/fetch-memos.js')], {
      cwd: dir,
      env: childEnv,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function readMemos(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'static/memos.json'), 'utf-8'));
}

function seedMemo(id, createdTs, content = `内容 ${id}`) {
  return { id, content, createdTs, resourceList: [], tags: [] };
}

const SEED = [
  seedMemo('100', 1767225600), // 2026-01-01
  seedMemo('90', 1764547200), // 2025-12-01
  seedMemo('80', 1761955200), // 2025-11-01
];

/* ------------------------------ 用例 ------------------------------ */

test('新增公开 Memo：追加并按 createdTs 降序', async () => {
  resetServer();
  const dir = makeRepo(SEED);
  server.memos.set('300', memoDto('300', { createTime: '2026-06-01T00:00:00.000Z' }));

  const { code } = await runSync(dir, { MEMO_ID: '300', MEMO_ACTION: 'upsert' });
  assert.equal(code, 0);

  const memos = readMemos(dir);
  assert.deepEqual(memos.map(m => m.id), ['300', '100', '90', '80']);
  assert.deepEqual(Object.keys(memos[0]), ['id', 'content', 'createdTs', 'resourceList', 'tags']);
});

test('编辑公开 Memo：按 id 原位替换，不产生重复', async () => {
  resetServer();
  const dir = makeRepo(SEED);
  server.memos.set('90', memoDto('90', {
    content: '改过的正文',
    createTime: '2025-12-01T00:00:00.000Z', // 与 seed 的 createdTs 一致
  }));

  const { code } = await runSync(dir, { MEMO_ID: '90', MEMO_ACTION: 'upsert' });
  assert.equal(code, 0);

  const memos = readMemos(dir);
  assert.equal(memos.length, 3);
  assert.deepEqual(memos.map(m => m.id), ['100', '90', '80']);
  assert.equal(memos[1].content, '改过的正文');
});

test('公开改私密：立刻从 JSON 移除', async () => {
  resetServer();
  const dir = makeRepo(SEED);
  server.memos.set('100', memoDto('100', { visibility: 'PRIVATE' }));

  const { code, output } = await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'upsert' });
  assert.equal(code, 0);
  assert.match(output, /memo 100 移除/);
  assert.deepEqual(readMemos(dir).map(m => m.id), ['90', '80']);
});

test('私密改公开：写回 JSON', async () => {
  resetServer();
  const dir = makeRepo([seedMemo('90', 1764547200), seedMemo('80', 1761955200)]);
  server.memos.set('100', memoDto('100'));

  const { code } = await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'upsert' });
  assert.equal(code, 0);
  assert.deepEqual(readMemos(dir).map(m => m.id), ['100', '90', '80']);
});

test('删除（404）与回收站（TRASHED）都移除；恢复后重新写入', async () => {
  resetServer();
  const dir = makeRepo(SEED);

  // 彻底删除 → 接口 404
  assert.equal((await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'remove' })).code, 0);
  assert.deepEqual(readMemos(dir).map(m => m.id), ['90', '80']);

  // 移入回收站 → 200 但 state=TRASHED
  server.memos.set('90', memoDto('90', { state: 'TRASHED' }));
  assert.equal((await runSync(dir, { MEMO_ID: '90', MEMO_ACTION: 'remove' })).code, 0);
  assert.deepEqual(readMemos(dir).map(m => m.id), ['80']);

  // 恢复 → 200 + NORMAL + PUBLIC
  server.memos.set('90', memoDto('90'));
  assert.equal((await runSync(dir, { MEMO_ID: '90', MEMO_ACTION: 'upsert' })).code, 0);
  assert.deepEqual(readMemos(dir).map(m => m.id), ['90', '80']);
});

test('新增附件：转存 R2 并写入 resourceList', async () => {
  resetServer();
  const dir = makeRepo([seedMemo('100', 1767225600)]);
  server.memos.set('100', memoDto('100', {
    attachments: [attachmentDto('attachments/aaa')],
  }));

  const { code } = await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'upsert' });
  assert.equal(code, 0);
  assert.equal(server.puts.length, 1);

  const [memo] = readMemos(dir);
  assert.equal(memo.resourceList.length, 1);
  assert.match(memo.resourceList[0].externalLink, /^https:\/\/img\.test\//);
  assert.equal(memo.resourceList[0].filename, 'aaa.png');
});

test('删除附件：resourceList 清空，已转存的图片保留在图床', async () => {
  resetServer();
  const dir = makeRepo([seedMemo('100', 1000)]);
  server.memos.set('100', memoDto('100', {
    attachments: [attachmentDto('attachments/aaa')],
  }));
  assert.equal((await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'upsert' })).code, 0);

  server.memos.set('100', memoDto('100', { attachments: [] }));
  assert.equal((await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'upsert' })).code, 0);
  assert.deepEqual(readMemos(dir)[0].resourceList, []);
});

test('同一事件重复执行：结果一致，第二次不写盘', async () => {
  resetServer();
  const dir = makeRepo(SEED);
  server.memos.set('300', memoDto('300'));

  assert.equal((await runSync(dir, { MEMO_ID: '300', MEMO_ACTION: 'upsert' })).code, 0);
  const first = fs.readFileSync(path.join(dir, 'static/memos.json'), 'utf-8');
  const second = await runSync(dir, { MEMO_ID: '300', MEMO_ACTION: 'upsert' });
  assert.equal(second.code, 0);
  assert.match(second.output, /内容无变化，不写盘/);
  assert.equal(fs.readFileSync(path.join(dir, 'static/memos.json'), 'utf-8'), first);
});

test('两条不同 Memo 连续事件都能落地', async () => {
  resetServer();
  const dir = makeRepo(SEED);
  server.memos.set('300', memoDto('300', { createTime: '2026-06-01T00:00:00.000Z' }));
  server.memos.set('301', memoDto('301', { createTime: '2026-05-01T00:00:00.000Z' }));

  assert.equal((await runSync(dir, { MEMO_ID: '300', MEMO_ACTION: 'upsert' })).code, 0);
  assert.equal((await runSync(dir, { MEMO_ID: '301', MEMO_ACTION: 'upsert' })).code, 0);
  assert.deepEqual(readMemos(dir).map(m => m.id), ['300', '301', '100', '90', '80']);
});

test('鉴权失败、5xx、连接中断：退出码 1 且文件字节不变', async () => {
  for (const failure of ['error401', 'error500', 'abort']) {
    resetServer();
    const dir = makeRepo(SEED);
    const before = fs.readFileSync(path.join(dir, 'static/memos.json'), 'utf-8');
    server.failures.set('100', failure);

    const { code, output } = await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'remove' });
    assert.equal(code, 1, `${failure} 应当失败`);
    assert.match(output, /单条同步未完成/);
    assert.equal(
      fs.readFileSync(path.join(dir, 'static/memos.json'), 'utf-8'),
      before,
      `${failure} 不得改写 memos.json`,
    );
  }
});

test('没有 MEMO_ID 时走全量，产物与逐条同步结果一致', async () => {
  resetServer();
  const all = [
    memoDto('100', { content: '内容 100', createTime: '2026-01-01T00:00:00.000Z' }),
    memoDto('90', { content: '内容 90', createTime: '2025-12-01T00:00:00.000Z' }),
    memoDto('80', { content: '内容 80', createTime: '2025-11-01T00:00:00.000Z' }),
    memoDto('70', { content: '私密', visibility: 'PRIVATE', createTime: '2025-10-01T00:00:00.000Z' }),
    memoDto('60', { content: '回收站', state: 'TRASHED', createTime: '2025-09-01T00:00:00.000Z' }),
  ];
  server.list = all;
  for (const memo of all) server.memos.set(memo.id, memo);

  const fullDir = makeRepo([]);
  const full = await runSync(fullDir, { FLAREMO_PAGE_SIZE: '2' });
  assert.equal(full.code, 0);
  const fullMemos = readMemos(fullDir);
  assert.deepEqual(fullMemos.map(m => m.id), ['100', '90', '80']);

  // 同样的数据，逐条事件累积出来的结果必须逐字节相同
  const singleDir = makeRepo(SEED);
  for (const id of ['100', '90', '80', '70', '60']) {
    assert.equal((await runSync(singleDir, { MEMO_ID: id, MEMO_ACTION: 'upsert' })).code, 0);
  }
  assert.deepEqual(readMemos(singleDir), fullMemos);
});

test('日志里不出现 Memo 正文', async () => {
  resetServer();
  const dir = makeRepo(SEED);
  server.memos.set('100', memoDto('100', {
    content: '这是不该出现在日志里的私密正文 SECRET-MARKER',
    visibility: 'PRIVATE',
  }));

  const { code, output } = await runSync(dir, { MEMO_ID: '100', MEMO_ACTION: 'upsert' });
  assert.equal(code, 0);
  assert.ok(!output.includes('SECRET-MARKER'));
});
