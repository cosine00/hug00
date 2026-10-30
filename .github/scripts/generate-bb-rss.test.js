import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBbRss, generateBbRss, escapeXml } from './generate-bb-rss.js';

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
  assert.match(xml, /生活/);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
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
