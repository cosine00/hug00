/**
 * 写作页「AI 润色」差异对比的单元测试。
 *
 * 这段逻辑在 index.html 的内联脚本里，没有模块可 import —— 和
 * admin-mobile-regressions.cjs 一样，按源码切片丢进 vm 里跑。
 *
 * 要守住的其实就两条：
 *   1. 对齐不能骗人：原文和润色稿的段落，删的要能还原原文、加的要能还原新稿；
 *   2. 手机不能卡死：段数、字数夸张时要走降级路径，而不是 O(n·m) 一把梭。
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
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from > -1 && to > from, `源码切片失败：${start}`);
  return html.slice(from, to);
}

const source = slice('  function aiParagraphs(', '  function paintAiDiff(');

const context = {
  escapeHtml: (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
};
vm.createContext(context);
vm.runInContext(source, context);

const { aiParagraphs, aiDiffBlocks, aiCharDiff, aiText } = context;

/** vm 里造出来的数组属于另一个 realm，deepEqual 会嫌原型不同，先洗成纯 JSON。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 从 diff 结果里分别还原「原文」和「润色稿」，用来验证对齐没丢内容。 */
function rebuild(blocks) {
  const before = [];
  const after = [];
  for (const block of blocks) {
    if (block.t === 'same') { before.push(block.a); after.push(block.a); }
    else if (block.t === 'del') before.push(block.a);
    else if (block.t === 'ins') after.push(block.b);
    else { before.push(block.a); after.push(block.b); }
  }
  return { before, after };
}

test('按空行切段，行内软换行留在段内', () => {
  assert.deepEqual(plain(aiParagraphs('第一段\n\n第二段')), ['第一段', '第二段']);
  assert.deepEqual(plain(aiParagraphs('第一段\n第二行\n\n第二段')), ['第一段\n第二行', '第二段']);
  assert.deepEqual(plain(aiParagraphs('  前后有空白  \n\n\n\n第二段\n')), ['  前后有空白', '第二段']);
  assert.deepEqual(plain(aiParagraphs('')), []);
});

test('一个字没改：全是 same，没有增删', () => {
  const text = '# 标题\n\n第一段。\n\n- 列表项\n- 第二项';
  const blocks = aiDiffBlocks(text, text);
  assert.ok(blocks.every((block) => block.t === 'same'));
  assert.equal(blocks.length, 3);
});

test('改了一段：落成 mod，其余段落仍然是 same 锚点', () => {
  const oldText = '开头这段。\n\n中间这段写得有点啰嗦了。\n\n结尾这段。';
  const newText = '开头这段。\n\n中间这段更利落。\n\n结尾这段。';
  const blocks = aiDiffBlocks(oldText, newText);

  assert.deepEqual(plain(blocks.map((block) => block.t)), ['same', 'mod', 'same']);
  assert.equal(blocks[1].a, '中间这段写得有点啰嗦了。');
  assert.equal(blocks[1].b, '中间这段更利落。');

  const rebuilt = rebuild(blocks);
  assert.deepEqual(plain(rebuilt.before), plain(aiParagraphs(oldText)));
  assert.deepEqual(plain(rebuilt.after), plain(aiParagraphs(newText)));
});

test('新增与删除段各自归位', () => {
  const oldText = '保留。\n\n要删掉的一段。\n\n保留二。';
  const newText = '保留。\n\n新加的一段。\n\n保留二。';
  const blocks = aiDiffBlocks(oldText, newText);
  const rebuilt = rebuild(blocks);
  assert.deepEqual(plain(rebuilt.before), plain(aiParagraphs(oldText)));
  assert.deepEqual(plain(rebuilt.after), plain(aiParagraphs(newText)));

  // 只删不补
  const onlyDel = aiDiffBlocks('一。\n\n二。\n\n三。', '一。\n\n三。');
  assert.ok(onlyDel.some((block) => block.t === 'del' && block.a === '二。'));

  // 只补不删
  const onlyIns = aiDiffBlocks('一。\n\n三。', '一。\n\n二。\n\n三。');
  assert.ok(onlyIns.some((block) => block.t === 'ins' && block.b === '二。'));
});

test('整篇被重写（段落全不同）也不会丢内容', () => {
  const oldText = '甲段。\n\n乙段。\n\n丙段。';
  const newText = '子段。\n\n丑段。';
  const blocks = aiDiffBlocks(oldText, newText);
  const rebuilt = rebuild(blocks);
  assert.deepEqual(plain(rebuilt.before), plain(aiParagraphs(oldText)));
  assert.deepEqual(plain(rebuilt.after), plain(aiParagraphs(newText)));
});

test('字级 diff：保留的、删掉的、新增的能拼回两边', () => {
  const a = '我今天去了公园散步。';
  const b = '今天去了公园走了一圈。';
  const parts = aiCharDiff(a, b);

  // 按输出顺序拼：'=' 和 '-' 归原文，'=' 和 '+' 归新稿。LCS 的最优解不唯一，
  // 所以只能要求「能拼回去」，不能要求某一种具体对齐。
  const fromA = parts.filter((part) => part.t !== '+').map((part) => part.s).join('');
  const fromB = parts.filter((part) => part.t !== '-').map((part) => part.s).join('');

  assert.equal(fromA, a);
  assert.equal(fromB, b);
});

test('字级 diff：连续同类改动会合并成一个片段', () => {
  const parts = aiCharDiff('abcdef', 'abXYZf');
  assert.deepEqual(plain(parts.map((part) => part.t + part.s)), ['=ab', '-cde', '+XYZ', '=f']);
});

test('空段落不会把字级 diff 算崩', () => {
  assert.deepEqual(plain(aiCharDiff('', '新的')), [{ t: '+', s: '新的' }]);
  assert.deepEqual(plain(aiCharDiff('旧的', '')), [{ t: '-', s: '旧的' }]);
  assert.deepEqual(plain(aiCharDiff('', '')), [{ t: '=', s: '' }]);
});

test('Markdown 标记在 diff 里按普通文字处理，不解析不吞字', () => {
  const oldText = '## 小标题\n\n看这张图 ![图](https://img.hux.ink/a.webp) 和 [链接](https://hux.ink)。';
  const newText = '## 小标题\n\n看这张图 ![图](https://img.hux.ink/a.webp) 以及 [链接](https://hux.ink)。';
  const blocks = aiDiffBlocks(oldText, newText);
  const rebuilt = rebuild(blocks);
  assert.deepEqual(plain(rebuilt.before), plain(aiParagraphs(oldText)));
  assert.deepEqual(plain(rebuilt.after), plain(aiParagraphs(newText)));
  // 标题段落没动，仍然是 same，不该被拆碎
  assert.equal(blocks[0].t, 'same');
});

test('篇幅夸张时走降级路径，不卡住主线程', () => {
  const many = Array.from({ length: 420 }, (_, i) => `第 ${i} 段。`).join('\n\n');
  const manyNew = Array.from({ length: 420 }, (_, i) => (i % 2 ? `第 ${i} 段改写。` : `第 ${i} 段。`)).join('\n\n');
  const started = Date.now();
  const blocks = aiDiffBlocks(many, manyNew);
  const cost = Date.now() - started;

  assert.ok(blocks.length > 0);
  assert.ok(cost < 2000, `对齐耗时 ${cost}ms，降级路径没生效`);
  const rebuilt = rebuild(blocks);
  assert.equal(rebuilt.before.length, 420);
  assert.equal(rebuilt.after.length, 420);
});

test('输出 HTML 前做转义，换行变 <br>', () => {
  assert.equal(aiText('a<b>&c\nd'), 'a&lt;b&gt;&amp;c<br>d');
  assert.equal(aiText(null), '');
});
