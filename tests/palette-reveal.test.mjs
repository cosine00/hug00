/**
 * 换色调的圆形过渡：点阴阳按钮，新配色从按钮那儿涨开盖住整屏。
 *
 * 钉住的是「加动画不能把功能加坏」：
 *   1. 不支持 View Transitions、或者在「减少动态效果」下，必须直接换色，不能什么都不发生；
 *   2. 圆的半径要够大，四个角都得盖住，否则边角会残留旧配色；
 *   3. 默认那条交叉淡入淡出必须关掉，不然两套配色会在中段混成半透明；
 *   4. 动画只挂在 ::view-transition-new(root) 上，旧画面原地不动。
 *
 * 半径那个函数从 palette-switcher.js 抽出来跑，不在这里抄第二份实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const JS = fs.readFileSync(path.join(ROOT, 'static', 'js', 'palette-switcher.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'static', 'css', 'palettes.css'), 'utf8');
const HEADER = fs.readFileSync(path.join(ROOT, 'layouts', 'partials', 'header.html'), 'utf8');

/** 把某个函数原样切出来（按大括号配对，避免被内部的花括号骗到） */
function grab(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start > -1, '找不到 function ' + name);
  let index = source.indexOf('{', start);
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) { index += 1; break; }
    }
  }
  return source.slice(start, index);
}

const coverRadius = new Function(
  'window',
  grab(JS, 'coverRadius') + '\nreturn coverRadius;'
)({ innerWidth: 1280, innerHeight: 800 });

test('圆的半径盖得住四个角，最远的那个角正好卡在边上', () => {
  const corners = [[0, 0], [1280, 0], [0, 800], [1280, 800]];
  [[0, 0], [300, 480], [640, 400], [1279, 799]].forEach(([x, y]) => {
    const radius = coverRadius(x, y);
    corners.forEach(([cx, cy]) => {
      const distance = Math.hypot(cx - x, cy - y);
      assert.ok(radius >= distance - 0.001, `圆心 (${x},${y}) 时角 (${cx},${cy}) 没盖住`);
    });
  });
});

test('按钮在左上角时半径就是对角线，不会只用一个方向的距离', () => {
  assert.equal(Math.round(coverRadius(0, 0)), Math.round(Math.hypot(1280, 800)));
});

test('有 View Transitions 才做动画，否则直接换', () => {
  assert.match(JS, /if \(!document\.startViewTransition \|\| calmQuery\.matches \|\| revealing\) \{/);
  assert.match(JS, /apply\(\);\s*\n\s*return;/);
});

test('「减少动态效果」下不硬做动画', () => {
  assert.match(JS, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
});

test('动画挂在 ::view-transition-new(root)，时长和缓动都写明', () => {
  assert.match(JS, /pseudoElement: '::view-transition-new\(root\)'/);
  assert.match(JS, /duration: 520/);
  assert.match(JS, /easing: 'cubic-bezier\(\.65, 0, \.35, 1\)'/);
  assert.match(JS, /circle\(0px at ' \+ x \+ 'px ' \+ y \+ 'px\)/);
});

test('连点时不会卡在「正在过渡」状态里', () => {
  assert.match(JS, /transition\.finished\.finally\(function \(\) \{ revealing = false; \}\)/);
});

test('默认的交叉淡入淡出被关掉，新旧两层按 z-index 叠', () => {
  assert.match(CSS, /::view-transition-old\(root\),\s*\n::view-transition-new\(root\) \{\s*\n\s*animation: none;\s*\n\s*mix-blend-mode: normal;/);
  assert.match(CSS, /::view-transition-old\(root\) \{ z-index: 1; \}/);
  assert.match(CSS, /::view-transition-new\(root\) \{ z-index: 2; \}/);
});

test('改过的 CSS/JS 都推了版本号，线上不会吃缓存', () => {
  assert.match(HEADER, /palettes\.css\?v=20261125-1/);
  assert.match(HEADER, /palette-switcher\.js\?v=20261125-1/);
});
