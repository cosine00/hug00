#!/usr/bin/env node
/**
 * 把 Twikoo 的历史评论导入新系统。
 * 只读 Twikoo 导出的 JSON 文件，不会连接、也不会修改 Twikoo 的任何数据。
 *
 * 用法：
 *   1. Twikoo 管理面板 → 导出 → 得到 twikoo-export.json
 *   2. 空跑确认：
 *        node scripts/import-twikoo.mjs --file twikoo-export.json --dry-run
 *   3. 正式导入（本地 Worker 在 8787）：
 *        node scripts/import-twikoo.mjs --file twikoo-export.json \
 *          --api http://localhost:8787/api/comments --token devtoken
 *   4. 线上：
 *        node scripts/import-twikoo.mjs --file twikoo-export.json \
 *          --api https://comments.hux.ink/api/comments --token <你的口令>
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const file = getArg('--file');
const api = getArg('--api', 'http://localhost:8787/api/comments').replace(/\/+$/, '');
const token = getArg('--token', process.env.COMMENTS_ADMIN_TOKEN || '');
const dryRun = args.includes('--dry-run');
const batchSize = Number(getArg('--batch', '50'));

if (!file) {
  console.error('缺少参数：--file <twikoo-export.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const source = Array.isArray(raw) ? raw : raw.data || raw.comments || [];
if (!source.length) {
  console.error('导出文件里没有评论数据');
  process.exit(1);
}

console.log(`读取到 ${source.length} 条 Twikoo 评论`);

const items = source
  .filter((item) => item && item.comment && item.nick)
  .map((item) => {
    const ua = String(item.ua || '');
    return {
      oldId: item._id ? String(item._id) : '',
      parentOldId: item.pid ? String(item.pid) : '',
      threadKey: String(item.url || ''),
      threadUrl: item.url ? `https://hux.ink${item.url.startsWith('/') ? '' : '/'}${item.url}` : '',
      threadTitle: item.title || '',
      nick: String(item.nick).slice(0, 40),
      email: (item.mail || '').trim().toLowerCase(),
      website: item.link || '',
      content: String(item.comment).slice(0, 5000),
      ua,
      region: item.ipRegion || '',
      createdAt: Math.floor(Number(item.created || Date.now()) / 1000),
      status: item.isSpam ? 'spam' : 'approved',
      // 供脚本自身统计，服务端会忽略
      _url: item.url || '',
    };
  });

const byThread = {};
for (const item of items) byThread[item.threadKey] = (byThread[item.threadKey] || 0) + 1;

console.log('');
console.log(dryRun ? '【空跑模式】不会写入数据库' : `目标接口：${api}`);
console.log(`  可导入：${items.length} 条`);
console.log(`  跳过：  ${source.length - items.length} 条（缺昵称或内容）`);
console.log(`  涉及线程：${Object.keys(byThread).length} 个`);
Object.entries(byThread)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([key, count]) => console.log(`    ${key}  ${count} 条`));

if (dryRun) {
  console.log('');
  console.log('确认无误后去掉 --dry-run 再跑一次即可正式导入。');
  process.exit(0);
}

if (!token) {
  console.error('\n缺少管理口令：加 --token <COMMENTS_ADMIN_TOKEN>');
  process.exit(1);
}

let imported = 0;
let skipped = 0;
const total = Math.ceil(items.length / batchSize);

for (let i = 0; i < items.length; i += batchSize) {
  const chunk = items.slice(i, i + batchSize);
  const payload = chunk.map(({ _url, ...rest }) => rest);

  const res = await fetch(`${api}/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ items: payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    console.error(`\n第 ${Math.floor(i / batchSize) + 1}/${total} 批失败：`, data.error || res.status);
    process.exit(1);
  }
  imported += Number(data.imported || 0);
  skipped += Number(data.skipped || 0);
  process.stdout.write(`\r已导入 ${imported} 条… (${Math.floor(i / batchSize) + 1}/${total} 批)`);
}

console.log('');
console.log(`导入完成：成功 ${imported} 条，跳过 ${skipped} 条`);
console.log('建议随后在管理后台抽查几条，确认文章和哔哔下都挂对了位置。');
