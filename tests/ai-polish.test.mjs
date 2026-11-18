/**
 * AI 润色接口回归测试。
 *
 * 这块代码不做任何写操作，但有三件事一旦漏了就会出事：
 *   1. 密钥必须只在服务端出现，配置缺失时要给人话而不是 500；
 *   2. 上游的各种脾气（超时、限流、空响应、被截断）都要翻成前端能看懂的提示；
 *   3. 提示词是这个功能的全部分量 —— 风格约束丢了，博客就变成公众号。
 * 所以这里既测请求形状，也测提示词本身。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessages, checkProtected, handlePolish, unwrapFence } from '../worker/src/ai.js';

const env = { DEEPSEEK_API_KEY: 'unit-test-key', DEEPSEEK_MODEL: 'deepseek-flash' };

const realFetch = globalThis.fetch;
const realLog = console.log;
const realError = console.error;
const calls = [];
let reply = null;

/** 每个用例换一个假 IP，就不会撞上「两次请求间隔 1.2 秒」的闸门。 */
let ipSeed = 0;
function nextIp() {
  ipSeed += 1;
  return `10.0.0.${ipSeed}`;
}

function polishRequest(payload, ip = nextIp()) {
  return new Request('https://comments.hux.ink/api/write/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(payload),
  });
}

/** 让上游回一个正常的 chat completion。 */
function upstreamOk(content, finish = 'stop') {
  reply = () => new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function upstreamStatus(status, message) {
  reply = () => new Response(
    JSON.stringify({ error: { message: message || 'nope' } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

before(() => {
  console.log = () => {};
  console.error = () => {};
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: typeof input === 'string' ? input : input.url, body: init.body, init });
    if (!reply) throw new Error('这个用例没有准备上游响应');
    return reply();
  };
});

after(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.error = realError;
});

beforeEach(() => {
  calls.length = 0;
  reply = null;
});

/* ------------------------------ 提示词 ------------------------------ */

test('三种模式各自带上自己的任务说明', () => {
  const polish = buildMessages({ text: 'x', mode: 'polish' })[0].content;
  const tighten = buildMessages({ text: 'x', mode: 'tighten' })[0].content;
  const proofread = buildMessages({ text: 'x', mode: 'proofread' })[0].content;

  assert.match(polish, /改动要克制/);
  assert.match(tighten, /删掉多余的修饰/);
  assert.match(proofread, /能不改就不改/);
  assert.notEqual(polish, tighten);
});

test('系统提示里必须写明风格底线和 Markdown 硬约束', () => {
  const system = buildMessages({ text: 'x' })[0].content;
  for (const rule of ['不升华主题', '不要合并段落', '个人博客', '逐字保留全部标记', '代码块内部一个字符都不许改', 'front matter']) {
    assert.ok(system.includes(rule), `提示词里缺少「${rule}」`);
  }
  // 输出要求：只要正文，别加解释
  assert.match(system, /只输出润色后的 Markdown 正文本身/);
});

test('自定义要求追加在最后，且不能越过硬约束', () => {
  const system = buildMessages({ text: 'x', instruction: '把「我觉得」改成「我认为」' })[0].content;
  assert.match(system, /【作者的补充要求】\n把「我觉得」改成「我认为」/);
  assert.match(system, /以硬约束为准/);
});

test('选中片段与整篇的上下文说明不同', () => {
  const doc = buildMessages({ text: 'x', scope: 'document' })[0].content;
  const sel = buildMessages({ text: 'x', scope: 'selection' })[0].content;
  assert.match(doc, /完整的一篇/);
  assert.match(sel, /不要补全上下文/);
});

test('原文只作为 user 消息，不再套一层说明', () => {
  const messages = buildMessages({ text: '# 标题\n\n正文', mode: 'polish' });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, '# 标题\n\n正文');
});

/* ------------------------------ 结果清理 ------------------------------ */

test('整段被包进代码围栏时剥掉，原文本身是代码则不动', () => {
  assert.equal(unwrapFence('```markdown\n你好\n```'), '你好');
  assert.equal(unwrapFence('你好\n\n世界'), '你好\n\n世界');
  assert.equal(unwrapFence('```\n```'), '```\n```');
});

test('链接、代码块、front matter 被动过要给出警告', () => {
  const before = '---\ntitle: x\n---\n\n看这个 [链接](https://a.com/1) 和 `code`\n\n```js\nconst a = 1;\n```';
  const after = '---\ntitle: x\n---\n\n看这个链接和 code\n\n```js\nconst a = 1;\n```';
  const warnings = checkProtected(before, after);
  assert.ok(warnings.some((w) => w.includes('链接')));
  assert.ok(warnings.some((w) => w.includes('行内代码')));

  const droppedFence = checkProtected('```\nx\n```', 'x');
  assert.ok(droppedFence.some((w) => w.includes('围栏')));

  const droppedFront = checkProtected('---\ntitle: x\n---\n\n正文', '正文');
  assert.ok(droppedFront.some((w) => w.includes('front matter')));
});

test('原样返回时没有任何警告', () => {
  const text = '# 标题\n\n一段话，带 [链接](https://a.com)。\n\n```\ncode\n```';
  assert.deepEqual(checkProtected(text, text), []);
});

/* ------------------------------ 正常路径 ------------------------------ */

test('润色成功：默认模型、关思考、温度跟模式走', async () => {
  upstreamOk('  润色之后的正文  ');
  const response = await handlePolish(polishRequest({ text: '原文', mode: 'tighten', scope: 'selection' }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.text, '润色之后的正文');
  assert.equal(payload.model, 'deepseek-flash');
  assert.deepEqual(payload.warnings, []);
  assert.deepEqual(payload.chars, { in: 2, out: 7 });

  const sent = JSON.parse(calls[0].body);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(sent.model, 'deepseek-flash');
  assert.equal(sent.stream, false);
  assert.deepEqual(sent.thinking, { type: 'disabled' });
  assert.equal(sent.temperature, 0.4);
  assert.equal(sent.messages[1].content, '原文');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer unit-test-key');
});

test('模型名可以在 vars 里换掉，不能由客户端指定', async () => {
  upstreamOk('ok');
  const request = new Request('https://comments.hux.ink/api/write/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': nextIp() },
    body: JSON.stringify({ text: '原文', model: 'deepseek-v4-pro' }),
  });
  const response = await handlePolish(request, { ...env, DEEPSEEK_MODEL: 'deepseek-v4-pro' });
  await response.json();
  assert.equal(JSON.parse(calls[0].body).model, 'deepseek-v4-pro');

  upstreamOk('ok');
  await handlePolish(polishRequest({ text: '原文', model: 'deepseek-v4-pro' }), env);
  assert.equal(JSON.parse(calls[1].body).model, 'deepseek-flash');
});

test('非法的 mode 退回自然润色，补充要求截到 200 字', async () => {
  upstreamOk('ok');
  await handlePolish(polishRequest({ text: '原文', mode: 'rewrite-everything', instruction: '要'.repeat(500) }), env);
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.temperature, 0.65);
  assert.ok(sent.messages[0].content.includes('要'.repeat(200)));
  assert.ok(!sent.messages[0].content.includes('要'.repeat(201)));
});

test('CRLF 在送出去之前统一成 LF', async () => {
  upstreamOk('ok');
  await handlePolish(polishRequest({ text: '第一段\r\n\r\n第二段' }), env);
  assert.equal(JSON.parse(calls[0].body).messages[1].content, '第一段\n\n第二段');
});

/* ------------------------------ 出错路径 ------------------------------ */

test('没配密钥：503，并且不去打上游', async () => {
  const response = await handlePolish(polishRequest({ text: '原文' }), {});
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error.code, 'ai_not_configured');
  assert.match(payload.error.message, /wrangler secret put DEEPSEEK_API_KEY/);
  assert.equal(calls.length, 0);
});

test('空正文、超长正文、坏 JSON 都在本地挡掉', async () => {
  const empty = await handlePolish(polishRequest({ text: '   ' }), env);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error.code, 'empty_text');

  const long = await handlePolish(polishRequest({ text: '字'.repeat(12001) }), env);
  assert.equal(long.status, 413);
  assert.equal((await long.json()).error.code, 'text_too_long');

  const badJson = new Request('https://comments.hux.ink/api/write/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': nextIp() },
    body: '{oops',
  });
  const bad = await handlePolish(badJson, env);
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
});

test('上游 401 翻译成「密钥无效」', async () => {
  upstreamStatus(401, 'Authentication Fails');
  const response = await handlePolish(polishRequest({ text: '原文' }), env);
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.error.code, 'ai_auth_failed');
  assert.match(payload.error.message, /DEEPSEEK_API_KEY/);
});

test('上游 402 / 429 各有各的说法', async () => {
  upstreamStatus(402, 'Insufficient Balance');
  const noMoney = await handlePolish(polishRequest({ text: '原文' }), env);
  assert.equal((await noMoney.json()).error.code, 'ai_no_balance');

  upstreamStatus(429, 'Rate limit');
  const busy = await handlePolish(polishRequest({ text: '原文' }), env);
  assert.equal((await busy.json()).error.code, 'ai_busy');
});

test('空响应和被截断都算失败，不把半截稿子交给作者', async () => {
  upstreamOk('   ');
  const empty = await handlePolish(polishRequest({ text: '原文' }), env);
  assert.equal(empty.status, 502);
  assert.equal((await empty.json()).error.code, 'ai_empty');

  upstreamOk('写到一半', 'length');
  const cut = await handlePolish(polishRequest({ text: '原文' }), env);
  assert.equal(cut.status, 502);
  assert.equal((await cut.json()).error.code, 'ai_truncated');
});

test('网络异常与超时分别给不同的提示', async () => {
  reply = () => { throw new TypeError('network down'); };
  const down = await handlePolish(polishRequest({ text: '原文' }), env);
  assert.equal(down.status, 502);
  assert.equal((await down.json()).error.code, 'ai_network');

  reply = () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  const timeout = await handlePolish(polishRequest({ text: '原文' }), env);
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).error.code, 'ai_timeout');
});

/* ---------------------------- 并发与重复 ---------------------------- */

test('同一个 rid 重复提交直接打回，不打上游', async () => {
  const ip = nextIp();
  const rid = 'ptest' + Date.now().toString(36);
  upstreamOk('ok');
  const first = await handlePolish(polishRequest({ text: '原文', rid }, ip), env);
  assert.equal(first.status, 200);

  const again = await handlePolish(polishRequest({ text: '原文', rid }, ip), env);
  const payload = await again.json();
  assert.equal(again.status, 409);
  assert.equal(payload.error.code, 'duplicate_request');
  assert.equal(calls.length, 1);
});

test('连点两下（换了 rid）会被间隔闸门拦下', async () => {
  const ip = nextIp();
  upstreamOk('ok');
  const first = await handlePolish(polishRequest({ text: '原文', rid: 'a1' }, ip), env);
  assert.equal(first.status, 200);

  const second = await handlePolish(polishRequest({ text: '原文', rid: 'a2' }, ip), env);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error.code, 'too_fast');
  assert.equal(calls.length, 1);
});

test('日志里不出现正文', async () => {
  const logged = [];
  console.log = (...args) => logged.push(args.join(' '));
  console.error = (...args) => logged.push(args.join(' '));
  try {
    upstreamOk('润色稿');
    await handlePolish(polishRequest({ text: '这是一段不该出现在日志里的私密正文' }), env);

    upstreamStatus(500, 'boom');
    await handlePolish(polishRequest({ text: '这也不该出现在日志里' }), env);
  } finally {
    console.log = realLog;
    console.error = realError;
  }

  const all = logged.join('\n');
  assert.ok(all.length > 0, '应该留下了状态日志');
  assert.ok(!all.includes('私密正文'));
  assert.ok(!all.includes('这也不该'));
  assert.ok(!all.includes('unit-test-key'));
});
