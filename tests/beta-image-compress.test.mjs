/**
 * beta 上传前的图片压缩。
 *
 * 起因：同一张图从 beta 传上去比从老 admin 传的糊。两边都压缩，但不是同一套代码，
 * 差异集中在最大边长 —— beta 写死 1600，admin 默认 1920 且可配到 6000。
 *
 * 钉住：
 *   1. 最大边长与 admin 默认值一致（1920），且只缩不放；
 *   2. WebP 质量与 admin 默认值一致（0.82）；
 *   3. GIF 原样上传（过 canvas 会掉成静态图）；
 *   4. 小尺寸的 webp/jpeg 原样上传，不做无谓重编码。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const beta = fs.readFileSync(path.join(here, '../static/beta/index.html'), 'utf8');
const admin = fs.readFileSync(path.join(here, '../static/admin/index.html'), 'utf8');

/* 从页面里把 compress 原样捞出来跑 */
const start = beta.indexOf('  function compress(file) {');
assert.ok(start > -1, '找不到 compress');

let depth = 0;
let end = -1;
for (let i = beta.indexOf('{', start); i < beta.length; i += 1) {
  if (beta[i] === '{') depth += 1;
  else if (beta[i] === '}') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
assert.ok(end > start, 'compress 的花括号没闭合');
const src = beta.slice(start, end);

const maxSide = Number(/var MAX_SIDE = (\d+);/.exec(beta)?.[1]);
const quality = Number(/var WEBP_QUALITY = ([\d.]+);/.exec(beta)?.[1]);

function build(uploaded) {
  const canvasOf = [];
  const document = {
    createElement() {
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return { imageSmoothingQuality: '', drawImage() {} };
        },
      };
      canvasOf.push(canvas);
      return canvas;
    },
  };
  const toBlob = (canvas, type, q) => {
    uploaded.push({ type, quality: q, width: canvas.width, height: canvas.height });
    return Promise.resolve({ type, size: 1234 });
  };
  const loadImage = (file) => Promise.resolve({ width: file._w, height: file._h });
  const compress = new Function(
    'loadImage', 'toBlob', 'MAX_SIDE', 'WEBP_QUALITY', 'document',
    src + '\nreturn compress;'
  )(loadImage, toBlob, maxSide, quality, document);
  return { compress, uploaded, canvasOf };
}

const img = (size, type, w, h) => {
  const file = { size, type, width: w, height: h, _w: w, _h: h, name: 'x' };
  return file;
};

test('最大边长与老 admin 的默认值一致', () => {
  const adminSide = Number(/r2ImageMaxSide:\s*(\d+)/.exec(admin)?.[1]);
  assert.ok(adminSide > 0, '没读到 admin 的默认最大边长');
  assert.equal(maxSide, adminSide, `beta 是 ${maxSide}，admin 是 ${adminSide}`);
});

test('WebP 质量与老 admin 的默认值一致', () => {
  const adminQ = Number(/r2WebpQuality:\s*([\d.]+)/.exec(admin)?.[1]);
  assert.ok(adminQ > 0, '没读到 admin 的默认质量');
  assert.equal(quality, adminQ, `beta 是 ${quality}，admin 是 ${adminQ}`);
});

test('横图按长边缩到 1920，短边等比', async () => {
  const { compress, uploaded } = build([]);
  await compress(img(3 * 1024 * 1024, 'image/jpeg', 4000, 3000));
  assert.deepEqual(
    { w: uploaded[0].width, h: uploaded[0].height },
    { w: 1920, h: 1440 }
  );
  assert.equal(uploaded[0].type, 'image/webp');
  assert.equal(uploaded[0].quality, 0.82);
});

test('竖图同样按长边缩，不会把宽高弄反', async () => {
  const { compress, uploaded } = build([]);
  await compress(img(3 * 1024 * 1024, 'image/jpeg', 3000, 4000));
  assert.deepEqual(
    { w: uploaded[0].width, h: uploaded[0].height },
    { w: 1440, h: 1920 }
  );
});

test('本来就小于上限的图不放大', async () => {
  const { compress, uploaded } = build([]);
  await compress(img(900 * 1024, 'image/png', 1500, 1000));
  assert.deepEqual(
    { w: uploaded[0].width, h: uploaded[0].height },
    { w: 1500, h: 1000 }
  );
});

test('小尺寸的 webp / jpeg 原样上传，不做重编码', async () => {
  for (const type of ['image/webp', 'image/jpeg']) {
    const { compress, uploaded } = build([]);
    const file = img(100 * 1024, type, 800, 600);
    const out = await compress(file);
    assert.equal(out, file, type + ' 不该被重编码');
    assert.equal(uploaded.length, 0);
  }
});

test('GIF 原样上传，避免动图掉成第一帧', async () => {
  const { compress, uploaded } = build([]);
  const file = img(2 * 1024 * 1024, 'image/gif', 800, 600);
  const out = await compress(file);
  assert.equal(out, file);
  assert.equal(uploaded.length, 0);
});

test('大 PNG 截图仍会转 WebP（体积换清晰度的既有策略）', async () => {
  const { compress, uploaded } = build([]);
  await compress(img(2 * 1024 * 1024, 'image/png', 2000, 1200));
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].type, 'image/webp');
  assert.equal(uploaded[0].width, 1920);
});

test('浏览器不支持 WebP 时退回 JPEG 0.86', async () => {
  const { compress } = build([]);
  const document = {
    createElement() {
      return { width: 0, height: 0, getContext: () => ({ imageSmoothingQuality: '', drawImage() {} }) };
    },
  };
  const calls = [];
  const toBlob = (canvas, type, q) => {
    calls.push({ type, q });
    // 模拟老浏览器：要 webp 却回了 png
    return Promise.resolve({ type: type === 'image/webp' ? 'image/png' : type, size: 9 });
  };
  const loadImage = () => Promise.resolve({ width: 3000, height: 2000 });
  const fn = new Function(
    'loadImage', 'toBlob', 'MAX_SIDE', 'WEBP_QUALITY', 'document',
    src + '\nreturn compress;'
  )(loadImage, toBlob, maxSide, quality, document);
  const out = await fn(img(3 * 1024 * 1024, 'image/jpeg', 3000, 2000));
  assert.deepEqual(calls.map((c) => c.type), ['image/webp', 'image/jpeg']);
  assert.equal(calls[1].q, 0.86);
  assert.equal(out.type, 'image/jpeg');
});
