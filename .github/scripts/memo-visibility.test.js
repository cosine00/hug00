import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPublicMemos, isPublicMemo } from './memo-visibility.js';

test('only explicitly PUBLIC Memos are eligible for the public blog', () => {
  assert.equal(isPublicMemo({ visibility: 'PUBLIC' }), true);
  assert.equal(isPublicMemo({ visibility: 'public' }), true);
  assert.equal(isPublicMemo({ visibility: 'PRIVATE' }), false);
  assert.equal(isPublicMemo({ visibility: 'PROTECTED' }), false);
  assert.equal(isPublicMemo({}), false);
  assert.equal(isPublicMemo(null), false);
});

test('filters private and protected memos before attachment processing', () => {
  const memos = [
    { id: '1', visibility: 'PUBLIC', attachments: [{ name: 'attachments/public' }] },
    { id: '2', visibility: 'PRIVATE', attachments: [{ name: 'attachments/private' }] },
    { id: '3', visibility: 'PROTECTED', attachments: [{ name: 'attachments/protected' }] },
  ];
  assert.deepEqual(filterPublicMemos(memos).map(memo => memo.id), ['1']);
});

test('fails closed for missing or malformed collections', () => {
  assert.deepEqual(filterPublicMemos(null), []);
  assert.deepEqual(filterPublicMemos({ memos: [] }), []);
});
