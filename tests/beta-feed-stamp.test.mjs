/**
 * 博友卡头那行小字：订阅数 + 数据有多新。
 *
 * 钉住两件事：
 *   1. rss.json 里的 "YYYY-MM-DD HH:MM:SS UTC" 要按 UTC 解析，再取本地时刻
 *      （不这么干的话 +8 时区会差出八小时，显示成「昨天」）；
 *   2. 宽度只有一行的份，所以今天给时刻、昨天给「昨天」、更早给月日。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../static/beta/index.html'), 'utf8');

/* 把页面里那个函数原样捞出来跑，避免测试和实现各写一份 */
const at = html.indexOf('function feedUpdated(');
assert.ok(at > -1, '找不到 feedUpdated');
const src = html.slice(at, html.indexOf('\n  }', at) + 4);
const pad2 = (n) => ('0' + n).slice(-2);
const feedUpdated = new Function('pad2', src + '\nreturn feedUpdated;')(pad2);

const stamp = (d) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
  `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:07 UTC`;

test('今天的 UTC 时间按本地时刻显示，不是原样照抄小时数', () => {
  const now = new Date();
  const text = feedUpdated(stamp(now));
  assert.equal(text, pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ' 更新');
  assert.ok(!text.includes('UTC'), '不能把 UTC 三个字母漏到界面上');
});

test('昨天的给「昨天」，再早的给月日', () => {
  const now = new Date();
  const y = new Date(now.getTime() - 86400000);
  assert.equal(feedUpdated(stamp(y)), '昨天 ' + pad2(y.getHours()) + ':' + pad2(y.getMinutes()));

  const old = new Date(now.getTime() - 5 * 86400000);
  assert.equal(
    feedUpdated(stamp(old)),
    (old.getMonth() + 1) + '/' + old.getDate() + ' ' + pad2(old.getHours()) + ':' + pad2(old.getMinutes())
  );
});

test('没有 UTC 字样的时间按本地解释，不硬加八小时', () => {
  assert.equal(feedUpdated('2020-03-05 09:05:00'), '3/5 09:05');
});

test('空值、坏值给空串，卡片头不会留个孤儿分隔符', () => {
  ['', null, undefined, '不是时间', '2026-13-99 99:99'].forEach((bad) => {
    assert.equal(feedUpdated(bad), '', String(bad) + ' 应该给空串');
  });
});

test('卡头拼成「N 位 · 时间 更新」，缺哪半都不留点', () => {
  assert.match(html, /feedBits\.push\(friends\.friends \+ ' 位'\)/);
  assert.match(html, /feedBits\.push\(feedUpdatedText\)/);
  assert.match(html, /\$\('pkFeedSub'\)\.textContent = feedBits\.join\(' · '\)/);
});

test('两个入口的文案：悦动是「管理」，博友是「同步」', () => {
  assert.match(html, /id="pkSportAdd"[^>]*>管理</);
  assert.match(html, /id="pkFeedFetch"[^>]*>同步</);
  assert.doesNotMatch(html, /id="pkSportAdd"[^>]*>记一笔</);
  assert.doesNotMatch(html, /id="pkFeedFetch"[^>]*>抓取</);
});

test('同步按钮的中间态和回落都不再用「抓取」这个词', () => {
  const block = html.slice(html.indexOf('function fetchFriends'), html.indexOf('function fetchFriends') + 1200);
  assert.match(block, /'同步中…'/);
  assert.equal((block.match(/'同步'/g) || []).length, 2, '成功回落和失败回落都要回到「同步」');
  assert.doesNotMatch(block, /'抓取'/);
});
