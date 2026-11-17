/**
 * 撰写页后端回归测试（GitHub 侧）。
 *
 * 这块代码有两个高危动作：
 *   1. 改一篇文章时「只覆盖 front matter 里自己的字段」，不能把 PC 上手动加的
 *      feature / description 洗掉，也不能把 date 改成今天；
 *   2. 更新必须带 sha 打到同一个 path，否则会多出一个新文件。
 * 所以这里不开网络，直接拿假的 GitHub 响应把请求体拆开看。
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleWriteDraftsGet, handleWriteDraftsSave, handleWriteImages, handleWritePosts, handleWritePost } from '../worker/src/write.js';

const env = {
  GITHUB_TOKEN: 'unit-test-token',
  WRITE_GITHUB_REPO: 'cosine00/hug00',
  WRITE_GITHUB_BRANCH: 'master',
  WRITE_SITE_ORIGIN: 'https://hux.ink',
};

const realFetch = globalThis.fetch;
const calls = [];

/** 拦截到 GitHub 的请求，按 path 返回预先准备好的响应。 */
function stubFetch(routes) {
  calls.length = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const path = url.replace('https://api.github.com', '');
    const route = routes(path, init);
    if (!route) throw new Error(`没准备好这个请求：${path}`);
    return new Response(JSON.stringify(route.body || {}), {
      status: route.status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function postRequest(payload) {
  return new Request('https://comments.hux.ink/api/write/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function unb64(data) {
  return Buffer.from(String(data).replace(/\s+/g, ''), 'base64').toString('utf8');
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* --------------------------------- 列表 --------------------------------- */

test('最近文章：按时间倒序取前 N 篇，元信息与正文都解析出来', async () => {
  const files = [
    // 文件名顺序故意与 front matter date 相反，防止回退成按文件名取最近文章。
    { type: 'file', name: '2026-12-31 呵护你.md', path: 'content/posts/2026-12-31 呵护你.md', sha: 'sha-c' },
    { type: 'file', name: '2026-01-01 影彩.md', path: 'content/posts/2026-01-01 影彩.md', sha: 'sha-a' },
    { type: 'file', name: '2026-10-01 中间那篇.md', path: 'content/posts/2026-10-01 中间那篇.md', sha: 'sha-b' },
  ];

  const bodies = {
    'sha-a': `---\ntitle: 影彩\nauthor: 落落vici\ndate: "2026-11-14 15:36:00"\ntags:\n  - 人间流浪\n  - 折腾\nslug: vlog\ndraft: false\n---\n\n两个月前败入了大疆。\n`,
    'sha-b': `---\ntitle: 中间那篇\ndate: "2026-10-01 09:00:00"\ntags: []\n---\n\n正文。\n`,
    'sha-c': `---\ntitle: 呵护你\ndate: "2026-09-20 21:00:00"\n---\n\n睡前对话。\n`,
  };

  stubFetch((path) => {
    if (path === 'https://hux.ink/write-index.json') {
      return {
        body: {
          posts: [
            { path: files[0].path, title: '呵护你', date: '2026-09-20 21:00:00' },
            { path: files[2].path, title: '中间那篇', date: '2026-10-01 09:00:00' },
            { path: files[1].path, title: '影彩', date: '2026-11-14 15:36:00' },
          ],
        },
      };
    }
    const match = path.match(/\/contents\/content\/posts\/(.+)\.md\?ref=/);
    if (match) {
      const name = decodeURIComponent(match[1]) + '.md';
      const hit = files.find((f) => f.name === name);
      return { body: { sha: hit.sha, content: b64(bodies[hit.sha]) } };
    }
    return null;
  });

  const response = await handleWritePosts(env, new URL('https://x/api/write/posts?limit=3'));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.total, 3);
  assert.equal(data.order, 'front_matter_date');
  assert.deepEqual(
    data.posts.map((p) => p.title),
    ['影彩', '中间那篇', '呵护你']
  );

  const first = data.posts[0];
  assert.equal(first.slug, 'vlog');
  assert.equal(first.url, '/posts/vlog/');
  assert.deepEqual(first.tags, ['人间流浪', '折腾']);
  assert.equal(first.draft, false);
  assert.match(first.content, /两个月前败入了大疆/);
  assert.ok(first.words > 0);

  // 没有 slug 的用文件名推：日期前缀去掉、"那篇" 前的空格变短横线
  assert.equal(data.posts[1].url, '/posts/中间那篇/');
  assert.deepEqual(data.posts[1].tags, []);
});

test('最近图片：两套历史前缀都扫，按上传时间倒序取最近 N 张', async () => {
  // 早年 admin 页写 image/，后来改成 images/，真实桶里两套并存
  const media = {
    async list({ prefix }) {
      if (prefix.startsWith('image/2026/11/')) {
        return {
          objects: [
            { key: 'image/2026/11/20261023173527-lwvou-old.webp', size: 100, uploaded: new Date('2026-11-01T00:00:00Z'), httpMetadata: { contentType: 'image/webp' } },
          ],
        };
      }
      if (prefix.startsWith('images/2026/11/')) {
        return {
          objects: [
            { key: 'images/2026/11/w20261116000000-b.jpg', size: 200, uploaded: new Date('2026-11-16T00:00:00Z'), httpMetadata: { contentType: 'image/jpeg' } },
            { key: 'images/2026/11/w20261112000000-c.png', size: 300, uploaded: new Date('2026-11-12T00:00:00Z'), httpMetadata: { contentType: 'image/png' } },
          ],
        };
      }
      return { objects: [] };
    },
  };
  const response = await handleWriteImages({ ...env, MEDIA: media, R2_PUBLIC_URL: 'https://img.hux.ink' }, new URL('https://x/api/write/images?limit=3'));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.images.map((image) => image.key), [
    'images/2026/11/w20261116000000-b.jpg',
    'images/2026/11/w20261112000000-c.png',
    'image/2026/11/20261023173527-lwvou-old.webp',
  ]);
  assert.equal(data.images[0].url, 'https://img.hux.ink/images/2026/11/w20261116000000-b.jpg');
});

/* --------------------------------- 更新 --------------------------------- */

const ORIGINAL = `---
title: 影彩
author: 落落vici
date: "2026-11-14 15:36:00"
lastmod: "2026-11-14 15:36:59"
tags:
  - 人间流浪
  - 折腾
slug: vlog
draft: false
feature: /images/cover.jpg
hideInList: true
---

两个月前败入了大疆 Pocket4P。

第二段。
`;

test('更新原文件：只改自己的四个字段，date / feature / 正文结构保持', async () => {
  stubFetch((path, init) => {
    if (init.method === 'PUT') return { body: { content: { sha: 'sha-new' }, commit: { html_url: 'https://github.com/c/1' } } };
    return { body: { sha: 'sha-old', content: b64(ORIGINAL) } };
  });

  const response = await handleWritePost(
    postRequest({
      path: 'content/posts/2026-11-14 影彩.md',
      title: '影彩 v2',
      content: '改过的正文。\n\n第二段。',
      tags: ['折腾'],
      slug: 'vlog',
    }),
    env
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.updated, true);
  assert.equal(data.path, 'content/posts/2026-11-14 影彩.md');

  const put = calls.find((c) => c.method === 'PUT');
  assert.ok(put, '应该发出一次 PUT');
  assert.ok(put.url.endsWith(encodeURIComponent('2026-11-14 影彩.md')), '必须打到原文件路径');

  const payload = JSON.parse(put.body);
  assert.equal(payload.sha, 'sha-old', '更新要带原文件的 sha');
  assert.equal(payload.branch, 'master');

  const written = unb64(payload.content);
  assert.match(written, /^---\ntitle: 影彩 v2\n/);
  assert.match(written, /author: 落落vici/);
  assert.match(written, /date: "2026-11-14 15:36:00"/, 'date 不能变');
  assert.match(written, /feature: \/images\/cover\.jpg/, '自定义字段不能被洗掉');
  assert.match(written, /hideInList: true/);
  assert.match(written, /tags:\n {2}- 折腾\n/);
  assert.doesNotMatch(written, /人间流浪/, '旧标签要被替换');
  assert.match(written, /lastmod: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/);
  assert.match(written, /改过的正文。/);
  assert.ok(written.indexOf('lastmod') > written.indexOf('date'), 'lastmod 跟在 date 后面');
});

test('更新允许 posts 下的安全子目录路径', async () => {
  const nestedPath = 'content/posts/obsidian/2026-11-13 台式机换个了新家.md';
  stubFetch((path, init) => {
    if (path.includes('/contents/content/posts/obsidian/2026-11-13%20%E5%8F%B0%E5%BC%8F%E6%9C%BA%E6%8D%A2%E4%B8%AA%E4%BA%86%E6%96%B0%E5%AE%B6.md')) {
      if ((init.method || 'GET') === 'PUT') return { body: { content: { path: nestedPath, sha: 'sha-next' }, commit: { html_url: 'https://github.com/commit/nested' } } };
      return { body: { sha: 'sha-old', content: b64(ORIGINAL) } };
    }
    return null;
  });
  const response = await handleWritePost(postRequest({ path: nestedPath, title: '新家', content: '更新正文', tags: [] }), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.path, nestedPath);
});

test('更新撞车（409）：重取 sha 再提交一次', async () => {
  let gets = 0;
  stubFetch((path, init) => {
    if (init.method === 'PUT') {
      if (calls.filter((c) => c.method === 'PUT').length === 1) return { status: 409, body: { message: 'sha 不匹配' } };
      return { body: { content: { sha: 'sha-2' } } };
    }
    gets += 1;
    return { body: { sha: `sha-${gets}`, content: b64(ORIGINAL) } };
  });

  const response = await handleWritePost(
    postRequest({ path: 'content/posts/2026-11-14 影彩.md', title: '影彩', content: '正文', tags: [] }),
    env
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(gets, 2, '撞车后要重新读一次文件拿新 sha');
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(JSON.parse(puts[1].body).sha, 'sha-2');
});

test('更新不许写到 content/posts 之外', async () => {
  stubFetch(() => null);
  const response = await handleWritePost(
    postRequest({ path: 'content/posts/../../.github/workflows/x.md', title: 'x', content: 'y' }),
    env
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0, '路径不合法就该在发请求前拦下来');
});

/* --------------------------------- 新建 --------------------------------- */

test('新建：文件名带北京日期，front matter 完整，正文原样落盘', async () => {
  stubFetch((path, init) => {
    assert.ok(init.method === 'PUT');
    return { body: { content: { sha: 'sha-new' }, commit: { html_url: 'https://github.com/c/2' } } };
  });

  const response = await handleWritePost(
    postRequest({
      title: '在雨里走了一段路',
      content: '下班时突然下雨。\n\n路灯把雨点照得很亮。',
      tags: ['人间流浪', '折腾'],
      slug: '',
    }),
    env
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.updated, false);
  assert.match(data.name, /^\d{4}-\d{2}-\d{2} 在雨里走了一段路\.md$/);
  assert.equal(data.liveUrl, '/posts/在雨里走了一段路/');

  const payload = JSON.parse(calls[0].body);
  const written = unb64(payload.content);
  assert.match(written, /^---\ntitle: 在雨里走了一段路\n/);
  assert.match(written, /author: 落落vici/);
  assert.match(written, /tags:\n {2}- 人间流浪\n {2}- 折腾\n/);
  assert.match(written, /draft: false/);
  assert.match(written, /路灯把雨点照得很亮。/);
  assert.doesNotMatch(written, /slug:/, '没填别名就不写 slug 字段');
});

test('标题或正文为空直接拒掉，不打 GitHub', async () => {
  stubFetch(() => null);
  const noTitle = await handleWritePost(postRequest({ title: '  ', content: '正文' }), env);
  const noBody = await handleWritePost(postRequest({ title: '标题', content: '   ' }), env);
  assert.equal(noTitle.status, 400);
  assert.equal(noBody.status, 400);
  assert.equal(calls.length, 0);
});

test('标题里的冒号、引号会被 YAML 引号包住，不会写坏 front matter', async () => {
  stubFetch(() => ({ body: { content: { sha: 's' } } }));
  const response = await handleWritePost(
    postRequest({ title: '读《置身事内》：一点笔记', content: '正文' }),
    env
  );
  assert.equal(response.status, 200);
  const written = unb64(JSON.parse(calls[0].body).content);
  assert.match(written, /title: "读《置身事内》：一点笔记"/);
});

test('日期索引还没构建出来时：降级成文件名排序，并如实标记 order', async () => {
  const entries = [
    { type: 'file', name: '2026-03-01 旧文.md', path: 'content/posts/2026-03-01 旧文.md', sha: 's1' },
    { type: 'file', name: '2026-11-10 新文.md', path: 'content/posts/2026-11-10 新文.md', sha: 's2' },
    { type: 'dir', name: 'obsidian', path: 'content/posts/obsidian' },
  ];

  stubFetch((path) => {
    if (path === 'https://hux.ink/write-index.json') return { status: 404, body: { message: 'Not Found' } };
    if (path.includes('/contents/content/posts?ref=')) return { body: entries };
    const match = path.match(/\/contents\/content\/posts\/(.+)\.md\?ref=/);
    if (match) {
      const name = decodeURIComponent(match[1]) + '.md';
      const hit = entries.find((item) => item.name === name);
      const title = name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}[ -]*/, '');
      return { body: { sha: hit.sha, content: b64(`---\ntitle: ${title}\ndate: "2026-01-01 00:00:00"\n---\n\n正文。\n`) } };
    }
    return null;
  });

  const response = await handleWritePosts(env, new URL('https://x/api/write/posts?limit=2'));
  const data = await response.json();

  assert.equal(response.status, 200, '索引挂了也不该把整个列表打死');
  assert.equal(data.order, 'filename_fallback');
  assert.equal(data.total, 2, '目录项要被过滤掉');
  assert.deepEqual(data.posts.map((p) => p.name), ['2026-11-10 新文.md', '2026-03-01 旧文.md']);
});

/* --------------------------------- 草稿同步 --------------------------------- */

/**
 * 草稿表不在 GitHub 那边，用一张假的 D1 顶住。
 * 只实现两条真 SQL 的语义：按 updated_at 倒序取、以及 upsert 里「旧的别覆盖新的」。
 */
const DRAFT_COLUMNS = [
  'id', 'title', 'body', 'tags', 'slug',
  'edit_path', 'edit_name', 'edit_url',
  'published_at', 'created_at', 'updated_at', 'deleted_at',
];

function fakeDb(seed = []) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));

  const upsert = (args) => {
    const record = {};
    DRAFT_COLUMNS.forEach((column, index) => { record[column] = args[index]; });
    const old = rows.get(record.id);
    if (old && !(record.updated_at > old.updated_at)) return 0;
    rows.set(record.id, record);
    return 1;
  };

  return {
    rows,
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async all() {
          const list = [...rows.values()].filter((row) => (
            /id IN/.test(sql)
              ? stmt.args.includes(row.id)
              : row.updated_at > Number(stmt.args[0] || 0) && row.deleted_at === 0
          ));
          list.sort((a, b) => b.updated_at - a.updated_at);
          return { results: list };
        },
      };
      return stmt;
    },
    async batch(list) {
      return list.map((stmt) => ({ meta: { changes: upsert(stmt.args) } }));
    },
  };
}

const draftEnv = (db) => ({ ...env, DB: db, COMMENTS_AUTO_MIGRATE: '0' });

function draftRequest(drafts) {
  return new Request('https://comments.hux.ink/api/write/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drafts }),
  });
}

test('草稿上行：新草稿入库，edit 对象摊平成三列再拼回来', async () => {
  const db = fakeDb();
  const response = await handleWriteDraftsSave(
    draftRequest([
      {
        id: 'dabc1234',
        title: '在雨里走了一段路',
        body: '路灯把雨点照得很亮。',
        tags: ['人间流浪'],
        slug: 'rain',
        edit: { path: 'content/posts/2026-11-14 影彩.md', name: '2026-11-14 影彩.md', url: '/posts/vlog/' },
        createdAt: 1000,
        updatedAt: 2000,
      },
    ]),
    draftEnv(db)
  );
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.saved, 1);
  assert.equal(data.skipped, 0);

  const list = await handleWriteDraftsGet(draftEnv(db), new URL('https://x/api/write/drafts'));
  const got = (await list.json()).drafts;
  assert.equal(got.length, 1);
  assert.equal(got[0].title, '在雨里走了一段路');
  assert.deepEqual(got[0].tags, ['人间流浪']);
  assert.deepEqual(got[0].edit, { path: 'content/posts/2026-11-14 影彩.md', name: '2026-11-14 影彩.md', url: '/posts/vlog/' });
});

test('草稿上行：本地版本更旧时不覆盖云端，并把云端那份退回去让前端收敛', async () => {
  const db = fakeDb([
    {
      id: 'dabc1234', title: '云端版', body: '云端的正文', tags: '["新"]', slug: '',
      edit_path: null, edit_name: null, edit_url: null,
      published_at: 0, created_at: 1000, updated_at: 5000, deleted_at: 0,
    },
  ]);

  const response = await handleWriteDraftsSave(
    draftRequest([{ id: 'dabc1234', title: '本地旧版', body: '旧正文', tags: [], createdAt: 1000, updatedAt: 3000 }]),
    draftEnv(db)
  );
  const data = await response.json();

  assert.equal(data.saved, 0);
  assert.equal(data.skipped, 1);
  assert.equal(data.drafts.length, 1, '被拒的那条要回传云端版本');
  assert.equal(data.drafts[0].title, '云端版');
  assert.equal(db.rows.get('dabc1234').body, '云端的正文', '云端内容不能被旧版本盖掉');
});

test('草稿上行：删除走软删，列表里不再返回但另一台设备能收到墓碑', async () => {
  const db = fakeDb([
    {
      id: 'dabc1234', title: '要删的', body: '正文', tags: '[]', slug: '',
      edit_path: null, edit_name: null, edit_url: null,
      published_at: 0, created_at: 1000, updated_at: 2000, deleted_at: 0,
    },
  ]);
  const remove = await handleWriteDraftsSave(
    draftRequest([{ id: 'dabc1234', title: '', body: '', tags: [], createdAt: 1000, updatedAt: 9000, deletedAt: 9000 }]),
    draftEnv(db)
  );
  assert.equal((await remove.json()).saved, 1);

  const listed = await (await handleWriteDraftsGet(draftEnv(db), new URL('https://x/api/write/drafts'))).json();
  assert.equal(listed.drafts.length, 0, '墓碑不该出现在正常列表里');

  // 另一台设备手里还是旧版本，推上来会被拒，并且拿回墓碑 → 它据此删本地
  const stale = await handleWriteDraftsSave(
    draftRequest([{ id: 'dabc1234', title: '要删的', body: '正文', tags: [], createdAt: 1000, updatedAt: 2000 }]),
    draftEnv(db)
  );
  const staleData = await stale.json();
  assert.equal(staleData.skipped, 1);
  assert.equal(staleData.drafts[0].deletedAt, 9000, '陈旧设备要拿到墓碑才会删本地');
});

test('草稿上行：畸形 id 与超长正文直接丢弃，不影响同批其它草稿', async () => {
  const db = fakeDb();
  const response = await handleWriteDraftsSave(
    draftRequest([
      { id: '../../etc/passwd', title: '坏', body: 'x', updatedAt: 1 },
      { id: 'dok12345', title: '好的', body: '正常正文', createdAt: 1, updatedAt: 2 },
      { id: 'dlong1234', title: '太长', body: 'x'.repeat(200001), createdAt: 1, updatedAt: 3 },
    ]),
    draftEnv(db)
  );
  const data = await response.json();
  assert.equal(data.saved, 1);
  assert.equal(data.skipped, 0);
  assert.deepEqual([...db.rows.keys()], ['dok12345']);
});

test('草稿列表：since 只取更新的那几条', async () => {
  const db = fakeDb([
    { id: 'dold1234', title: '旧的', body: 'a', tags: '[]', slug: '', edit_path: null, edit_name: null, edit_url: null, published_at: 0, created_at: 1, updated_at: 1000, deleted_at: 0 },
    { id: 'dnew1234', title: '新的', body: 'b', tags: '[]', slug: '', edit_path: null, edit_name: null, edit_url: null, published_at: 0, created_at: 1, updated_at: 9000, deleted_at: 0 },
  ]);
  const data = await (await handleWriteDraftsGet(draftEnv(db), new URL('https://x/api/write/drafts?since=5000'))).json();
  assert.deepEqual(data.drafts.map((draft) => draft.id), ['dnew1234']);
});
