import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 时光（相册）卡面的标题：alt 到底是真标题，还是贴图工具自动起的文件名。
 *
 * 线上出过一例：Memos 里贴第二张图，alt 被写成「image」，认不出来，
 * 卡面就顶着 image 显示，而不是条目正文的「青甘大环线」。
 *
 * 和 beta 的预览测试一样，函数直接从 album.html 抽出来跑，不在这里抄第二份实现。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'layouts', '_default', 'album.html'), 'utf8');

function grab(name) {
  const start = HTML.indexOf('function ' + name + '(');
  assert.ok(start > -1, `album.html 里找不到 function ${name}`);
  let index = HTML.indexOf('{', start);
  let depth = 0;
  for (; index < HTML.length; index += 1) {
    if (HTML[index] === '{') depth += 1;
    else if (HTML[index] === '}') {
      depth -= 1;
      if (!depth) return HTML.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 没有闭合`);
}

const NAMES = ['truncateTitle', 'cleanGalleryTitle', 'looksLikeFilename', 'looksLikeBareMediaName', 'photoCaption'];
const SOURCE = NAMES.map(grab).join('\n');
const { truncateTitle, cleanGalleryTitle, looksLikeFilename, looksLikeBareMediaName, photoCaption } = new Function(
  SOURCE + `\nreturn { ${NAMES.join(', ')} };`
)();

const GALLERY = '青甘大环线';

/* ---------------------------- 文件名识别 ---------------------------- */

test('相机/手机导出的文件名一律认出来', () => {
  for (const name of ['IMG_20261002_134454.jpg', 'DSC00123.JPG', 'dji_0042.mp4', 'PXL_20261002.png']) {
    assert.equal(looksLikeFilename(name), true, `${name} 应该当文件名`);
  }
});

test('image / photo 这类贴图工具默认名也认出来（本次修复的入口）', () => {
  for (const name of ['image', 'IMAGE', 'image 1', 'image_2', 'image-3', 'photo', 'Picture 4', 'image.png']) {
    assert.equal(looksLikeBareMediaName(name) || looksLikeFilename(name), true, `${name} 应该当文件名`);
  }
});

test('正常标题不会被误判', () => {
  for (const title of ['深圳湾', '盐田海滨栈道', '图片里的故事', 'image of the day', '青海湖喂个鸟']) {
    assert.equal(looksLikeBareMediaName(title), false, `${title} 是真标题`);
    assert.equal(looksLikeFilename(title), false, `${title} 是真标题`);
  }
});

/* ------------------------------ 标题判定 ------------------------------ */

test('alt 是 image 时退回条目正文，而不是把 image 挂上去', () => {
  assert.equal(photoCaption('image', GALLERY), GALLERY);
  assert.equal(photoCaption('image 1', GALLERY), GALLERY);
  assert.equal(photoCaption('', GALLERY), GALLERY);
  assert.equal(photoCaption('IMG_20261002_134454.jpg', GALLERY), GALLERY);
});

test('「文件名 + 真标题」的 alt 取后半段，不整段丢掉', () => {
  assert.equal(photoCaption('IMG_2026 深圳湾', GALLERY), '深圳湾');
  assert.equal(photoCaption('DSC00123 海边日落', GALLERY), '海边日落');
});

test('alt 本身就是标题时原样保留', () => {
  assert.equal(photoCaption('盐田海滨栈道'), '盐田海滨栈道');
  assert.equal(photoCaption('  龙华樟坑郊野径  ', GALLERY), '龙华樟坑郊野径');
});

/* ------------------------------ 正文清洗 ------------------------------ */

test('cleanGalleryTitle 去掉 #相册 前缀和图片语法', () => {
  const content =
    '#相册 青甘大环线\n\n![IMG_20261002_134454.jpg](https://img.hux.ink/image/2026/10/IMG_20261002_134454.jpg)\n![image](https://img.hux.ink/image/2026/11/20261104210649-7fmaj-2026-10-05-22-22-09-img-6526.webp)';
  assert.equal(cleanGalleryTitle(content), '青甘大环线');
});

test('cleanGalleryTitle 最多 20 个字', () => {
  assert.equal(truncateTitle('一二三四五六七八九十一二三四五六七八九十一二', 20).length, 20);
  assert.equal(cleanGalleryTitle('#相册 ' + '字'.repeat(30)).length, 20);
});

/* ------------------------------ 真实数据 ------------------------------ */

test('回归：memos.json 里那条 #相册 的两张图都叫「青甘大环线」', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'static', 'memos.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.data || [];
  const memo = list.find((item) => String(item.content || '').includes('#相册 青甘大环线'));
  assert.ok(memo, 'memos.json 里应该还有这条');

  const gallery = cleanGalleryTitle(memo.content);
  const slots = [];
  const pattern = /!\[(.*?)\]\((.*?)\)/g;
  let match;
  while ((match = pattern.exec(memo.content)) !== null) slots.push(photoCaption(match[1], gallery));

  assert.equal(slots.length, 2);
  for (const title of slots) assert.equal(title, '青甘大环线');
});
