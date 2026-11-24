/**
 * Beta 写作页的「界面与正文字体」选择。
 *
 * 起因：博客站那边点诗句能在几种中文字体间轮换（朱雀仿宋 / 霞鹜新晰黑 /
 * 霞鹜文楷 / 新致宋），写稿页却一直是系统黑体 —— 写字时的字形跟发出去的不一样，
 * 调行距、看断句都只能靠想象。这里把同一套选项搬进设置抽屉，并共用
 * localStorage['blog-font']：两边任一处换了，另一处接着用。
 *
 * 钉住的五件事：
 *   1. 选项的 id 必须与 BLOG_FONT_CSS 的键一一对应（写错一个就是死按钮）；
 *   2. 字体栈与博客 palettes.css 一致，否则「所见即所得」名存实亡；
 *   3. 只挂一个 <link>，换字体改 href 而不是再插一个；选「系统」则把 link 摘掉；
 *   4. 选择的落点是 blog-font，不是另起一个键；
 *   5. 字体落在 body 上（全局覆盖界面与正文），不是只给三处输入框。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../static/beta/index.html'), 'utf8');
const palettes = fs.readFileSync(path.join(here, '../static/css/palettes.css'), 'utf8');

/** BLOG_FONT_CSS 里的键（system 的地址是空串，不能只匹配 http）。 */
function fontKeys() {
  const at = html.indexOf('var BLOG_FONT_CSS = {');
  assert.ok(at >= 0, '找不到 BLOG_FONT_CSS');
  const block = html.slice(at, html.indexOf('};', at));
  return [...block.matchAll(/(\w+)\s*:\s*'/g)].map((m) => m[1]).sort();
}

/** 设置抽屉里那排按钮的 data-font。 */
function buttonFonts() {
  const at = html.indexOf('id="fontPick"');
  assert.ok(at >= 0, '找不到 #fontPick');
  const block = html.slice(at, html.indexOf('</div>', at));
  return [...block.matchAll(/data-font="(\w+)"/g)].map((m) => m[1]).sort();
}

test('五个字体按钮与 BLOG_FONT_CSS 的键完全对应', () => {
  const keys = fontKeys();
  assert.deepEqual(keys, ['system', 'wenkai', 'xixihei', 'zhisong', 'zhuque']);
  assert.deepEqual(buttonFonts(), keys, '按钮的 data-font 和样式表键对不上，会有点不动的按钮');
});

test('「系统字体」不指向任何 CDN，选中它不该下载字体', () => {
  const at = html.indexOf('var BLOG_FONT_CSS = {');
  const block = html.slice(at, html.indexOf('};', at));
  assert.match(block, /system:\s*''/, 'system 的地址要留空');
});

test('每种字体都有一套 --write-font 规则，字体栈与博客站一致', () => {
  // 只比「有哪些字面」和顺序，逗号后的空格不作数（两处书写风格不同）
  const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
  for (const id of fontKeys()) {
    const rule = html.match(new RegExp(`html\\[data-write-font="${id}"\\]\\s*\\{\\s*--write-font:([^}]*)\\}`));
    assert.ok(rule, `缺少 html[data-write-font="${id}"] 规则`);
    const betaStack = norm(rule[1]);
    const blogRule = palettes.match(new RegExp(`html\\[data-font="${id}"\\] body \\{ font-family:([^;]*);`));
    assert.ok(blogRule, `palettes.css 里没有 ${id} 的规则`);
    const blogStack = norm(blogRule[1]);
    assert.equal(betaStack, blogStack, `${id} 的字体栈与博客站不一致`);
  }
});

test('字体落在 body 上，界面与正文一起换', () => {
  const body = html.match(/(?:^|\n)body\{font:16px\/1\.5 ([^;]*);/);
  assert.ok(body, '找不到 body 的 font 规则');
  assert.equal(body[1].trim(), 'var(--write-font)', 'body 没接上 --write-font，界面控件不会跟着换');
});

test('正文、标题、哔哔输入框都用这套字体', () => {
  for (const sel of ['#body', '#title', '.memo-text']) {
    // 从行首找：`.bodywrap>#body{` 这种后代选择器里也含 `#body{`，会认错
    const rule = html.match(new RegExp('(?:^|\\n)' + sel.replace(/[.#]/g, '\\$&') + '\\{([^}]*)\\}'));
    assert.ok(rule, `找不到 ${sel} 的规则`);
    assert.match(rule[1], /font-family:var\(--write-font\)/, `${sel} 没接上 --write-font`);
  }
});

test('解析阶段就把 data-write-font 定下来，避免先按系统字体排一遍', () => {
  const head = html.slice(0, html.indexOf('<style>'));
  assert.match(head, /document\.documentElement\.dataset\.writeFont\s*=/,
    'head 里缺少预设 data-write-font 的脚本');
  assert.match(head, /localStorage\.getItem\('blog-font'\)/,
    'head 脚本应读 blog-font，否则首屏字体和抽屉里的选中项会对不上');
});

test('只挂一个 <link>，换字体改 href 不叠加；选系统则摘掉', () => {
  const at = html.indexOf('function applyWriteFont');
  assert.ok(at >= 0, '找不到 applyWriteFont');
  const fn = html.slice(at, html.indexOf('\n  }', at));
  assert.match(fn, /if \(!fontLink\)/, '应先判断是否已有 link');
  assert.match(fn, /fontLink\.href = href/, '换字体要改 href');
  assert.match(fn, /fontLink\.getAttribute\('data-font'\) !== id/, '同一种字体不该重复赋值');
  assert.match(fn, /removeChild\(fontLink\)/, '选 system 时应把 link 摘掉，不能留空 href');
});

test('预览只在有字体地址时才挂样式表', () => {
  const at = html.indexOf('function previewShell');
  assert.ok(at >= 0, '找不到 previewShell');
  const fn = html.slice(at, html.indexOf('\n  }', at));
  assert.match(fn, /BLOG_FONT_CSS\[look\.font\]\s*\?/, 'system 没有地址，不该拼出空 href');
});

test('选择落到 blog-font，与博客站共用', () => {
  const at = html.indexOf('function applyWriteFont');
  const fn = html.slice(at, html.indexOf('\n  }', at));
  assert.match(fn, /localStorage\.setItem\('blog-font', id\)/, '应写回 blog-font');
  assert.ok(!/setItem\('beta-font'/.test(html), '不要再造一个 beta-font 键，会和博客站各说各话');
});

test('预览跟着当前字体走', () => {
  assert.match(html, /if \(previewEl\.classList\.contains\('open'\)\) renderPreview\(previewPost\)/,
    '切字体时预览若开着，应重渲染，否则字形对不上');
});
