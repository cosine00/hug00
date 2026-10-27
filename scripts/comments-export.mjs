#!/usr/bin/env node
/**
 * 导出全部评论为 JSON（备份用），走 Worker 的 /admin/export 接口。
 *
 *   node scripts/comments-export.mjs --api http://localhost:8787/api/comments --token devtoken
 *   node scripts/comments-export.mjs --api https://comments.hux.ink/api/comments --token xxx --out backup.json
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const api = getArg('--api', 'http://localhost:8787/api/comments').replace(/\/+$/, '');
const token = getArg('--token', process.env.COMMENTS_ADMIN_TOKEN || '');
const outFile = getArg('--out', `comments-backup-${new Date().toISOString().slice(0, 10)}.json`);

if (!token) {
  console.error('缺少管理口令：加 --token <COMMENTS_ADMIN_TOKEN>');
  process.exit(1);
}

const res = await fetch(`${api}/admin/export?limit=20000`, {
  headers: { 'x-admin-token': token },
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`导出失败 ${res.status}: ${text.slice(0, 200)}`);
  process.exit(1);
}

const data = await res.json();
fs.writeFileSync(path.resolve(outFile), JSON.stringify(data, null, 2), 'utf8');
console.log(
  `已导出 ${data.comments.length} 条评论、${data.threads.length} 个线程 → ${path.resolve(outFile)}`
);
