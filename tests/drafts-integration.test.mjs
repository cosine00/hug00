/**
 * Drafts → Beta 导入接口回归测试。
 *
 * 这块的关键不是「能不能存进去」，而是「什么时候坚决不存」：
 *   · 同一篇重复发送 → 一行，不重复建；
 *   · Drafts 改了、Beta 没动 → 跟着改；
 *   · Beta 改过 → 409，两边都留着；
 *   · Beta 删了 / 发布了 → 409，不复活、不覆盖线上文章。
 * 判断全靠内容指纹，所以这里刻意把 updated_at 设成各种不合理的值，
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

const ROW_ID = `dr-${UUID.toLowerCase()}`;

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
  assert.equal(row.source_id, UUID);
  assert.ok(row.source_hash, '要落下内容指纹，后面判断冲突全靠它');

  // Beta 端走的是同一条 GET，Drafts 来的草稿必须出现在里面
  const listed = await (await handleWriteDraftsGet(envWith(db), new URL('https://x/api/write/drafts'))).json();
  assert.equal(listed.drafts.length, 1);
  assert.equal(listed.drafts[0].id, ROW_ID);
  assert.equal(listed.drafts[0].title, '在雨里走了一段路');
  assert.deepEqual(listed.drafts[0].tags, []);
  assert.equal(listed.drafts[0].edit, null);
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

  const count = db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n;
  assert.equal(count, 1, '永远只有一行');
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

test('Beta 端改过正文：409 冲突，不覆盖，两边内容都在', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));

  // 模拟在 Beta 编辑器里改了一个字（内容指纹随之对不上）
  db.exec(`UPDATE write_drafts SET body = body || '\n\nBeta 里补的一段。' WHERE id = '${ROW_ID}'`);
  const betaBody = rowOf(db, ROW_ID).body;

  const res = await handleDraftsImport(importRequest(payload({ body: 'Drafts 里改的版本。' })), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 409);
  assert.equal(data.ok, false);
  assert.equal(data.error.code, 'draft_conflict');
  assert.match(data.error.message, /改过/);
  assert.ok(data.conflict, '要把冲突信息带回去，Action 才能说清原因');
  assert.equal(data.conflict.beta.title, '在雨里走了一段路');
  assert.ok(data.conflict.beta.excerpt.includes('Beta 里补的一段'));

  assert.equal(rowOf(db, ROW_ID).body, betaBody, 'Beta 的内容一个字符都不能动');
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
  await handleWriteDraftsSave(
    new Request('https://x/api/write/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drafts: [{ id: ROW_ID, title: '', body: '', tags: [], createdAt: 1, updatedAt: Date.now(), deletedAt: Date.now() }],
      }),
    }),
    envWith(db)
  );
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
  assert.equal(db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n, 1);
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

  assert.equal(db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n, 0, '鉴权失败不能落库');
});

test('参数校验：source / sourceId / 标题 / JSON 各自给出明确的错误码', async () => {
  const db = await freshDb();
  const env = envWith(db);

  const badSource = await (await handleDraftsImport(importRequest(payload({ source: 'flomo' })), env)).json();
  assert.equal(badSource.error.code, 'bad_source');

  const badId = await (await handleDraftsImport(importRequest(payload({ sourceId: '../../etc' })), env)).json();
  assert.equal(badId.error.code, 'bad_source_id');

  const noTitle = await (await handleDraftsImport(importRequest(payload({ title: '   ' })), env)).json();
  assert.equal(noTitle.error.code, 'title_required');

  const longTitle = await (await handleDraftsImport(importRequest(payload({ title: '标'.repeat(301) })), env)).json();
  assert.equal(longTitle.error.code, 'title_too_long');

  const broken = await (await handleDraftsImport(importRequest('{not json'), env)).json();
  assert.equal(broken.error.code, 'bad_json');

  assert.equal(db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n, 0);
});

test('超长正文：413，别拿半篇去凑数', async () => {
  const db = await freshDb();
  const res = await handleDraftsImport(importRequest(payload({ body: 'x'.repeat(200001) })), envWith(db));
  const data = await res.json();

  assert.equal(res.status, 413);
  assert.equal(data.error.code, 'body_too_large');
  assert.equal(db._db.prepare('SELECT COUNT(*) AS n FROM write_drafts').get().n, 0);
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
    new Request('https://x/api/write/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drafts: [
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
        ],
      }),
    }),
    envWith(db)
  );
  assert.equal((await save.json()).saved, 1);

  const after = rowOf(db, ROW_ID);
  assert.equal(after.source, 'drafts', 'source 不能被普通草稿上行冲成空');
  assert.equal(after.source_id, UUID);
  assert.equal(after.source_hash, imported.source_hash);

  // 内容没变 → 依然是 unchanged（这条专门防止「Beta 推回来一次就再也认不出原文」）
  const again = await (await handleDraftsImport(importRequest(payload()), envWith(db))).json();
  assert.equal(again.status, 'unchanged');
});

test('Beta 里改过之后再让 Drafts 发：仍然认得出改过（来源标记跟着一起走）', async () => {
  const db = await freshDb();
  await handleDraftsImport(importRequest(payload()), envWith(db));
  // 同上：把导入时间往回拨，Beta 这次的修改才一定被判为更新
  db.exec(`UPDATE write_drafts SET updated_at = 1000 WHERE id = '${ROW_ID}'`);

  await handleWriteDraftsSave(
    new Request('https://x/api/write/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drafts: [{ id: ROW_ID, title: 'Beta 改的标题', body: 'Beta 改的正文', tags: [], createdAt: 1, updatedAt: Date.now() }],
      }),
    }),
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
test('老库升级：旧表结构补上 source 四列，已有草稿一条不少', async () => {
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

  const version = db._db.prepare("SELECT value FROM settings WHERE key = 'schema:version'").get();
  assert.equal(version.value, '6');
});
