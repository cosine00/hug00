import test from 'node:test';
import assert from 'node:assert/strict';

import { excerpt, images, dayKey, groupByDay, recentIndex } from '../scripts/build-ondate.mjs';

test('excerpt：图片和链接不占字数，标签也不进正文', () => {
  assert.equal(excerpt('今天去了山里 ![](https://img.hux.ink/a.jpg) 很好'), '今天去了山里 很好');
  assert.equal(excerpt('看这个 [影石门店](https://example.com/x) 挺有意思'), '看这个 影石门店 挺有意思');
  assert.equal(excerpt('随手记两句 #亦可赛艇'), '随手记两句');
  assert.equal(excerpt('一句话 #标签A #标签B'), '一句话');
});

test('excerpt：Markdown 记号抠掉，换行压成空格', () => {
  assert.equal(excerpt('## 小标题\n\n第一行\n第二行'), '小标题 第一行 第二行');
  assert.equal(excerpt('> 引用一句'), '引用一句');
  assert.equal(excerpt('- 一\n- 二'), '一 二');
  assert.equal(excerpt('**很**重要 `code`'), '很重要 code');
  assert.equal(excerpt('```\nconst a = 1\n```\n正文'), '正文');
});

test('excerpt：超长截断到 150 字并补省略号', () => {
  const long = '啊'.repeat(400);
  const cut = excerpt(long);
  assert.equal(cut.length, 151);
  assert.ok(cut.endsWith('…'));
  assert.equal(excerpt(''), '');
  assert.equal(excerpt(null), '');
});

test('dayKey：按北京时间切日，不是 UTC', () => {
  // 2026-11-18T15:59Z = 北京 11-18 23:59
  assert.deepEqual(dayKey(Date.UTC(2026, 10, 18, 15, 59) / 1000), { year: 2026, key: '11-18' });
  // 2026-11-18T16:01Z = 北京 11-19 00:01
  assert.deepEqual(dayKey(Date.UTC(2026, 10, 18, 16, 1) / 1000), { year: 2026, key: '11-19' });
  // 跨年那一晚别串到上一年
  assert.deepEqual(dayKey(Date.UTC(2025, 11, 31, 16, 30) / 1000), { year: 2026, key: '01-01' });
});

test('images：抓正文里内联的图片地址，去重且最多 9 张', () => {
  assert.deepEqual(
    images('去了山里 ![a](https://img.hux.ink/a.jpg) 和 ![b](https://img.hux.ink/b.png)'),
    ['https://img.hux.ink/a.jpg', 'https://img.hux.ink/b.png']
  );
  assert.deepEqual(images('重复 ![a](https://img.hux.ink/a.jpg) ![a](https://img.hux.ink/a.jpg)'), [
    'https://img.hux.ink/a.jpg',
  ]);
  assert.deepEqual(images('相对路径 ![a](/x.jpg) 不算'), []);
  assert.deepEqual(images('没有图'), []);
  const many = Array.from({ length: 12 }, (_, i) => `![x](https://img.hux.ink/${i}.jpg)`).join(' ');
  assert.equal(images(many).length, 9);
});

test('groupByDay：同一天按年份排序，坏数据跳过', () => {
  const days = groupByDay([
    { createdTs: Date.UTC(2025, 10, 19, 2, 0) / 1000, content: '去年的' },
    { createdTs: Date.UTC(2023, 10, 19, 2, 0) / 1000, content: '前年的' },
    { createdTs: Date.UTC(2024, 10, 19, 2, 0) / 1000, content: '![](https://img.hux.ink/x.jpg)' },
    { createdTs: Date.UTC(2022, 10, 19, 2, 0) / 1000, content: '有字又有图 ![a](https://img.hux.ink/y.jpg)' },
    { createdTs: 0, content: '没有时间' },
    { createdTs: 'abc', content: '时间不对' },
    { content: '缺字段' },
    null,
  ]);

  assert.deepEqual(Object.keys(days), ['11-19']);
  assert.deepEqual(days['11-19'], [
    [2022, '有字又有图', ['https://img.hux.ink/y.jpg']],
    [2023, '前年的'],
    [2024, '', ['https://img.hux.ink/x.jpg']],
    [2025, '去年的'],
  ]);
});

test('groupByDay：输出按 MM-DD 排好，方便逐文件比对', () => {
  const days = groupByDay([
    { createdTs: Date.UTC(2024, 1, 29, 4, 0) / 1000, content: '闰日' },
    { createdTs: Date.UTC(2024, 0, 2, 4, 0) / 1000, content: '一月二号' },
    { createdTs: Date.UTC(2024, 11, 31, 4, 0) / 1000, content: '跨年' },
  ]);
  assert.deepEqual(Object.keys(days), ['01-02', '02-29', '12-31']);
  assert.equal(typeof groupByDay(undefined).constructor, 'function');
  assert.deepEqual(groupByDay(undefined), {});
});

test('recentIndex：按时间倒序，没字没图的跳过，带图的补第三位', () => {
  const list = recentIndex(
    [
      { createdTs: 300, content: '第三' },
      { createdTs: 500, content: '最新 ![a](https://img.hux.ink/a.jpg)' },
      { createdTs: 100, content: '最早' },
      { createdTs: 400, content: '![](https://img.hux.ink/b.jpg)' },
      { createdTs: 450, content: '   ' },
      { createdTs: 0, content: '没有时间' },
      null,
    ],
    3
  );
  assert.deepEqual(list, [
    [500, '最新', ['https://img.hux.ink/a.jpg']],
    [400, '', ['https://img.hux.ink/b.jpg']],
    [300, '第三'],
  ]);
});
