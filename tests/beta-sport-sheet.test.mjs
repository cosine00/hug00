/**
 * 工作台里新长出来的三个动作：记一笔、改一条、手工补抓。
 *
 * 钉住的是「别再变复杂」这件事：
 *   1. 表单只有四项 —— 时间、名称、类型、时长，心率不进抽屉；
 *   2. 同步记录只能改名，其它字段锁住，原始数据一个字节都不动；
 *   3. 抓取按钮只发 { task: 'friends' }，不把 workflow 文件名交给前端；
 *   4. 三个入口都长在已有卡片上，没有新页面、没有新页签。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../static/beta/index.html'), 'utf8');

function sheetBlock(id) {
  const at = html.indexOf('id="' + id + '"');
  assert.ok(at >= 0, '找不到 ' + id);
  // 抽屉到下一个 sheet 的起点之间，就是它的全部内容
  const next = html.indexOf('<div class="sheet" id=', at);
  return html.slice(at, next > at ? next : at + 4000);
}

test('悦动的卡头是「记一笔」，不再是跳去老后台的管理链接', () => {
  const card = html.slice(html.indexOf('<h3>悦动</h3>'), html.indexOf('<h3>悦动</h3>') + 400);
  assert.match(card, /id="pkSportAdd"/);
  assert.doesNotMatch(card, /\/admin\/\?page=sports/);
});

test('运动抽屉只有四个字段，心率不进手机屏', () => {
  const sheet = sheetBlock('sheetSport');
  ['spWhen', 'spName', 'spType', 'spMin'].forEach((id) => {
    assert.ok(sheet.includes('id="' + id + '"'), '缺字段 ' + id);
  });
  assert.doesNotMatch(sheet, /heartrate|心率|spHr/i);
});

test('类型只有爬楼、跳绳、健身三种，值和 act.json 里的 type 对得上', () => {
  const sheet = sheetBlock('sheetSport');
  const values = [...sheet.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['Stair', 'RopeSkipping', 'Workout']);
});

test('同步记录只锁改名之外的字段', () => {
  const at = html.indexOf('function fillSportForm');
  const block = html.slice(at, at + 1600);
  assert.match(block, /\['spWhen', 'spType', 'spMin'\]/);
  assert.match(block, /disabled = synced/);
  assert.doesNotMatch(block, /spName.*disabled = synced/, '名称必须留着可改');
});

test('抓取按钮只传任务名，不传 workflow 文件名', () => {
  const at = html.indexOf('function fetchFriends');
  const block = html.slice(at, at + 1200);
  assert.match(block, /\/api\/write\/refresh/);
  assert.match(block, /task: 'friends'/);
  assert.doesNotMatch(block, /\.yml/);
});

test('悦动里那几行带上了时间，点一行能直接定位到那一条', () => {
  assert.match(html, /row\.dataset\.when = String\(run\.when \|\| ''\)/);
  assert.match(html, /closest\('\.pk-run'\)/);
});

test('新增和编辑走同一个提交口，没有第二套本地草稿', () => {
  const at = html.indexOf('function saveSport');
  const block = html.slice(at, at + 2000);
  assert.match(block, /action: 'add'/);
  assert.match(block, /action: 'update'/);
  assert.doesNotMatch(block, /localStorage/, '运动记录不再在浏览器里存草稿');
});
