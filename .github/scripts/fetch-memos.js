const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const MEMOS_API = 'https://i.hux.ink:5233/api/v1/memo';
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const REQUEST_TIMEOUT = 30000;
const MAX_ATTEMPTS = 3;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPage(offset) {
  const url = new URL(MEMOS_API);
  url.searchParams.set('creatorId', '1');
  url.searchParams.set('rowStatus', 'NORMAL');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT,
      });
      const body = await res.text();
      const contentType = res.headers.get('content-type') || 'unknown';

      if (!res.ok) {
        throw new Error(
          `Memos API returned HTTP ${res.status} ${res.statusText}; ` +
          `content-type=${contentType}; body=${body.slice(0, 200)}`
        );
      }

      let json;
      try {
        json = JSON.parse(body);
      } catch (error) {
        throw new Error(
          `Memos API did not return JSON; content-type=${contentType}; ` +
          `body=${body.slice(0, 200)}; reason=${error.message}`
        );
      }

      const page = json.data || json;
      if (!Array.isArray(page)) {
        throw new Error('Memos API response does not contain an array');
      }

      return page;
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
      console.warn(
        `Page offset=${offset} failed (${attempt}/${MAX_ATTEMPTS}): ${error.message}`
      );
      await sleep(attempt * 1000);
    }
  }

  return [];
}

(async () => {
  const data = [];
  const seenPages = new Set();

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const offset = pageNumber * PAGE_SIZE;
    const page = await fetchPage(offset);

    if (page.length === 0) break;

    // 防止服务端忽略 offset 后反复返回同一页，造成无限抓取。
    const pageKey = `${page.length}:${page[0]?.id}:${page[page.length - 1]?.id}`;
    if (seenPages.has(pageKey)) {
      throw new Error(`Memos API returned a duplicate page at offset=${offset}`);
    }
    seenPages.add(pageKey);

    data.push(...page);
    console.log(`Fetched ${data.length} memos (offset=${offset})`);

    if (page.length < PAGE_SIZE) break;
    await sleep(250);
  }

  if (data.length >= MAX_PAGES * PAGE_SIZE) {
    throw new Error(`Stopped after reaching the safety limit of ${data.length} memos`);
  }

  // 只保留页面需要的字段，并从 content 提取标签
  const memos = data.map(item => {
    // 用正则提取 #标签
    const content = String(item.content || '');
    const tagMatches = content.match(/#([^\s#]+)/g) || [];
    const tags = tagMatches.map(tag => tag.slice(1)); // 去掉#
    return {
      id: item.id,
      content,
      createdTs: item.createdTs,
      resourceList: item.resourceList || [],
      tags,
      // 可扩展其它字段
    };
  });

  // 保存到 static/memos.json
  const outPath = path.join(__dirname, '../../static/memos.json');
  fs.writeFileSync(outPath, JSON.stringify(memos, null, 2), 'utf-8');
  console.log(`Saved ${memos.length} memos to ${outPath}`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
