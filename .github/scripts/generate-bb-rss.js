import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT = path.join(ROOT, 'static/memos.json');
const MARKED = path.join(ROOT, 'static/js/marked.min.js');
const OUTPUT = path.join(ROOT, 'static/bb/index.xml');
const SITE_URL = 'https://hux.ink';
const FEED_URL = SITE_URL + '/bb/index.xml';
const BB_URL = SITE_URL + '/bb/';
const FEED_LIMIT = 100;

export function escapeXml(value) {
  return String(value ?? '').replace(/[<>&'"]/g, char => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[char]);
}

function cdata(value) {
  return '<![CDATA[' + String(value).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
}

function loadMarked(source) {
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const api = sandbox.marked?.marked || sandbox.marked;
  if (!api || typeof api.parse !== 'function') {
    throw new Error('无法从 static/js/marked.min.js 加载 Markdown 解析器');
  }
  return api;
}

export function sanitizeMemoHtml(html) {
  return String(html)
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2/gi, ' $1="#"');
}

function plainText(markdown) {
  return String(markdown || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_>#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attachmentImages(memo) {
  const inlineUrls = new Set();
  String(memo.content || '').replace(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g, (match, angle, plain) => {
    inlineUrls.add(angle || plain);
    return match;
  });
  return (Array.isArray(memo.resourceList) ? memo.resourceList : [])
    .filter(resource => {
      const type = String(resource?.type || '').toLowerCase();
      const url = String(resource?.externalLink || resource?.publicUrl || '');
      return url && (type.startsWith('image') || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url));
    })
    .map(resource => ({
      url: String(resource.externalLink || resource.publicUrl),
      alt: String(resource.filename || '图片'),
    }))
    .filter(item => /^https?:\/\//i.test(item.url) && !inlineUrls.has(item.url));
}

function memoPermalink(memo) {
  return SITE_URL + '/m/' + encodeURIComponent(String(memo.id)) + '/';
}

export function buildBbRss(memos, markedApi, now = new Date()) {
  const items = [...memos]
    .filter(memo => memo && memo.id != null && Number(memo.createdTs) > 0 && String(memo.content || '').trim())
    .sort((a, b) => Number(b.createdTs) - Number(a.createdTs))
    .slice(0, FEED_LIMIT);

  const entries = items.map(memo => {
    const id = String(memo.id);
    const link = memoPermalink(memo);
    const published = new Date(Number(memo.createdTs) * 1000);
    const title = plainText(memo.content).slice(0, 80) || '随手记';
    let html = markedApi.parse(String(memo.content || ''), { breaks: true });
    html = sanitizeMemoHtml(html);
    const images = attachmentImages(memo);
    if (images.length) {
      html += '<div class="memo-attachments">' + images.map(image =>
        '<p><img src="' + escapeXml(image.url) + '" alt="' + escapeXml(image.alt) + '" /></p>'
      ).join('') + '</div>';
    }
    const tags = (Array.isArray(memo.tags) ? memo.tags : [])
      .filter(tag => typeof tag === 'string' && tag.trim())
      .map(tag => '<category>' + cdata(tag.trim()) + '</category>')
      .join('');
    const description = plainText(memo.content).slice(0, 240);
    return [
      '<item>',
      '<title>' + escapeXml(title) + '</title>',
      '<link>' + escapeXml(link) + '</link>',
      '<guid isPermaLink="false">' + escapeXml('urn:hux-bb:memo:' + id) + '</guid>',
      '<pubDate>' + published.toUTCString() + '</pubDate>',
      '<description>' + cdata(description) + '</description>',
      '<content:encoded>' + cdata(html) + '</content:encoded>',
      tags,
      '</item>',
    ].join('');
  }).join('\n');

  const latest = items.length ? new Date(Number(items[0].createdTs) * 1000) : now;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '<channel>',
    '<title>Counting Stars💫·哔哔</title>',
    '<link>' + escapeXml(BB_URL) + '</link>',
    '<description>正经话不多，废话倒是不少</description>',
    '<language>zh-cn</language>',
    '<generator>Hugo BB RSS generator</generator>',
    '<lastBuildDate>' + latest.toUTCString() + '</lastBuildDate>',
    '<atom:link href="' + escapeXml(FEED_URL) + '" rel="self" type="application/rss+xml" />',
    entries,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function generateBbRss({ memos, markedSource, now } = {}) {
  return buildBbRss(memos, loadMarked(markedSource), now);
}

function main() {
  const memos = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const markedSource = fs.readFileSync(MARKED, 'utf8');
  const xml = generateBbRss({ memos, markedSource });
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, xml, 'utf8');
  console.log('生成 ' + path.relative(ROOT, OUTPUT) + '：' + (xml.match(/<item>/g) || []).length + ' 条哔哔');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
