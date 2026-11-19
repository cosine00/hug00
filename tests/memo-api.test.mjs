/**
 * 「发哔哔」接口回归测试。
 *
 * 这里要钉死的是四件事：
 *   1. 令牌只在服务端，缺配置时给人话而不是 500；
 *   2. 图片只认自家图床的地址，正文里的图必须来自刚上传的那几张；
 *   3. 发成功之后要带上 memo_id 去触发单条同步，别让博客等每日全量；
 *   4. 连点和重试不能发出两条。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleWriteMemo } from '../worker/src/memo.js';

const BASE_ENV = {
  FLAREMO_PAT: 'memos_pat_unit',
  FLAREMO_BASE: 'https://drafts.example.com',
  R2_PUBLIC_URL: 'https://img.example.com',
  GITHUB_TOKEN: 'gh_unit',
  WRITE_GITHUB_REPO: 'cosine00/hug00',
  WRITE_GITHUB_BRANCH: 'master',
};

const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;

let calls = [];
let flaremoReply = null;
let githubReply = null;

let ipSeed = 0;
function nextIp() {
  ipSeed += 1;
  return `10.1.0.${ipSeed}`;
}

function memoRequest(payload, ip = nextIp()) {
  return new Request('https://comments.hux.ink/api/write/memo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(payload),
  });
}

function fakeFetch(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  calls.push({ url, init });
  if (url.indexOf('api.github.com') > -1) {
    // 204 不能带 body，构造时传空字符串会直接抛
    return Promise.resolve(githubReply ? githubReply() : new Response(null, { status: 204 }));
  }
  return Promise.resolve(
    flaremoReply
      ? flaremoReply()
      : new Response(JSON.stringify({ name: 'memos/9001', content: 'x', visibility: 'PUBLIC' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
  );
}

beforeEach(() => {
  calls = [];
  flaremoReply = null;
  githubReply = null;
  globalThis.fetch = fakeFetch;
  console.log = () => {};
  console.error = () => {};
});

process.on('exit', () => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
});

test('没配令牌时返回可照做的提示', async () => {
  const response = await handleWriteMemo(memoRequest({ content: '你好' }), { ...BASE_ENV, FLAREMO_PAT: '' });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'flaremo_not_configured');
  assert.match(body.error.message, /FLAREMO_PAT/);
  assert.equal(calls.length, 0);
});

test('空内容不发', async () => {
  const response = await handleWriteMemo(memoRequest({ content: '   ' }), BASE_ENV);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'empty_memo');
  assert.equal(calls.length, 0);
});

test('超长正文被挡下', async () => {
  const response = await handleWriteMemo(memoRequest({ content: '字'.repeat(10001) }), BASE_ENV);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'memo_too_long');
  assert.equal(calls.length, 0);
});

test('图片超过九张被挡下', async () => {
  const images = Array.from({ length: 10 }, (_, i) => `https://img.example.com/images/2026/11/${i}.webp`);
  const response = await handleWriteMemo(memoRequest({ content: '图多', images }), BASE_ENV);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'too_many_images');
  assert.equal(calls.length, 0);
});

test('外站图片地址不收', async () => {
  const response = await handleWriteMemo(
    memoRequest({ content: '图', images: ['https://evil.example.com/a.png'] }),
    BASE_ENV
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'bad_image');
  assert.equal(calls.length, 0);
});

test('发一条：正文带图、只调一次创建、再触发单条同步', async () => {
  const response = await handleWriteMemo(
    memoRequest({
      content: '今天跑了五公里',
      images: ['https://img.example.com/images/2026/11/a.webp', 'https://img.example.com/images/2026/11/b.webp'],
    }),
    BASE_ENV
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, '9001');
  assert.equal(body.sync, 'queued');

  const create = calls.find((call) => call.url === 'https://drafts.example.com/api/v1/memos');
  assert.ok(create, '没有调用 FlareMo 创建接口');
  assert.equal(create.init.headers.Authorization, 'Bearer memos_pat_unit');
  const sent = JSON.parse(create.init.body);
  assert.equal(sent.visibility, 'PUBLIC');
  assert.match(sent.content, /^今天跑了五公里/);
  assert.ok(sent.content.indexOf('![](https://img.example.com/images/2026/11/a.webp)') > -1);
  assert.ok(sent.content.indexOf('![](https://img.example.com/images/2026/11/b.webp)') > -1);

  const dispatch = calls.find((call) => call.url.indexOf('/actions/workflows/fetch-memos.yml/dispatches') > -1);
  assert.ok(dispatch, '没有触发博客同步');
  const payload = JSON.parse(dispatch.init.body);
  assert.equal(payload.ref, 'master');
  assert.equal(payload.inputs.memo_id, '9001');
});

test('正文里已经贴过的图不重复追加', async () => {
  const url = 'https://img.example.com/images/2026/11/a.webp';
  await handleWriteMemo(memoRequest({ content: `看这个 ![](${url})`, images: [url] }), BASE_ENV);
  const create = calls.find((call) => call.url === 'https://drafts.example.com/api/v1/memos');
  const sent = JSON.parse(create.init.body);
  const hits = sent.content.split(url).length - 1;
  assert.equal(hits, 1);
});

test('FlareMo 说令牌不对时翻成人话', async () => {
  flaremoReply = () => new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401 });
  const response = await handleWriteMemo(memoRequest({ content: '你好' }), BASE_ENV);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, 'flaremo_auth_failed');
  assert.match(body.error.message, /FLAREMO_PAT/);
});

test('同一个 rid 只发一次', async () => {
  const ip = nextIp();
  const first = await handleWriteMemo(memoRequest({ content: '只发一条', rid: 'rid-1' }, ip), BASE_ENV);
  assert.equal(first.status, 200);
  const before = calls.filter((call) => call.url === 'https://drafts.example.com/api/v1/memos').length;

  const second = await handleWriteMemo(memoRequest({ content: '只发一条', rid: 'rid-1' }, ip), BASE_ENV);
  assert.equal(second.status, 200);
  const body = await second.json();
  assert.equal(body.sync, 'duplicate');
  const after = calls.filter((call) => call.url === 'https://drafts.example.com/api/v1/memos').length;
  assert.equal(after, before);
});

test('连着发两条会被节流挡一下', async () => {
  const ip = nextIp();
  await handleWriteMemo(memoRequest({ content: '第一条', rid: 'a' }, ip), BASE_ENV);
  const second = await handleWriteMemo(memoRequest({ content: '第二条', rid: 'b' }, ip), BASE_ENV);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'too_fast');
});

test('同步触发失败不影响发布结果', async () => {
  flaremoReply = () => new Response(JSON.stringify({ name: 'memos/9002' }), { status: 200 });
  githubReply = () => new Response('{"message":"Resource not accessible"}', { status: 403 });
  const response = await handleWriteMemo(memoRequest({ content: '发一条' }), BASE_ENV);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, '9002');
  assert.equal(body.sync, 'failed');
});
