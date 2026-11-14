/**
 * 博主身份回归测试。
 *
 * 背景：2026-10-28 ～ 2026-11-14 期间 createComment 用 `isAdmin = emailMatchesAdmin`，
 * 而 COMMENTS_ADMIN_EMAIL 明文写在公开仓库的 config.toml 里，
 * 任何人只要填上这个邮箱就能顶「博主」标回评论（XSSProbe 探针就是由此被关注的）。
 *
 * 这里锁死修好后的规则：口令服务端校验通过 + 邮箱等于博主邮箱，缺一不可。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSubmitterIdentity } from '../worker/src/service.js';

const ADMIN_EMAIL = 'owner@example.com';
const env = { COMMENTS_ADMIN_EMAIL: ADMIN_EMAIL };

test('只有博主邮箱、没有口令：不是博主', () => {
  const id = resolveSubmitterIdentity(env, { email: ADMIN_EMAIL }, {});
  assert.equal(id.verified, false);
  assert.equal(id.isAdmin, false, '邮箱是公开信息，不能单独构成身份');
});

test('只有口令、邮箱对不上：不是博主', () => {
  const id = resolveSubmitterIdentity(env, { email: 'someone@else.com' }, { admin: true });
  assert.equal(id.verified, true);
  assert.equal(id.isAdmin, false, '拿着口令也不能顶着别人的邮箱挂博主标');
});

test('口令 + 博主邮箱：是博主', () => {
  const id = resolveSubmitterIdentity(env, { email: ADMIN_EMAIL }, { admin: true });
  assert.equal(id.verified, true);
  assert.equal(id.isAdmin, true);
});

test('大小写与首尾空格不敏感', () => {
  const id = resolveSubmitterIdentity(env, { email: '  OWNER@Example.COM ' }, { admin: true });
  assert.equal(id.isAdmin, true);
});

test('邮箱为空时即便带口令也不是博主', () => {
  const id = resolveSubmitterIdentity(env, { email: '' }, { admin: true });
  assert.equal(id.isAdmin, false);
});

test('服务端没配 COMMENTS_ADMIN_EMAIL 时任何人都不可能是博主', () => {
  const id = resolveSubmitterIdentity({}, { email: ADMIN_EMAIL }, { admin: true });
  assert.equal(id.isAdmin, false);
});

test('context.admin 只认真布尔，字符串一律不算校验通过', () => {
  // 防止以后有人写成 context.admin === 'false' 之类的坑：
  // verified 直接取自 Boolean(context.admin)，这里锁住「假值不放行」。
  for (const value of [false, undefined, null, 0, '']) {
    const id = resolveSubmitterIdentity(env, { email: ADMIN_EMAIL }, { admin: value });
    assert.equal(id.verified, false);
    assert.equal(id.isAdmin, false);
  }
});
