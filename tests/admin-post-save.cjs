const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../static/admin/index.html'), 'utf8');
function extract(start, end) {
  const at = html.indexOf(start);
  assert.ok(at >= 0);
  return html.slice(at, html.indexOf(end, at));
}
const helper = extract('async function commitPostFile(', 'async function deleteFile(');
const save = extract('async function savePost(', 'function handleGlobalKeyboardShortcuts(');
async function run({original = 'content/old.md', target = 'content/new.md', collision = false,
  stale = false, missing = false, failAt = '', integration = false} = {}) {
  const calls = [], files = new Map();
  if (original && !missing) files.set(original, {type: 'file', sha: stale ? 'changed' : 'old'});
  if (collision) files.set(target, {type: 'file', sha: 'other'});
  let cleared = false, backup = false, navigated = false, tree;
  const post = {isNew: !original, originalPath: original, path: original, sha: 'old', draftKey: original || '__new__'};
  const context = {
    CFG: {branch: 'feature/writing'}, STATE: {editingPost: post, dirty: true},
    ghFetch: async (url, options = {}) => {
      calls.push({url, ...options});
      if (url === failAt) throw Object.assign(new Error('failed'), {status: 409});
      if (url.startsWith('/contents/')) {
        assert.equal(url.split('?ref=')[1], 'head', 'checks must read the same immutable snapshot');
        const file = files.get(decodeURIComponent(url.slice('/contents/'.length).split('?')[0]));
        if (!file) throw Object.assign(new Error('missing'), {status: 404});
        return file;
      }
      if (url === '/git/ref/heads/feature/writing') return {object: {sha: 'head'}};
      if (url === '/git/commits/head') return {tree: {sha: 'base'}};
      const body = JSON.parse(options.body);
      if (url === '/git/blobs') { assert.equal(body.content, '中文正文'); return {sha: 'blob'}; }
      if (url === '/git/trees') { assert.equal(body.base_tree, 'base'); tree = body.tree; return {sha: 'tree'}; }
      if (url === '/git/commits') { assert.deepEqual(body.parents, ['head']); return {sha: 'next'}; }
      if (url === '/git/refs/heads/feature/writing') {
        assert.deepEqual(body, {sha: 'next', force: false});
        for (const entry of tree) entry.sha === null ? files.delete(entry.path) : files.set(entry.path, {sha: entry.sha});
        return {};
      }
      throw new Error(`Unexpected call: ${url}`);
    },
    setPostSaveBusy() {}, collectEditorData: () => ({path: target, fm: {title: '标题'}, body: '正文'}),
    getPostDraftId: () => post.draftKey,
    saveLocalDraft: () => { backup = true; post.path = target; },
    buildFrontMatter: () => '中文正文', appendArticleHeart: x => x,
    clearLocalDraft: () => { cleared = true; }, toast() {}, showPage: () => { navigated = true; },
  };
  vm.createContext(context); vm.runInContext(helper + '\n' + save, context);
  let error;
  try {
    if (integration) await context.savePost('publish');
    else await context.commitPostFile(target, '中文正文', post, 'save');
  } catch (e) { error = e; }
  return {files, calls, error, cleared, backup, navigated, post};
}
(async () => {
  let result = await run({integration: true});
  assert.equal(result.files.has('content/old.md'), false);
  assert.equal(result.files.get('content/new.md').sha, 'blob');
  assert.equal(result.post.originalPath, 'content/new.md');
  assert.equal(result.post.draftKey, 'content/new.md');
  assert.ok(result.backup && result.cleared && result.navigated);
  assert.equal(result.calls.filter(x => x.method === 'PATCH').length, 1);
  for (const options of [{target: 'content/old.md'}, {original: null}]) {
    result = await run(options); assert.equal(result.error, undefined);
    assert.equal(result.files.size, 1);
  }
  for (const options of [{collision: true}, {original: null, collision: true}, {stale: true}, {missing: true}]) {
    result = await run(options); assert.ok(result.error);
    assert.ok(result.calls.every(x => !x.method), 'validation failure must not write');
  }
  for (const failAt of ['/git/blobs', '/git/trees', '/git/commits', '/git/refs/heads/feature/writing']) {
    result = await run({failAt, integration: true});
    assert.ok(result.files.has('content/old.md'));
    assert.equal(result.files.has('content/new.md'), false);
    assert.ok(result.backup && !result.cleared && !result.navigated);
    assert.equal(result.post.originalPath, 'content/old.md');
  }
  console.log('Post save: rename, update, create, collision, stale source, missing source, and failure preservation passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
