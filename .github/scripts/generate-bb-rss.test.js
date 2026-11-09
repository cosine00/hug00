import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBbRss, expandQuoteMarkdown, generateBbRss, escapeXml } from './generate-bb-rss.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const markedSource = fs.readFileSync(path.join(ROOT, 'static/js/marked.min.js'), 'utf8');

test('escapes XML text', () => {
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});

test('builds BB feed with Markdown, inline and attachment images, tags and stable links', () => {
  const xml = generateBbRss({
    markedSource,
    now: new Date('2026-10-31T00:00:00Z'),
    memos: [{
      id: '123',
      content: '# Hello\n\nA **bold** memo with [link](https://example.com).\n\n![inline](https://img.hux.ink/inline.webp)',
      createdTs: 1793404800,
      tags: ['生活'],
      resourceList: [
        { filename: 'extra.jpg', type: 'image/jpeg', externalLink: 'https://img.hux.ink/extra.jpg' },
        { filename: 'inline.webp', type: 'image/webp', externalLink: 'https://img.hux.ink/inline.webp' },
      ],
    }],
  });
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /\/bb\/index\.xml/);
  assert.match(xml, /https:\/\/hux\.ink\/m\/123\//);
  assert.match(xml, /urn:hux-bb:memo:123/);
  assert.match(xml, /<strong>bold<\/strong>/);
  assert.match(xml, /https:\/\/img\.hux\.ink\/inline\.webp/);
  assert.match(xml, /https:\/\/img\.hux\.ink\/extra\.jpg/);
  assert.match(xml, /<title>Hello A bold memo with link\.<\/title>/);
  assert.match(xml, /<description><!\[CDATA\[Hello A bold memo with link\.\]\]><\/description>/);
  assert.match(xml, /生活/);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
});

test('omits image filenames from BB titles and descriptions', () => {
  const xml = buildBbRss([{
    id: 'image-title',
    content: '不支持 Markdown 吗？也试试图片。\n\n![Snipaste2026-10-2918-34-08.png](https://img.hux.ink/test.png)',
    createdTs: 1700000000,
    tags: [],
  }], { parse: () => '<p>不支持 Markdown 吗？也试试图片。</p><p><img src="https://img.hux.ink/test.png" alt="Snipaste2026-10-2918-34-08.png"></p>' });

  assert.match(xml, /<title>不支持 Markdown 吗？也试试图片。<\/title>/);
  assert.match(xml, /<description><!\[CDATA\[不支持 Markdown 吗？也试试图片。\]\]><\/description>/);
  assert.match(xml, /<content:encoded><!\[CDATA\[[\s\S]*Snipaste2026-10-2918-34-08\.png/);
});

test('limits the feed to the latest 100 memos', () => {
  const memos = Array.from({ length: 105 }, (_, index) => ({
    id: String(index + 1), content: 'Memo ' + index, createdTs: 1700000000 + index, tags: [],
  }));
  const xml = buildBbRss(memos, { parse: text => '<p>' + text + '</p>' });
  assert.equal((xml.match(/<item>/g) || []).length, 100);
  assert.match(xml, /Memo 104/);
  assert.doesNotMatch(xml, /Memo 4<\/description>/);
});

test('sanitizes executable HTML in memo content', () => {
  const xml = buildBbRss([
    { id: '9', content: 'safe text', createdTs: 1700000000, tags: [] },
  ], { parse: () => '<script>alert(1)</script><p onclick="x()">safe text</p><a href="javascript:alert(1)">bad</a>' });
  assert.doesNotMatch(xml, /<script|onclick=|javascript:/i);
});

test('keeps the inline reference in the prose and appends the quote card', () => {
  const memos = [
    { id: '12', content: '被引用的内容。' },
    { id: '13', content: '详情见 [ID.12](/m/12/)。' },
  ];
  const out = expandQuoteMarkdown(memos[1].content, memos);
  // 句子中间删掉标记会剩下「详情见 。」，所以正文保留短链接。
  assert.match(out, /详情见 \[ID\.12\]\(\/m\/12\/\)。/);
  // 文末卡片用绝对地址，阅读器里也能点开。
  assert.match(out, /^> \[ID\.12\]\(https:\/\/hux\.ink\/m\/12\/\)/m);
  assert.match(out, /被引用的内容。/);
});
