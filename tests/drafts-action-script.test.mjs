/**
 * Drafts Action 脚本（docs/drafts/send-to-beta.js）的行为测试。
 *
 * 本机没有 iOS / Drafts，没法真机点一次。但脚本里最容易错的东西都不是「Drafts 的
 * 界面行为」，而是逻辑：
 *   · 第一行要不要去 `#`、`#标签` 会不会被误吃；
 *   · 发出去的字段名跟 Worker 认的是不是同一套（错一个 key 就是线上 400）；
 *   · 只有服务端确认了才报成功，409/401/断网必须报失败。
 * 所以这里搭一个最小的 Drafts 运行时（Credential / HTTP / app / context），
 * 把 HTTP 直接接到真实的 Worker handler 上跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import worker from '../worker/src/index.js';
import { ensureSchema } from '../worker/src/db.js';
import { createD1 } from './helpers/d1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, '../docs/drafts/send-to-beta.js'), 'utf8');

const TOKEN = 'action-script-token';
const UUID = '0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0';

/* --------------------------- 一个最小的 Drafts --------------------------- */

/**
 * @param {object} opts
 *   content  文稿全文
 *   token    Credential 里存的令牌（null 表示用户取消了授权）
 *   network  设为 false 模拟断网（HTTP.request 抛错）
 *   db       真实 D1 假库
 *   reply    不给 Worker 发请求，直接喂一个 { status, body }（用来测限流之类的分支）
 *
 * Drafts 的 `http.request()` 是同步的，而 worker.fetch 是异步的。所以这里跑两遍：
 * 第一遍只把「脚本想发什么」接住（拿到 url/headers/body），真正请求一次，
 * 第二遍把拿到的响应原样喂回去，脚本的业务分支才真正执行。
 * 脚本除了 HTTP / app / context 没有别的副作用，跑两遍是安全的。
 */
async function runAction({ content, token = TOKEN, network = true, db, reply = null }) {
  const state = { success: [], failure: [], requests: [], draftWrites: 0 };
  let canned = null;

  const draft = {
    uuid: UUID,
    content,
    // 脚本只要有一步写了 draft.update()，就说明它动了原文
    update() { state.draftWrites += 1; },
  };

  const Credential = {
    create() {
      return {
        addPasswordField() {},
        authorize() { return token != null; },
        getValue() { return token; },
      };
    },
  };

  const HTTP = {
    create() {
      // Drafts 里 `http.request(...)` 直接返回响应对象（statusCode / responseData），
      // http.response 是同一个东西 —— 两边都给上，跟真机一致
      const http = {
        response: { statusCode: 0, responseData: null, responseText: '' },
        request(options) {
          state.requests.push(options);
          if (!network) throw new Error('The Internet connection appears to be offline.');
          if (canned) http.response = { ...canned };
          return http.response;
        },
      };
      return http;
    },
  };

  const app = {
    displaySuccessMessage(text) { state.success.push(text); },
    displayInfoMessage(text) { state.success.push(text); },
    displayErrorMessage(text) { state.failure.push(text); },
  };

  const context = {
    fail(message) { state.failure.push(message); },
  };

  // Drafts 把脚本包在一个函数里跑，所以顶层的 return 是合法的
  const runOnce = () => {
    const fn = new Function('draft', 'Credential', 'HTTP', 'app', 'context', SOURCE);
    fn(draft, Credential, HTTP, app, context);
  };

  runOnce();

  const last = state.requests[state.requests.length - 1];
  if (network && last) {
    if (reply) {
      canned = { statusCode: reply.status, responseText: JSON.stringify(reply.body), responseData: reply.body };
    } else {
      // 严格照 Drafts 的语义发：请求体只来自 data + encoding。
      // 脚本要是改回用 `body` 传字符串，这里就发不出任何东西，服务端回 400 —— 当场红。
      const res = await worker.fetch(
        new Request(last.url, {
          method: last.method || 'GET',
          headers: last.headers || {},
          body: last.data !== undefined
            ? (last.encoding === 'json' ? JSON.stringify(last.data) : String(last.data))
            : '',
        }),
        envFor(db),
        {}
      );
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      canned = { statusCode: res.status, responseText: text, responseData: data };
    }

    state.requests.length = 0;
    state.success.length = 0;
    state.failure.length = 0;
    runOnce();
  }

  return { state, draft };
}

/* --------------------------------- 夹具 --------------------------------- */

let ddl = null;
async function freshDb() {
  const db = createD1();
  if (!ddl) {
    await ensureSchema({ DB: db });
    ddl = db._db
      .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => row.sql);
  } else {
    for (const sql of ddl) db.exec(sql);
  }
  return db;
}

const envFor = (db) => ({ DB: db, DRAFTS_INTEGRATION_TOKEN: TOKEN });

const rowOf = (db) => db._db.prepare('SELECT * FROM write_drafts').all()[0];

/* --------------------------------- 用例 --------------------------------- */

test('正常发送：第一行当标题，正文原样，弹「已发送到 Beta」', async () => {
  const db = await freshDb();
  const content = '在雨里走了一段路\n\n路灯把雨点照得很亮。\n\n## 小标题\n\n- 一条\n- 两条\n';

  const { state, draft } = await runAction({ content, db });

  assert.deepEqual(state.failure, [], '不该有任何失败提示');
  assert.deepEqual(state.success, ['已发送到 Beta']);
  assert.equal(state.draftWrites, 0, '不能动原文');
  assert.equal(draft.content, content, '草稿内容一个字都不能改');

  const row = rowOf(db);
  assert.equal(row.title, '在雨里走了一段路');
  assert.equal(row.body, '路灯把雨点照得很亮。\n\n## 小标题\n\n- 一条\n- 两条');
  assert.equal(row.source_id, UUID.toLowerCase(), '落库时统一成小写标准 UUID');

  // 请求本身也要看一眼：字段名必须和 Worker 认的一致，令牌只能在头里
  const sent = state.requests[0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(sent.data.sourceId, UUID, '上行仍然发 Drafts 原样的 UUID，服务端自己归一');
  assert.ok(!JSON.stringify(sent.data).includes(TOKEN), '令牌不能进请求体');
});

test('`# 标题` 去掉井号；`#标签` 不动', async () => {
  const db = await freshDb();

  await runAction({ content: '# 在雨里走了一段路\n\n正文第一段。', db });
  assert.equal(rowOf(db).title, '在雨里走了一段路');

  // 换一篇（新 uuid 才能建新草稿）
  const db2 = await freshDb();
  const second = await runAction({ content: '#标签 开头的这一行\n\n正文。', db: db2 });
  assert.deepEqual(second.state.failure, []);
  assert.equal(rowOf(db2).title, '#标签 开头的这一行');
});

test('开头空行与结尾空白不影响结果', async () => {
  const db = await freshDb();
  await runAction({ content: '\n\n  \n标题在第三行\n\n正文。   \n\n', db });
  const row = rowOf(db);
  assert.equal(row.title, '标题在第三行');
  assert.equal(row.body, '正文。');
});

test('重复点两次：第二次报「已是最新」，不会多出一篇', async () => {
  const db = await freshDb();
  const content = '标题\n\n正文。';

  await runAction({ content, db });
  const second = await runAction({ content, db });

  assert.deepEqual(second.state.failure, []);
  assert.deepEqual(second.state.success, ['Beta 里已是最新，没有重复创建']);
  assert.equal(db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n, 1);
});

test('Drafts 改了正文再发：报「已更新」，草稿跟着变', async () => {
  const db = await freshDb();
  await runAction({ content: '标题\n\n旧正文。', db });
  const second = await runAction({ content: '标题\n\n新正文。', db });

  assert.deepEqual(second.state.success, ['已更新 Beta 里的草稿']);
  assert.equal(rowOf(db).body, '新正文。');
});

test('Beta 改过：409 报失败，提示里带上 Beta 侧的标题和下一步，且不误报成功', async () => {
  const db = await freshDb();
  await runAction({ content: '标题\n\n正文。', db });
  db.exec("UPDATE write_drafts SET body = 'Beta 里改过的正文。'");

  const { state } = await runAction({ content: '标题\n\nDrafts 改的一版。', db });

  assert.deepEqual(state.success, [], '失败的时候一句成功的话都不能有');
  assert.equal(state.failure.length, 1);
  assert.match(state.failure[0], /改过/);
  assert.match(state.failure[0], /《标题》/);
  assert.match(state.failure[0], /删掉旧草稿后重新发送/);
  assert.equal(rowOf(db).body, 'Beta 里改过的正文。', '还是 Beta 那份，没被覆盖');
});

test('令牌不对：401 报失败并指明是令牌问题', async () => {
  const db = await freshDb();
  const { state } = await runAction({ content: '标题\n\n正文。', token: 'wrong-token', db });

  assert.deepEqual(state.success, []);
  assert.equal(state.failure.length, 1);
  assert.match(state.failure[0], /401/);
  assert.match(state.failure[0], /令牌/);
  assert.equal(db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n, 0);
});

test('断网：报「连不上」，不报成功，草稿原文不动', async () => {
  const db = await freshDb();
  const content = '标题\n\n正文。';
  const { state, draft } = await runAction({ content, db, network: false });

  assert.deepEqual(state.success, []);
  assert.equal(state.failure.length, 1);
  assert.match(state.failure[0], /连不上 Beta/);
  assert.equal(draft.content, content);
  assert.equal(state.draftWrites, 0);
});

test('拿不到令牌（用户取消授权）：什么都不发，直接报失败', async () => {
  const db = await freshDb();
  const { state } = await runAction({ content: '标题\n\n正文。', token: null, db });

  assert.equal(state.requests.length, 0, '没令牌就不该发请求');
  assert.equal(state.failure.length, 1);
  assert.match(state.failure[0], /令牌/);
});

test('空文稿 / 超长标题：本地就拦下来，不浪费一次请求', async () => {
  const db = await freshDb();

  const empty = await runAction({ content: '   \n\n  ', db });
  assert.equal(empty.state.requests.length, 0);
  assert.match(empty.state.failure[0], /空的/);

  const long = await runAction({ content: '标'.repeat(301) + '\n\n正文。', db });
  assert.equal(long.state.requests.length, 0);
  assert.match(long.state.failure[0], /300/);
});

test('服务端限流（429）：报失败并说清楚多久后重试，不误报成功', async () => {
  const db = await freshDb();
  const { state } = await runAction({
    content: '标题\n\n正文。',
    db,
    reply: {
      status: 429,
      body: {
        ok: false,
        error: { code: 'rate_limited', message: '一分钟内发得太勤了（31/30 次），42 秒后再试' },
        retryAfter: 42,
      },
    },
  });

  assert.deepEqual(state.success, []);
  assert.equal(state.failure.length, 1);
  assert.match(state.failure[0], /发得太勤/);
  assert.match(state.failure[0], /42 秒/);
});

test('Beta 改过但 Drafts 没变（beta_modified）：提示「不用重发」，不覆盖', async () => {
  const db = await freshDb();
  await runAction({ content: '标题\n\n正文。', db });
  db.exec("UPDATE write_drafts SET body = 'Beta 里补的。'");

  const { state } = await runAction({ content: '标题\n\n正文。', db });

  assert.deepEqual(state.success, []);
  assert.match(state.failure[0], /和上次一样/);
  assert.match(state.failure[0], /不用重发/);
  assert.equal(db._db.prepare('SELECT body FROM write_drafts').get().body, 'Beta 里补的。');
});

test('能被当成普通脚本编译：Drafts 的 Script 步骤不包函数，顶层 return 会直接报语法错', () => {
  // 真机那次报的就是这个：`SyntaxError: Return statements are only valid inside functions`。
  // vm.Script 的语义和 Drafts 一样（顶层 return 非法），所以这一条能把它挡在提交之前。
  assert.doesNotThrow(
    () => new vm.Script(SOURCE, { filename: 'send-to-beta.js' }),
    '脚本必须能作为顶层脚本执行；分支里的 return 要包在 IIFE 或函数里'
  );
});

test('请求体走 data + encoding:"json"：Drafts 的 http.request 没有 body 选项', async () => {
  const db = await freshDb();
  const { state } = await runAction({ content: '标题\n\n正文。', db });

  assert.equal(state.requests.length, 1, '应该只发一次');
  const sent = state.requests[0];
  assert.equal(sent.encoding, 'json', 'encoding 必须是 json，否则 Drafts 不序列化 data');
  assert.equal(typeof sent.data, 'object', 'data 要给对象，不要自己 JSON.stringify');
  assert.equal(sent.data.title, '标题');
  assert.equal(sent.data.source, 'drafts');
  assert.equal(sent.data.body, '正文。');
  assert.equal(sent.body, undefined, '不能再用 body：这个键会被 Drafts 整个忽略，body 会空');
});
