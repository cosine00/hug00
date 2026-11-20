/**
 * Beta 前端「空白草稿不落盘」这一段的回归。
 *
 * 起因：新建一篇后一个字都没写，切个后台或点回列表就会 flushSave → persist 把空稿写进
 * localStorage，再被同步推上云端。用久了草稿列表里一堆「无标题草稿」。
 *
 * 做法是给新开的稿子打 pristine 标记：只要还在 pristine 且没有内容，就不落盘、不标脏、
 * 不上行、不进列表。用户敲过任何一个字（哪怕后来删了），pristine 就变 false，之后照常保存。
 *
 * 这里两件事：
 *   1. 拎出 blankDraft / isPristineBlank 真跑一遍，钉住四种边界的判断；
 *   2. 盯住四处调用点，任何一处被删掉都会让空稿重新漏出去。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../static/beta/index.html'), 'utf8');

function slice(start, end) {
  const at = html.indexOf(start);
  assert.ok(at >= 0, `找不到：${start}`);
  const to = html.indexOf(end, at);
  assert.ok(to > at, `找不到结尾：${end}`);
  return html.slice(at, to);
}

const hasContentFn = slice('function hasContent(', '/** 把界面上的输入写回草稿对象');
const blankFns = slice('function blankDraft()', 'function migrateLegacy()');

const sandbox = { Date, Math, String, Boolean };
vm.createContext(sandbox);
vm.runInContext(
  `${hasContentFn}\n${blankFns}\nthis.blankDraft = blankDraft; this.isPristineBlank = isPristineBlank;`,
  sandbox
);
const { blankDraft, isPristineBlank } = sandbox;

test('新开的稿子是 pristine，算「还没动过」', () => {
  const draft = blankDraft();
  assert.equal(draft.pristine, true);
  assert.equal(isPristineBlank(draft), true);
});

test('写过一个字就不再算 pristine（标题或正文都行）', () => {
  const withTitle = blankDraft();
  withTitle.title = '标题';
  assert.equal(isPristineBlank(withTitle), false);

  const withBody = blankDraft();
  withBody.body = '正文';
  assert.equal(isPristineBlank(withBody), false);

  // 只有标签或 slug 也算动过
  const withSlug = blankDraft();
  withSlug.slug = 'hello';
  assert.equal(isPristineBlank(withSlug), false);
});

test('写了又全删：pristine 已是 false，空内容照常保存（那是用户的选择）', () => {
  const draft = blankDraft();
  draft.title = '先写一句';
  draft.pristine = false; // capture() 在第一次有内容时就会置 false
  draft.title = '';
  draft.body = '';
  assert.equal(isPristineBlank(draft), false);
});

test('老数据没有 pristine 字段：一律当成动过，不能替人删稿', () => {
  const legacy = { id: 'dold', title: '', body: '', tags: [], slug: '', edit: null, publishedAt: 0 };
  assert.equal(legacy.pristine, undefined);
  assert.equal(isPristineBlank(legacy), false);
});

test('四处出口都挡住了：保存、落盘、上行、列表', () => {
  // 1) flushSave：空稿直接返回，不 persist、不 markDirty
  assert.match(
    slice('function flushSave(', 'function renderMetaSummary('),
    /if \(isPristineBlank\(draft\)\) \{ setSaveState\('新草稿', ''\); return; \}/,
    'flushSave 没拦住空稿，切后台就会把它存下来'
  );

  // 2) persist：写盘前过滤
  assert.match(
    slice('function persist(', 'function activeDraft('),
    /store\.drafts\.filter\(function \(draft\) \{ return !isPristineBlank\(draft\); \}\)/,
    'persist 没过滤空稿，localStorage 里会攒空白草稿'
  );

  // 3) pendingPayload：别推上云端
  assert.match(
    slice('function pendingPayload(', 'function chunkPayload('),
    /if \(isPristineBlank\(store\.drafts\[i\]\)\) \{ delete dirty\[id\]; return; \}/,
    '上行没拦住空稿，云端会多出空白草稿'
  );

  // 4) 草稿列表：不显示「无标题草稿」
  assert.match(
    slice('function renderDraftList(', 'var current = paneClosed'),
    /\.filter\(function \(draft\) \{ return !isPristineBlank\(draft\); \}\)/,
    '列表没过滤空稿，用户会看到一堆无标题'
  );
});

test('新建时复用已有的白纸，不会一次堆一篇', () => {
  const body = slice('function startNewDraft(', 'function removeDraft(');
  assert.match(body, /if \(isPristineBlank\(store\.drafts\[i\]\)\) \{ draft = store\.drafts\[i\]; break; \}/);
  assert.match(body, /if \(!draft\) \{\s*draft = blankDraft\(\);\s*store\.drafts\.unshift\(draft\);/);
});
