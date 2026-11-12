import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasVideoTag,
  normalizeMemoId,
  removeMemo,
  sortMemos,
  upsertMemo,
} from './memo-merge.js';

test('normalizeMemoId 只接受裸 id', () => {
  assert.equal(normalizeMemoId('memos/1276'), '1276');
  assert.equal(normalizeMemoId('1276'), '1276');
  assert.equal(normalizeMemoId(' memos/abc-1 '), 'abc-1');
  assert.equal(normalizeMemoId(''), '');
  assert.equal(normalizeMemoId(null), '');
  assert.equal(normalizeMemoId('memos/'), '');
  // 路径、空段、注入形态一律拒绝
  assert.equal(normalizeMemoId('../../etc/passwd '), 'passwd');
  assert.equal(normalizeMemoId('memos/a b'), '');
});

test('upsertMemo 追加新记录且不改原数组', () => {
  const base = [{ id: '1', createdTs: 10 }];
  const next = upsertMemo(base, { id: '2', createdTs: 20 });
  assert.equal(next.length, 2);
  assert.equal(base.length, 1);
  assert.deepEqual(next.map(m => m.id), ['1', '2']);
});

test('upsertMemo 按 id 原位替换，重复执行只会得到一条', () => {
  const base = [{ id: '1', createdTs: 10, content: 'a' }, { id: '2', createdTs: 20 }];
  const edited = { id: '1', createdTs: 10, content: 'b' };
  const once = upsertMemo(base, edited);
  const twice = upsertMemo(once, edited);
  assert.equal(once.length, 2);
  assert.equal(once[0].content, 'b');
  assert.deepEqual(twice, once);
});

test('upsertMemo 拒绝没有合法 id 的记录', () => {
  assert.throws(() => upsertMemo([], { id: '' }), /合法 id/);
  assert.throws(() => upsertMemo([], { content: 'x' }), /合法 id/);
});

test('removeMemo 删除指定 id，重复执行不报错', () => {
  const base = [{ id: '1' }, { id: '2' }];
  const once = removeMemo(base, 'memos/1');
  assert.deepEqual(once.map(m => m.id), ['2']);
  assert.deepEqual(removeMemo(once, '1'), once);
  assert.throws(() => removeMemo(base, ''), /合法 id/);
});

test('sortMemos 去重保留最后版本并按 createdTs 降序', () => {
  const list = [
    { id: '1', createdTs: 10, content: 'old' },
    { id: '2', createdTs: 30 },
    { id: '1', createdTs: 10, content: 'new' },
    { id: '3', createdTs: 20 },
  ];
  const sorted = sortMemos(list);
  assert.deepEqual(sorted.map(m => m.id), ['2', '3', '1']);
  assert.equal(sorted[2].content, 'new');
});

test('sortMemos 忽略非法条目且不破坏同一时间戳的相对顺序', () => {
  const sorted = sortMemos([
    { id: 'a', createdTs: 5 },
    { id: '', createdTs: 99 },
    { id: 'b', createdTs: 5 },
    null,
  ]);
  assert.deepEqual(sorted.map(m => m.id), ['a', 'b']);
});

test('hasVideoTag 只看 #影彩', () => {
  assert.equal(hasVideoTag({ tags: ['影彩'], content: '' }), true);
  assert.equal(hasVideoTag({ tags: [], content: 'vlog01 [x](https://b23.tv/1) #影彩' }), true);
  assert.equal(hasVideoTag({ tags: ['人间流浪'], content: '普通哔哔' }), false);
  assert.equal(hasVideoTag(null), false);
});
