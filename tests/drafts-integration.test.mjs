/**
 * Drafts → Beta 导入接口回归测试。
 *
 * 这块的关键不是「能不能存进去」，而是「什么时候坚决不存」：
 *   · 同一篇重复发送 → 一行，不重复建；
 *   · Drafts 改了、Beta 没动 → 跟着改；
 *   · Beta 改过 → 409，不管 Drafts 变没变（这条顺序错了会静默漏报）；
 *   · Beta 删了 / 发布了 → 409，不复活、不覆盖线上文章；
 *   · 两个请求同时到 → 不互相覆盖、不重复建、不 500。
 * 判断全靠内容指纹，所以有些用例刻意把 updated_at 设成不合理的值，
 * 确认结果只跟内容有关，跟时间无关。
 *
 * 用真实的 node:sqlite 当 D1（tests/helpers/d1.mjs），SQL 的写法与线上一致。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSchema } from '../worker/src/db.js';
import { handleDraftsImport } from '../worker/src/drafts.js';
import { handleWriteDraftsGet, handleWriteDraftsSave } from '../worker/src/write.js';
import { createD1 } from './helpers/d1.mjs';

const TOKEN = 'drafts-integration-token-for-test';
const UUID = 'F3A1B2C3-4D5E-6F70-8192-A3B4C5D6E7F8';

/* --------------------------------- 夹具 --------------------------------- */

// ensureSchema 每个 isolate 只跑一次，这里借第一次建好的库把 DDL 抄下来，
// 给后面每个用例重建一个干净的库（等价于线上新库 + 迁移后的形状）。
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

const envWith = (db) => ({ DB: db, DRAFTS_INTEGRATION_TOKEN: TOKEN });

function importRequest(payload, token = TOKEN) {
  return new Request('https://comments.hux.ink/api/integrations/drafts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

const payload = (over = {}) => ({
  source: 'drafts',
  sourceId: UUID,
  title: '在雨里走了一段路',
  body: '路灯把雨点照得很亮。\n\n## 小标题\n\n第二段，带 **粗体** 和 `代码`。',
  ...over,
});

/** 直接读一行，绕过接口，看库里到底写了什么。 */
function rowOf(db, id) {
  return db._db.prepare('SELECT * FROM write_drafts WHERE id = ?').get(id);
}

const countRows = (db) => db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n;

const ROW_ID = `dr-${UUID.toLowerCase()}`;

const saveRequest = (drafts) =>
  new Request('https://x/api/write/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drafts }),
  });

const tombstone = (updatedAt) => ({
  id: ROW_ID,
  title: '',
  body: '',
  tags: [],
  createdAt: 1,
  updatedAt,
  deletedAt: updatedAt,
});

/**
 * 把「第一次读这篇草稿」拦下来，等 n 个请求都读到同一份旧状态再一起放行。
 * Node 是单线程的，不做这一步两个请求会天然错开，测不到 CAS 分支。
 */
function barrierDb(db, n) {
  let arrived = 0;
  let pending = n;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          const bound = stmt.bind(...args);
          return {
            async first(...rest) {
              if (pending > 0 && /FROM write_drafts WHERE id = \?/.test(sql)) {
                pending -= 1;
                arrived += 1;
                if (arrived >= n) release();
                await gate;
              }
              return bound.first(...rest);
            },
            all: (...rest) => bound.all(...rest),
            run: (...rest) => bound.run(...rest),
          };
        },
      };
    },
    batch: (statements) => db.batch(statements),
  };
}

/**
 * 读到这一行之后、handler 继续往下走之前，插一件别的事（比如在 Beta 里删掉它）。
 * 用来确定性地测「读与写之间被别人改了」，比靠时间差更可靠。
 */
function afterReadDb(db, sideEffect) {
  let fired = false;
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          const bound = stmt.bind(...args);
          return {
            async first(...rest) {
              const row = await bound.first(...rest);
              if (!fired && /FROM write_drafts WHERE id = \?/.test(sql)) {
                fired = true;
                await sideEffect();
              }
              return row;
            },
            all: (...rest) => bound.all(...rest),
            run: (...rest) => bound.run(...rest),
          };
        },
      };
    },
    batch: (statements) => db.batch(statements),
  };
}

/* ---------------------------------- 建 ---------------------------------- */

test('首次发送：建出一篇草稿，标题正文原样落库，Beta 列表能拉到', async () => {
  const db = await freshDb();
  const res = await handleDraftsImport(importRequest(payload()), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 201);
  assert.equal(data.ok, true);
  assert.equal(data.status, 'created');
  assert.equal(data.id, ROW_ID);
  assert.equal(data.title, '在雨里走了一段路');

  const row = rowOf(db, ROW_ID);
  assert.equal(row.title, '在雨里走了一段路');
  assert.equal(row.body, payload().body, 'Markdown、空行、反引号都要原样保留');
  assert.equal(row.tags, '[]');
  assert.equal(row.slug, '');
  assert.equal(row.published_at, 0);
  assert.equal(row.deleted_at, 0);
  assert.equal(row.source, 'drafts');
  assert.equal(row.source_id, UUID.toLowerCase(), 'UUID 统一成小写标准形式再落库');
  assert.ok(row.source_hash, '要落下内容指纹，后面判断冲突全靠它');

  // Beta 端走的是同一条 GET，Drafts 来的草稿必须出现在里面（还带上来源标记）
  const listed = await (await handleWriteDraftsGet(envWith(db), new URL('https://x/api/write/drafts'))).json();
  assert.equal(listed.drafts.length, 1);
  assert.equal(listed.drafts[0].id, ROW_ID);
  assert.equal(listed.drafts[0].title, '在雨里走了一段路');
  assert.deepEqual(listed.drafts[0].tags, []);
  assert.equal(listed.drafts[0].edit, null);
  assert.equal(listed.drafts[0].source, 'drafts', '前端要靠它跳过自动排版');
});

test('重复发送相同内容：不新建、不改动，返回 unchanged', async () => {
  const db = await freshDb();
  const first = await (await handleDraftsImport(importRequest(payload()), envWith(db))).json();
  const before = rowOf(db, ROW_ID);

  const second = await handleDraftsImport(importRequest(payload()), envWith(db));
  const data = await second.json();

  assert.equal(second.status, 200);
  assert.equal(data.status, 'unchanged');
  assert.equal(data.updatedAt, before.updated_at, '不该顺手把更新时间顶掉');

  const after = rowOf(db, ROW_ID);
  assert.equal(after.title, before.title);
  assert.equal(after.body, before.body);
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(first.status, 'created');
  assert.equal(countRows(db), 1, '永远只有一行');
});

test('Drafts 改了正文、Beta 没动：跟着更新，标签与 slug 不丢', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));

  // 模拟 Beta 里配过标签和 slug（这两样 Drafts 不管，也不能被冲掉）
  db.exec(`UPDATE write_drafts SET tags = '["随笔"]', slug = 'rain' WHERE id = '${ROW_ID}'`);

  const res = await handleDraftsImport(
    importRequest(payload({ title: '在雨里走了一段路（改）', body: '整段重写过。\n\n新的一段。' })),
    envWith(db)
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.status, 'updated');

  const row = rowOf(db, ROW_ID);
  assert.equal(row.title, '在雨里走了一段路（改）');
  assert.equal(row.body, '整段重写过。\n\n新的一段。');
  assert.equal(row.tags, '["随笔"]');
  assert.equal(row.slug, 'rain');
});

/* ------------------------------ 冲突判断顺序 ------------------------------ */

test('Beta 改过、Drafts 没变：409，不能返回 unchanged（顺序回归）', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));

  // Beta 编辑过（内容指纹变了），Drafts 那边一个字都没有改
  db.exec(`UPDATE write_drafts SET body = body || '\n\nBeta 里补的一段。' WHERE id = '${ROW_ID}'`);
  const betaBody = rowOf(db, ROW_ID).body;

  const res = await handleDraftsImport(importRequest(payload()), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 409, 'Drafts 没变也必须报冲突，不能因为「内容一样」就说成功');
  assert.equal(data.error.code, 'draft_conflict');
  assert.equal(data.conflict.reason, 'beta_modified');
  assert.match(data.error.message, /什么都没写/);
  assert.match(data.conflict.hint, /不用重发/);
  assert.equal(rowOf(db, ROW_ID).body, betaBody, 'Beta 的内容一个字符都不能动');
});

test('Beta 改过、Drafts 也改过：409，两边都留着', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));
  db.exec(`UPDATE write_drafts SET body = body || '\n\nBeta 里补的一段。' WHERE id = '${ROW_ID}'`);
  const betaBody = rowOf(db, ROW_ID).body;

  const res = await handleDraftsImport(importRequest(payload({ body: 'Drafts 里改的版本。' })), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.error.code, 'draft_conflict');
  assert.equal(data.conflict.reason, 'both_modified');
  assert.equal(data.conflict.beta.title, '在雨里走了一段路');
  assert.ok(data.conflict.beta.excerpt.includes('Beta 里补的一段'));
  assert.equal(rowOf(db, ROW_ID).body, betaBody);
});

test('冲突判断只看内容：时间戳怎么乱都不影响', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));

  // 把行时间倒回 1970，Beta 其实没改过 → 应该照常更新
  db.exec(`UPDATE write_drafts SET updated_at = 1, source_at = 9999999999999 WHERE id = '${ROW_ID}'`);
  const ok = await handleDraftsImport(importRequest(payload({ body: '换了一版。' })), envWith(db));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'updated');

  // 反过来：时间设成未来，但内容被改过 → 依然按冲突处理
  await handleDraftsImport(importRequest(payload({ body: '再换一版。' })), envWith(db));
  db.exec(`UPDATE write_drafts SET body = 'Beta 手改', updated_at = 8888888888888 WHERE id = '${ROW_ID}'`);
  const conflict = await handleDraftsImport(importRequest(payload({ body: '第三版。' })), envWith(db));
  assert.equal(conflict.status, 409);
});

test('Beta 删除过：409，不复活、不重建', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));

  // 把导入时间往回拨，删除的墓碑才一定「更新」（同一毫秒内两个 now 会打平）
  db.exec(`UPDATE write_drafts SET updated_at = 1000 WHERE id = '${ROW_ID}'`);

  // 走 Beta 自己的删除通道（软删墓碑），别手写 SQL，确保形状一致
  await handleWriteDraftsSave(saveRequest([tombstone(Date.now())]), envWith(db));
  assert.ok(rowOf(db, ROW_ID).deleted_at > 0);

  const res = await handleDraftsImport(importRequest(payload()), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.error.code, 'draft_deleted');
  assert.ok(rowOf(db, ROW_ID).deleted_at > 0, '墓碑要留着，否则下次发送又会建一篇');

  const listed = await (await handleWriteDraftsGet(envWith(db), new URL('https://x/api/write/drafts'))).json();
  assert.equal(listed.drafts.length, 0, '不该在草稿列表里复活');
});

test('已经发布过：409，不动原稿也不新建', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));
  db.exec(
    `UPDATE write_drafts SET published_at = ${Date.now()},
       edit_path = 'content/posts/2026-11-20 在雨里走了一段路.md' WHERE id = '${ROW_ID}'`
  );

  const res = await handleDraftsImport(importRequest(payload({ body: '发布之后又改了。' })), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.error.code, 'draft_published');
  assert.equal(rowOf(db, ROW_ID).body, payload().body);
  assert.equal(countRows(db), 1);
});

/* --------------------------------- 指纹 ---------------------------------- */

test('内容指纹用 JSON 数组编码：标题带换行也不会和正文串味', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload({ title: 'a', body: 'b\nc' })), envWith(db));

  // Beta 侧把这篇改成 title="a\nb"、body="c"。
  // 若指纹是简单的「标题 + \n + 正文」拼接，两者都哈希 "a\nb\nc"，这里会误判成 unchanged。
  db.exec(`UPDATE write_drafts SET title = 'a' || char(10) || 'b', body = 'c' WHERE id = '${ROW_ID}'`);

  const res = await handleDraftsImport(importRequest(payload({ title: 'a', body: 'b\nc' })), envWith(db));
  assert.equal(res.status, 409, '拼接式指纹会在这里漏判，必须报冲突');
  assert.equal((await res.json()).error.code, 'draft_conflict');
});

test('换行符归一：CRLF 与 LF 视为同一份内容', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload({ body: '第一行\r\n\r\n第二行' })), envWith(db));
  assert.equal(rowOf(db, ROW_ID).body, '第一行\n\n第二行', '正文只统一换行符');

  const again = await handleDraftsImport(importRequest(payload({ body: '第一行\n\n第二行' })), envWith(db));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).status, 'unchanged');
});

test('正文不做任何排版：缩进、空行、尾部空白都留着', async () => {
  const db = await freshDb();
  const body = '  缩进的一行\n\n\n\n多个空行\n\n```\ncode\n```   ';
  await handleDraftsImport(importRequest(payload({ body })), envWith(db));
  assert.equal(rowOf(db, ROW_ID).body, body);
});

/* --------------------------------- 并发 ---------------------------------- */

test('并发首次创建：只建一篇，没有 500', async () => {
  const db = await freshDb();
  const gated = barrierDb(db, 2);

  const [a, b] = await Promise.all([
    handleDraftsImport(importRequest(payload()), envWith(gated)),
    handleDraftsImport(importRequest(payload()), envWith(gated)),
  ]);

  assert.deepEqual([a.status, b.status].sort(), [200, 201], '一个建、一个落成 unchanged');
  assert.equal(countRows(db), 1, '不能出现两行');

  const bodies = await Promise.all([a.json(), b.json()]);
  assert.ok(bodies.every((row) => row.ok));
});

test('并发发送两个不同版本：只有先到的写进去，后到的不覆盖', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload({ body: 'v1' })), envWith(db));

  const gated = barrierDb(db, 2);
  const [a, b] = await Promise.all([
    handleDraftsImport(importRequest(payload({ body: 'v2' })), envWith(gated)),
    handleDraftsImport(importRequest(payload({ body: 'v3' })), envWith(gated)),
  ]);

  // 两个都读到 v1；只有一个的条件写能命中，另一个重读之后如实报「刚被写入，请重发」
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(countRows(db), 1);

  const row = rowOf(db, ROW_ID);
  const winner = a.status === 200 ? 'v2' : 'v3';
  assert.equal(row.body, winner, '落库的必须正好是写成功的那一份，不能混');
  assert.ok(['v2', 'v3'].includes(row.body), '最终内容必须是两次提交之一，不能是半截');

  const loser = a.status === 409 ? await a.json() : await b.json();
  assert.equal(loser.error.code, 'concurrent_update');

  // 自洽：把最终内容原样再发一次，应该 unchanged（说明 source_hash 与内容对得上）
  const settle = await handleDraftsImport(importRequest(payload({ body: row.body })), envWith(db));
  assert.equal(settle.status, 200);
  assert.equal((await settle.json()).status, 'unchanged');
});

test('读到之后有人在 Beta 删了：不写回去，返回 draft_deleted', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));
  db.exec(`UPDATE write_drafts SET updated_at = 1000 WHERE id = '${ROW_ID}'`);

  // 导入读到「未删除」的旧状态之后，Beta 这边把草稿删了 —— 最典型的读写间隙
  const racing = afterReadDb(db, async () => {
    await handleWriteDraftsSave(saveRequest([tombstone(Date.now())]), envWith(db));
  });

  const res = await handleDraftsImport(importRequest(payload({ body: 'Drafts 的新版本' })), envWith(racing));

  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'draft_deleted');

  const row = rowOf(db, ROW_ID);
  assert.ok(row.deleted_at > 0, '墓碑不能被导入冲掉');
  assert.equal(row.body, '', '墓碑写回时正文已被清空，导入的内容没落地');
});

/* --------------------------------- 限流 ---------------------------------- */

test('限流：一分钟内超过 30 次 → 429，带 Retry-After', async () => {
  const db = await freshDb();
  const env = envWith(db);

  for (let i = 0; i < 30; i += 1) {
    const res = await handleDraftsImport(importRequest(payload({ body: `第 ${i} 版` })), env);
    assert.notEqual(res.status, 429, `第 ${i + 1} 次不该被限流`);
  }

  const blocked = await handleDraftsImport(importRequest(payload({ body: '第 31 版' })), env);
  const data = await blocked.json();
  assert.equal(blocked.status, 429);
  assert.equal(data.error.code, 'rate_limited');
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
  assert.equal(rowOf(db, ROW_ID).body, '第 29 版', '被限流的那次不能写库');
});

test('限流：短时间写入量超 100 万字符 → 429', async () => {
  const db = await freshDb();
  const env = envWith(db);
  const big = 'x'.repeat(100000);

  let blocked = null;
  for (let i = 0; i < 12 && !blocked; i += 1) {
    const res = await handleDraftsImport(importRequest(payload({ body: big })), env);
    if (res.status === 429) blocked = res;
  }

  assert.ok(blocked, '写到 100 万字符之后要拦住');
  assert.equal((await blocked.json()).error.code, 'rate_limited');
});

/* ---------------------------------- 校验 --------------------------------- */

test('鉴权：令牌缺失、写错、没配置都不放行', async () => {
  const db = await freshDb();

  const missing = await handleDraftsImport(importRequest(payload(), ''), envWith(db));
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error.code, 'unauthorized');

  const wrong = await handleDraftsImport(importRequest(payload(), 'not-the-token'), envWith(db));
  assert.equal(wrong.status, 401);

  // 只配了后台口令、没配集成令牌 → 503，而不是把后台口令当集成令牌用
  const noSecret = await handleDraftsImport(importRequest(payload()), { DB: db, COMMENTS_ADMIN_TOKEN: TOKEN });
  assert.equal(noSecret.status, 503);
  assert.equal((await noSecret.json()).error.code, 'integration_not_configured');

  assert.equal(countRows(db), 0, '鉴权失败不能落库');
});

test('参数校验：source / sourceId / 标题 / JSON 各自给出明确的错误码', async () => {
  const db = await freshDb();
  const env = envWith(db);

  const badSource = await (await handleDraftsImport(importRequest(payload({ source: 'flomo' })), env)).json();
  assert.equal(badSource.error.code, 'bad_source');

  const badId = await (await handleDraftsImport(importRequest(payload({ sourceId: '../../etc' })), env)).json();
  assert.equal(badId.error.code, 'bad_source_id');

  // 严格 UUID：少一段、含非十六进制、随便一串，都要拒
  for (const id of ['F3A1B2C3-4D5E-6F70-8192-A3B4C5D6E7F', 'G3A1B2C3-4D5E-6F70-8192-A3B4C5D6E7F8', 'dr-abc', '']) {
    const got = await (await handleDraftsImport(importRequest(payload({ sourceId: id })), env)).json();
    assert.equal(got.error.code, 'bad_source_id', `应当拒绝 sourceId="${id}"`);
  }

  const noTitle = await (await handleDraftsImport(importRequest(payload({ title: '   ' })), env)).json();
  assert.equal(noTitle.error.code, 'title_required');

  const longTitle = await (await handleDraftsImport(importRequest(payload({ title: '标'.repeat(301) })), env)).json();
  assert.equal(longTitle.error.code, 'title_too_long');

  const broken = await (await handleDraftsImport(importRequest('{not json'), env)).json();
  assert.equal(broken.error.code, 'bad_json');

  assert.equal(countRows(db), 0);
});

test('UUID 两种写法落到同一篇：带连字符与不带连字符是同一个人', async () => {
  const db = await freshDb();
  const plain = UUID.replace(/-/g, '');

  const first = await (await handleDraftsImport(importRequest(payload({ sourceId: UUID, body: '一版' })), envWith(db))).json();
  const second = await handleDraftsImport(importRequest(payload({ sourceId: plain, body: '一版' })), envWith(db));

  assert.equal(first.status, 'created');
  assert.equal(second.status, 200);
  assert.equal((await second.json()).status, 'unchanged');
  assert.equal(countRows(db), 1);
});

test('超长正文：413，别拿半篇去凑数', async () => {
  const db = await freshDb();
  const res = await handleDraftsImport(importRequest(payload({ body: 'x'.repeat(200001) })), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 413);
  assert.equal(data.error.code, 'body_too_large');
  assert.equal(countRows(db), 0);
});

/* --------------------------------- 兼容性 -------------------------------- */

test('中文、Markdown、特殊字符、多段落原样往返', async () => {
  const db = await freshDb();
  const body = [
    '“引号”、‘单引号’、emoji 🌧️、反斜杠 \\、竖线 |、尖括号 <b>、&amp;',
    '',
    '1. 第一条',
    '2. 第二条',
    '',
    '```js',
    'const a = 1; // 代码块',
    '```',
    '',
    '> 引用',
    '',
    '- [ ] 待办',
  ].join('\n');

  await handleDraftsImport(importRequest(payload({ title: '标题：带冒号 #和井号', body })), envWith(db));
  const listed = await (await handleWriteDraftsGet(envWith(db), new URL('https://x/api/write/drafts'))).json();

  assert.equal(listed.drafts[0].title, '标题：带冒号 #和井号');
  assert.equal(listed.drafts[0].body, body);
});

test('Beta 自己的同步不会抹掉来源标记，也不会把导入的草稿当成新稿重复建', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));
  const imported = rowOf(db, ROW_ID);

  // Beta 端把这篇原样推回来（拉取后发现本地更新时间更晚时会这样），带上新时间戳
  const save = await handleWriteDraftsSave(
    saveRequest([
      {
        id: ROW_ID,
        title: imported.title,
        body: imported.body,
        tags: [],
        slug: '',
        edit: null,
        createdAt: imported.created_at,
        updatedAt: imported.updated_at + 1000,
      },
    ]),
    envWith(db)
  );
  assert.equal((await save.json()).saved, 1);

  const after = rowOf(db, ROW_ID);
  assert.equal(after.source, 'drafts', 'source 不能被普通草稿上行冲成空');
  assert.equal(after.source_id, UUID.toLowerCase());
  assert.equal(after.source_hash, imported.source_hash);

  // 内容没变 → 依然是 unchanged
  const again = await (await handleDraftsImport(importRequest(payload()), envWith(db))).json();
  assert.equal(again.status, 'unchanged');
});

test('Beta 里改过之后再让 Drafts 发：判得出冲突', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));
  // 把导入时间往回拨，Beta 这次的修改才一定被判为更新
  db.exec(`UPDATE write_drafts SET updated_at = 1000 WHERE id = '${ROW_ID}'`);

  await handleWriteDraftsSave(
    saveRequest([
      { id: ROW_ID, title: 'Beta 改的标题', body: 'Beta 改的正文', tags: [], createdAt: 1, updatedAt: Date.now() },
    ]),
    envWith(db)
  );

  const res = await handleDraftsImport(importRequest(payload({ body: 'Drafts 又改了一版' })), envWith(db));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'draft_conflict');
  assert.equal(rowOf(db, ROW_ID).body, 'Beta 改的正文');
});

/* --------------------------------- 迁移 ---------------------------------- */

/**
 * 线上那张 write_drafts 早就存在了，CREATE TABLE IF NOT EXISTS 不会给它补列。
 * 所以必须走 MIGRATIONS 的 ALTER，且不能把老草稿弄丢。
 * 这里手工造一个「旧形状」的库（version=5），再让 ensureSchema 去升。
 */
test('老库升级：补齐 source 四列与限流表，已有草稿一条不少', async () => {
  const db = createD1();
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`CREATE TABLE write_drafts (
     id           TEXT PRIMARY KEY,
     title        TEXT    NOT NULL DEFAULT '',
     body         TEXT    NOT NULL DEFAULT '',
     tags         TEXT    NOT NULL DEFAULT '[]',
     slug         TEXT    NOT NULL DEFAULT '',
     edit_path    TEXT,
     edit_name    TEXT,
     edit_url     TEXT,
     published_at INTEGER NOT NULL DEFAULT 0,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL,
     deleted_at   INTEGER NOT NULL DEFAULT 0
   )`);
  db.exec(`INSERT INTO settings (key, value) VALUES ('schema:version', '5')`);
  db.exec(`INSERT INTO write_drafts (id, title, body, tags, slug, created_at, updated_at)
           VALUES ('dold1234', '旧草稿', '旧正文', '["随笔"]', 'old', 1, 2)`);

  // 换一个模块实例：ensureSchema 的「已建表」缓存是按 isolate 记的
  const fresh = await import('../worker/src/db.js?migrate=old');
  await fresh.ensureSchema({ DB: db });

  const cols = db._db.prepare('PRAGMA table_info(write_drafts)').all().map((c) => c.name);
  for (const name of ['source', 'source_id', 'source_hash', 'source_at']) {
    assert.ok(cols.includes(name), `缺列 ${name}`);
  }

  const row = db._db.prepare("SELECT * FROM write_drafts WHERE id = 'dold1234'").get();
  assert.equal(row.title, '旧草稿');
  assert.equal(row.body, '旧正文');
  assert.equal(row.tags, '["随笔"]');
  assert.equal(row.slug, 'old');
  assert.equal(row.source, '', '老草稿默认没有来源');
  assert.equal(row.source_at, 0);

  const rateTable = db._db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'integration_rates'")
    .get();
  assert.ok(rateTable, '限流表要一并建出来');

  const version = db._db.prepare("SELECT value FROM settings WHERE key = 'schema:version'").get();
  assert.equal(version.value, '7');
});
