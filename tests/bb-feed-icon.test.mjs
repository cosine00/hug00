/**
 * 哔哔页订阅入口（RSS 那一枚小图标）的解析顺序回归。
 *
 * 起因：那一枚图标是内联 <svg>，自己没有 width/height，尺寸全靠页面里一段
 * 内联 <style> 里的 `.bb-feed-link svg{width:15px;height:15px}`。而那段 style
 * 原先写在 svg 之后六十行、还夹在几个同步 <script> 后头 —— 浏览器解析到 svg
 * 时样式还没着落，svg 就按「无尺寸替换元素」撑满父容器：390 视口量到 518×518，
 * 1200 视口量到 1156×1156。只要这个窗口里画了一帧，就是满屏的大 RSS 图标。
 *
 * 所以这里钉三件事：
 *   1. <style> 必须排在 .bb-feed-link 之前（解析到元素时规则已在）；
 *   2. svg 自己带 width/height（样式全挂了也炸不了）；
 *   3. 那条 CSS 尺寸规则仍然在（别为了改属性把样式删了，桌面端以后要调尺寸还靠它）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../layouts/_default/bbfocus.html'), 'utf8');

/** 取第一个 <svg ...> 的开始标签原文。 */
function firstSvgTag(text) {
  const at = text.indexOf('<svg');
  assert.ok(at >= 0, '找不到 <svg>');
  return text.slice(at, text.indexOf('>', at) + 1);
}

test('内联 <style> 排在订阅入口之前，解析到 svg 时规则已经生效', () => {
  const styleAt = src.indexOf('<style>');
  const feedAt = src.indexOf('class="bb-feed-link"');
  assert.ok(styleAt >= 0, '找不到 <style>');
  assert.ok(feedAt >= 0, '找不到 .bb-feed-link');
  assert.ok(
    styleAt < feedAt,
    '<style> 又跑到订阅入口后面去了：解析 svg 的那一瞬间没有尺寸规则，会被撑成大图标'
  );
});

test('<style> 整块留在 body 里（header partial 之后、footer 之前）', () => {
  const styleAt = src.indexOf('<style>');
  const headerAt = src.indexOf('{{ partial "header.html" . }}');
  const footerAt = src.indexOf('{{ partial "footer-empty.html" . }}');
  assert.ok(headerAt >= 0 && footerAt > 0);
  assert.ok(headerAt < styleAt, 'style 应在 header partial 之后');
  assert.ok(styleAt < footerAt, 'style 应在 footer 之前');
});

test('订阅图标的 svg 自带 width/height', () => {
  const tag = firstSvgTag(src.slice(src.indexOf('class="bb-feed-link"')));
  assert.match(tag, /width="15"/, `svg 缺少 width 属性：${tag}`);
  assert.match(tag, /height="15"/, `svg 缺少 height 属性：${tag}`);
});

test('CSS 尺寸规则仍在，且与属性值一致', () => {
  const rule = src.match(/\.bb-feed-link svg\s*\{([^}]*)\}/);
  assert.ok(rule, '找不到 .bb-feed-link svg 尺寸规则');
  assert.match(rule[1], /width\s*:\s*15px/, 'CSS 宽度与 svg 属性不一致');
  assert.match(rule[1], /height\s*:\s*15px/, 'CSS 高度与 svg 属性不一致');
});

test('订阅入口没有退化成纯图片或字体图标', () => {
  const block = src.slice(
    src.indexOf('class="bb-feed-link"'),
    src.indexOf('<div id="bber">')
  );
  assert.ok(!/<img\b/i.test(block), '订阅入口不该用 <img>（同样会先按固有尺寸/0 像素闪）');
  assert.ok(!/class="[^"]*iconfont/i.test(block), '订阅入口不该退回字体图标（字体到达前会画方框）');
});
