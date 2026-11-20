/**
 * 写作页「键盘弹起后把光标带回视野」的单元测试。
 *
 * 这段逻辑在 index.html 的内联脚本里，没有模块可 import，按源码切片丢进 vm 跑。
 *
 * 要守住的就一条：量的是「光标」，不是「正文元素」。
 * 正文是 contenteditable，它的 rect 等于整篇文章的高度；拿它去比可视区，
 * 任何一次聚焦都会把正文滚到文章末尾——这正是「点一下长文中间、画面跳到
 * 结尾、光标看不见」的成因。
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

const source = slice(
  '  /** 当前光标的矩形。正文走选区，标题/标签这类小输入框用元素自身的框。 */',
  '  function scheduleReveal() {'
);

const rect = (top, bottom) => ({ top, bottom, height: bottom - top, width: 4, left: 0, right: 4 });

/**
 * 造一个「文档流」坐标系：内容位置 contentTop 的东西，屏幕上落在
 * docTop + contentTop - scrollTop。测试里所有数字都按这个来算。
 * docBottom 既是正文区的下沿，也是可视视口的下沿（.app 就是贴着可视视口的）。
 */
function makeContext({ docTop = 106, docBottom = 844, contentTop = 0, height = 22 } = {}) {
  const doc = {
    scrollTop: 0,
    top: docTop,
    bottom: docBottom,
    getBoundingClientRect() { return { top: this.top, bottom: this.bottom }; },
  };
  const onScreen = () => rect(doc.top + contentTop - doc.scrollTop, doc.top + contentTop - doc.scrollTop + height);
  const body = {
    // 整篇文章的框：四千像素高。真按它算，任何一次聚焦都会滚到文章末尾
    getBoundingClientRect: () => rect(docTop, 4100),
    contains: () => true,
  };
  const holder = { nodeType: 1, getBoundingClientRect: onScreen };
  const context = {
    docEl: doc,
    bodyEl: body,
    titleEl: { getBoundingClientRect: onScreen },
    zoomed: () => false,
    tbLockUntil: 0,
    window: {
      innerHeight: docBottom,
      visualViewport: { height: docBottom, offsetTop: 0 },
      getSelection: () => ({
        rangeCount: 1,
        getRangeAt: () => ({
          startContainer: holder,
          getClientRects: () => [onScreen()],
          getBoundingClientRect: onScreen,
        }),
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, doc };
}

test('长文中间聚焦：滚到光标，不滚到文章末尾', () => {
  // 光标在第 4000px，doc 高 844，此时停在顶部
  const { context, doc } = makeContext({ contentTop: 4000 });
  context.revealCaret(context.bodyEl);
  // 底部留 12：844 - 12 = 832；光标底 106 + 4000 + 22 = 4128
  assert.equal(doc.scrollTop, 4128 - 832);
  assert.ok(doc.scrollTop < 3341, '不该一路滚到文章末尾');
});

test('光标本来就看得见：一动不动', () => {
  const { context, doc } = makeContext({ contentTop: 200 });
  doc.scrollTop = 0;
  context.revealCaret(context.bodyEl);
  assert.equal(doc.scrollTop, 0);
});

test('光标在可视区上面：往回滚，且只滚到够为止', () => {
  const { context, doc } = makeContext({ contentTop: 200 });
  doc.scrollTop = 900;
  context.revealCaret(context.bodyEl);
  // 顶部边界 106 + 12 = 118；光标顶 = 106 + 200 - 900 = -594
  assert.equal(doc.scrollTop, 900 - (118 + 594));
});

test('键盘弹起、正文区矮掉一截：光标落到键盘下面时补一次', () => {
  // 可视高度被键盘压到 400：能用的底边是 400 - 12 = 388
  const { context, doc } = makeContext({ docBottom: 400, contentTop: 700 });
  doc.scrollTop = 400;
  context.revealCaret(context.bodyEl);
  // 光标底 = 106 + 700 - 400 + 22 = 428，超出 40
  assert.equal(doc.scrollTop, 440);
});

test('光标在空段落里量不出高度：退到它所在的块，仍然要带进视野', () => {
  const { context, doc } = makeContext({ contentTop: 3000 });
  context.window.getSelection = () => ({
    rangeCount: 1,
    getRangeAt: () => ({
      startContainer: { nodeType: 1, getBoundingClientRect: () => rect(3106, 3136) },
      getClientRects: () => [],
      // 量不出来的矩形是「零宽零高」，不是我的 rect() 造的那种 4px 宽
      getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, width: 0, left: 0, right: 0 }),
    }),
  });
  context.revealCaret(context.bodyEl);
  assert.equal(doc.scrollTop, 3136 - 832);
});

test('标题这类小输入框：用元素自身的框，滚回来看得见就停', () => {
  const { context, doc } = makeContext({ contentTop: 20, height: 48 });
  doc.scrollTop = 800;
  context.revealCaret(context.titleEl);
  // 标题顶 = 106 + 20 - 800 = -674，滚到 118 即可，不用一路滚到顶
  assert.equal(doc.scrollTop, 800 - (118 + 674));
});
