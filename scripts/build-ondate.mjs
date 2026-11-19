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
const RECENT_OUT = path.join(ROOT, 'static/bb-recent.json');
const RECENT_MAX = 6;

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

/** 哔哔里的图都是正文内联的 ![](url)（附件表目前是空的），这里只挑 http(s) 地址。 */
export function images(content) {
  const found = String(content || '').match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g) || [];
  const urls = found.map((one) =>
    one.replace(/^!\[[^\]]*\]\(/, '').replace(/\)$/, '').trim()
  );
  // 同一条里贴重复地址只留一张；FlareMo 那边单条上限就是 9 张
  return urls.filter((url, i) => urls.indexOf(url) === i).slice(0, 9);
}

/** createdTs（秒）→ 北京时间的「MM-DD」与年份。 */
export function dayKey(ts) {
  const d = new Date((Number(ts) + BEIJING_OFFSET) * 1000);
  return {
    year: d.getUTCFullYear(),
    key: `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
  };
}

/** memos → { 'MM-DD': [[year, text, [图片…]?], ...] }，同一天按年份从早到晚。 */
export function groupByDay(memos) {
  const days = new Map();
  for (const memo of Array.isArray(memos) ? memos : []) {
    const ts = Number(memo && memo.createdTs);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const text = excerpt(memo.content);
    const pics = images(memo.content);
    if (!text && !pics.length) continue; // 既没字也没图，这条在首页放不下
    const { year, key } = dayKey(ts);
    // 只有带图的条目才补第三位，绝大多数天还是 [年份, 摘要] 两个字段
    days.set(key, (days.get(key) || []).concat([[year, text].concat(pics.length ? [pics] : [])]));
  }
  for (const list of days.values()) {
    list.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])));
  }
  return Object.fromEntries([...days.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** 最新的几条：哔哔编辑页下面要摆「最近」，同样不该为此拉 400 多 KB 的全量。 */
export function recentIndex(memos, limit) {
  const max = Number(limit) || RECENT_MAX;
  return (Array.isArray(memos) ? memos : [])
    .map((memo) => ({
      ts: Number(memo && memo.createdTs),
      text: excerpt(memo && memo.content),
      pics: images(memo && memo.content),
    }))
    .filter((one) => Number.isFinite(one.ts) && one.ts > 0 && (one.text || one.pics.length))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, max)
    .map((one) => [one.ts, one.text].concat(one.pics.length ? [one.pics] : []));
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

  // 「最近几条」也顺手写一份，哔哔编辑页拿它摆三条，不用拉全量
  const recent = recentIndex(memos);
  const recentBody = JSON.stringify(recent);
  const recentOld = fs.existsSync(RECENT_OUT) ? fs.readFileSync(RECENT_OUT, 'utf8') : null;
  const recentChanged = recentOld !== recentBody;
  if (recentChanged && !dryRun) fs.writeFileSync(RECENT_OUT, recentBody);

  const entries = Object.values(days).reduce((sum, list) => sum + list.length, 0);
  const biggest = Object.entries(days).sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)[0];
  console.log(
    `bb-ondate：${Object.keys(days).length} 天 / ${entries} 条（memos ${memos.length} 条），` +
      `写入 ${written} 个文件，删除 ${removed} 个，合计 ${(bytes / 1024).toFixed(1)} KB` +
      (biggest ? `；最大一天 ${biggest[0]} 有 ${biggest[1].length} 条` : '') +
      `；bb-recent ${recent.length} 条 ${(Buffer.byteLength(recentBody) / 1024).toFixed(1)} KB` +
      (recentChanged ? '（已更新）' : '（未变）') +
      (dryRun ? '（dry-run，未落盘）' : '')
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
