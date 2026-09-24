const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SOURCE = path.join(ROOT, 'static/memos.json');
const RECENT_OUTPUT = path.join(ROOT, 'static/memos-recent.json');
const RANDOM_OUTPUT = path.join(ROOT, 'static/memos-random.json');
const RECENT_LIMIT = 60;
const RANDOM_POOL_LIMIT = 60;
const HIDDEN_TAGS = new Set(['相册', 'clip']);

function normalizeTag(tag) {
  return String(tag || '').trim().replace(/^#/, '').toLowerCase();
}

function isPublicBibi(memo) {
  if (!memo || !memo.content || !memo.createdTs) return false;
  return !(memo.tags || []).some(tag => HIDDEN_TAGS.has(normalizeTag(tag)));
}

function seededRandom(seedText) {
  const digest = crypto.createHash('sha256').update(seedText).digest();
  let state = digest.readUInt32LE(0) || 1;
  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const eligible = (Array.isArray(source) ? source : [])
  .filter(isPublicBibi)
  .sort((a, b) => Number(b.createdTs) - Number(a.createdTs));

const recent = eligible.slice(0, RECENT_LIMIT);
const recentIds = new Set(recent.map(item => String(item.id)));
const older = eligible.filter(item => !recentIds.has(String(item.id)));
const rotation = new Date().toISOString().slice(0, 10);
const randomPool = shuffled(older, seededRandom(`bibi:${rotation}`)).slice(0, RANDOM_POOL_LIMIT);
const generatedAt = new Date().toISOString();

fs.writeFileSync(RECENT_OUTPUT, JSON.stringify({ generatedAt, items: recent }, null, 2) + '\n');
fs.writeFileSync(RANDOM_OUTPUT, JSON.stringify({ generatedAt, rotation, items: randomPool }, null, 2) + '\n');

console.log(`Built ${recent.length} recent memos and ${randomPool.length} random memos for ${rotation}.`);
