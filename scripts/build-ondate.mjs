#!/usr/bin/env node
/**
 * 把 static/memos.json 拆成「按天索引」的小文件：static/bb-ondate/MM-DD.json
 *
 * 写作台首页那块空白会随手摆一联诗，现在也想把「历史上的今天」的哔哔捎上。
 * 一天最多十几条，但整份 memos.json 有 400 多 KB（gzip 150 多 KB），
 * 为了一屏文案去拉全量不值当。所以构建期先按天切开，页面只取当天那一个
 * 1–3 KB 的小文件，请求量和解析量都小两个数量级。
 *
 * 时区固定按 UTC+8 切日：Actions 跑在 UTC，不写死的话「今天」会差 8 小时。
 *
 *   node scripts/build-ondate.mjs            # 写 static/bb-ondate/
 *   node scripts/build-ondate.mjs --dry-run  # 只报数，不落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'static/memos.json');
const OUT_DIR = path.join(ROOT, 'static/bb-ondate');

const BEIJING_OFFSET = 8 * 3600; // 秒
const MAX_CHARS = 150;

const pad2 = (n) => String(n).padStart(2, '0');

/** 正文里那些 Markdown 记号在首页一句话里没有意义，抠掉再截断。 */
export function excerpt(content) {
  let text = String(content || '');
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // 图片
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 链接留字
  text = text.replace(/```[\s\S]*?```/g, ' '); // 代码块整段不要
  text = text.replace(/^\s{0,3}(#{1,6}|>)\s*/gm, ''); // 标题井号、引用箭头
  text = text.replace(/^\s*[-*+]\s+/gm, ''); // 列表符号
  text = text.replace(/[*_`~]{1,3}/g, ''); // 强调/行内代码记号
  text = text.replace(/\s#[^\s#]+(\s+#[^\s#]+)*\s*$/g, ' '); // 行尾 #标签
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS).trimEnd() + '…';
  return text;
}

/** createdTs（秒）→ 北京时间的「MM-DD」与年份。 */
export function dayKey(ts) {
  const d = new Date((Number(ts) + BEIJING_OFFSET) * 1000);
  return {
    year: d.getUTCFullYear(),
    key: `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
  };
}

/** memos → { 'MM-DD': [[year, text], ...] }，同一天按年份从早到晚。 */
export function groupByDay(memos) {
  const days = new Map();
  for (const memo of Array.isArray(memos) ? memos : []) {
    const ts = Number(memo && memo.createdTs);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const text = excerpt(memo.content);
    if (!text) continue; // 只有图的哔哔在一句话的位置上没内容可放
    const { year, key } = dayKey(ts);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push([year, text]);
  }
  for (const list of days.values()) {
    list.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  }
  return Object.fromEntries([...days.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(SRC)) {
    console.error(`找不到 ${path.relative(ROOT, SRC)}`);
    process.exit(1);
  }
  const memos = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const days = groupByDay(memos);

  if (!dryRun) fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let bytes = 0;
  for (const [key, list] of Object.entries(days)) {
    const body = JSON.stringify(list);
    bytes += Buffer.byteLength(body);
    const file = path.join(OUT_DIR, `${key}.json`);
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    // 内容没变就不碰文件：每天同步只改今天那一两个文件，diff 才干净
    if (old === body) continue;
    if (!dryRun) fs.writeFileSync(file, body);
    written++;
  }

  // 删掉已经不该存在的（哔哔被删、或规则改了之后重跑）
  let removed = 0;
  if (!dryRun && fs.existsSync(OUT_DIR)) {
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!/^\d{2}-\d{2}\.json$/.test(name)) continue;
      if (!days[name.slice(0, 5)]) {
        fs.unlinkSync(path.join(OUT_DIR, name));
        removed++;
      }
    }
  }

  const entries = Object.values(days).reduce((sum, list) => sum + list.length, 0);
  const biggest = Object.entries(days).sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0];
  console.log(
    `bb-ondate：${Object.keys(days).length} 天 / ${entries} 条（memos ${memos.length} 条），` +
      `写入 ${written} 个文件，删除 ${removed} 个，合计 ${(bytes / 1024).toFixed(1)} KB` +
      (biggest ? `；最大一天 ${biggest[0]} 有 ${biggest[1].length} 条` : '') +
      (dryRun ? '（dry-run，未落盘）' : '')
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
