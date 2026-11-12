/**
 * 单条合并用的纯函数：把一条 Memo 的改动落到已有的 memos.json 上。
 *
 * 这些函数不碰文件、不发请求，方便单测；fetch-memos.js 负责 IO。
 * 关键约束：
 *   - id 全局唯一，重复 id 保留最后写入的版本；
 *   - 结果永远按 createdTs 降序，与全量同步的产物同构；
 *   - 幂等：同一事件重复执行结果不变。
 */

const ID_RE = /^[A-Za-z0-9._~-]{1,64}$/;

/** `memos/1276` → `1276`；非法 id 返回空串，调用方应当据此拒绝写入。 */
export function normalizeMemoId(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const bare = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return ID_RE.test(bare) ? bare : '';
}

/** 按 id 覆盖或追加一条记录，返回新数组（不改原数组）。 */
export function upsertMemo(list, entry) {
  const id = normalizeMemoId(entry?.id);
  if (!id) throw new Error('memo entry 缺少合法 id');
  const next = Array.isArray(list) ? list.slice() : [];
  const at = next.findIndex(memo => normalizeMemoId(memo?.id) === id);
  if (at >= 0) next[at] = entry;
  else next.push(entry);
  return next;
}

/** 删除指定 id，返回新数组；id 不存在时原样返回。 */
export function removeMemo(list, id) {
  const target = normalizeMemoId(id);
  if (!target) throw new Error('removeMemo 需要合法 id');
  return (Array.isArray(list) ? list : []).filter(
    memo => normalizeMemoId(memo?.id) !== target,
  );
}

/**
 * 去重 + 按 createdTs 降序。
 *
 * 去重保留「最后出现」的版本：`upsertMemo` 把新版本放在原位，所以同一条
 * 记录反复更新不会被排到别处；历史文件里万一有重复 id，也收敛成一条。
 */
export function sortMemos(list) {
  const byId = new Map();
  (Array.isArray(list) ? list : []).forEach(memo => {
    const id = normalizeMemoId(memo?.id);
    if (!id) return;
    if (byId.has(id)) byId.delete(id);
    byId.set(id, memo);
  });
  return [...byId.values()].sort(
    (a, b) => Number(b.createdTs || 0) - Number(a.createdTs || 0),
  );
}

/** 这条哔哔是否参与影彩（视频）页，决定单条同步要不要跑 B 站抓取。 */
export function hasVideoTag(entry) {
  if (!entry) return false;
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  if (tags.some(tag => String(tag).includes('影彩'))) return true;
  return String(entry.content ?? '').includes('#影彩');
}
