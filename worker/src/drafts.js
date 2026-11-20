/**
 * Drafts → Beta 单向导入。
 *
 * 只做一件事：把 iOS Drafts 里的一篇文稿，安全地变成 Beta 草稿箱里的一篇草稿。
 * 之后的整理、配图、标签、发布，全部沿用原来那套，这里不碰 GitHub、不碰 R2。
 *
 * 为什么单独开一个接口和一个令牌
 * ──────────────────────────────
 * Drafts 的 Action 脚本跑在手机上，令牌存在 Drafts 的 Credential 里。给它
 * COMMENTS_ADMIN_TOKEN 等于把评论管理、图片删除、正式发文一起交出去。所以这里
 * 只认 DRAFTS_INTEGRATION_TOKEN，而且这个令牌除了本文件，别处一次都不比对 ——
 * 它换不到会话 Cookie，也进不了 /api/write/* 与 /api/comments/*。
 *
 * 判断顺序（顺序有讲究）
 * ────────────────────
 * 先问「Beta 端有没有被改过」，再问「Drafts 内容变没变」。反过来写会留下一条静默
 * 路径：Beta 已经改过，而 Drafts 这次发的还是上次的内容 —— 先比 Drafts 指纹就直接
 * unchanged，看着像成功，其实两端早就分叉了。现在的顺序：
 *   1. 墓碑 / 已发布 → 409
 *   2. Beta 当前内容指纹 ≠ source_hash → 409 冲突（不管 Drafts 变没变）
 *   3. Drafts 指纹 == source_hash → unchanged
 *   4. 只剩「Drafts 变了、Beta 没变」→ 更新
 *
 * 为什么不用时间判断
 * ────────────────
 * 手机和 Worker 的时钟对不上是常态，拿时间比大小会同时产生两种错误：明明没人改动
 * 却报冲突，或者改过却被悄悄覆盖。这里只比内容指纹（source_hash 是上次导入时
 * 标题+正文的 SHA-256），跟任何一端的时钟无关。
 *
 * 并发怎么做
 * ────────
 * 「先查、再判断、再写」本身不是原子的：两个请求同时读到同一份旧状态，都认为
 * 「Beta 没动过」，后写的那个就会把先写的盖掉。所以写回时带上内容条件（CAS）：
 *   UPDATE ... WHERE id=? AND deleted_at=0 AND source_hash=? AND title=? AND body=?
 * changes=0 说明这一瞬间被别人改过了 —— 一次请求只允许写一次，绝不「重试到成功」：
 * 重读之后只判 unchanged 还是冲突，实在判不出就返回 concurrent_update 让客户端重发。
 * 否则旧快照就有机会盖掉刚写进去的新内容。
 * 首次创建用 INSERT ... ON CONFLICT(id) DO NOTHING，撞车不抛异常、不产生重复行。
 *
 * id 为什么是 dr- + uuid
 * ────────────────────
 * 草稿 id 就是主键，用它当幂等键最省事：同一份 Drafts 文稿永远算出同一个 id，
 * 网络重试、连续点两次都只会有一行。加 dr- 前缀是让它和 Beta 本机生成的 d… 分开。
 *
 * 软删的行留着不删。墓碑（deleted_at > 0）是「用户在 Beta 主动删了」的唯一证据，
 * 物理删除之后，下一次发送就会当成新草稿重新建出来 —— 那正是要避免的事。
 */

import { fail, json, sha256, timingSafeEqual } from './util.js';
import { ensureSchema, first, run } from './db.js';

const SOURCE = 'drafts';
const ID_PREFIX = 'dr-';
// 和 write.js 里的草稿上限保持一致：超过这条线的正文本来也同步不出去
const BODY_LIMIT = 200000;
// JSON 转义之后可能比正文大一圈，请求体单独给一个更宽的口子
const REQUEST_LIMIT = 400000;
const TITLE_LIMIT = 300;

// 频率限制：一个窗口内最多多少次、总共多少字符（按请求体算，含 JSON 转义）
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_HITS = 30;
const RATE_MAX_UNITS = 1000000;
// 只留最近几个窗口，表里永远只有几行
const RATE_KEEP_BUCKETS = 10;

// Drafts 的 uuid 是 36 位带连字符的十六进制；不带连字符的 32 位也认，统一归一化
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const COLUMNS =
  'id, title, body, edit_path, published_at, created_at, updated_at, deleted_at, source, source_id, source_hash';

/**
 * 内容指纹。
 *
 * 用 JSON 数组序列化再哈希，而不是 `title + "\n" + body`：后者在标题自身带换行、
 * 或标题尾部与正文开头能拼出同一串时有歧义（("a","b\nc") 与 ("a\nb","c") 会撞成
 * 同一个指纹）。JSON.stringify 会转义引号、反斜杠和换行，数组边界因此没有歧义。
 */
function contentHash(title, body) {
  return sha256(JSON.stringify([String(title), String(body)]));
}

/**
 * 文本归一：只统一换行符、去掉 NUL。
 * 不动 Markdown 的任何标记、缩进和空行 —— 正文是用户写的，服务端不排版。
 */
function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '');
}

/** 统一成 8-4-4-4-12 的小写形式：两种写法（带/不带连字符）落到同一个 id。 */
function canonicalUuid(raw) {
  const hex = String(raw).replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 冲突回执里给一小段 Beta 侧正文，够人认出是哪一篇就行，别把整篇文章塞回去。 */
function excerpt(text, limit = 140) {
  const plain = String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*`|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

/** Authorization: Bearer xxx；也认 x-drafts-token，方便用 curl 调试。 */
function providedToken(request) {
  const bearer = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return bearer || String(request.headers.get('x-drafts-token') || '').trim();
}

/**
 * 记一次调用，返回这个窗口内的累计量。
 * 自增与读取分两条语句：自增是原子的（ON CONFLICT DO UPDATE），读到的计数可能比
 * 真实值慢一两个请求 —— 对限流来说这点误差没关系，换来的是不依赖 RETURNING。
 */
async function chargeQuota(env, fingerprint, units) {
  const bucket = Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS);
  await run(
    env,
    `INSERT INTO integration_rates (token_fp, bucket, hits, units) VALUES (?, ?, 1, ?)
     ON CONFLICT(token_fp, bucket) DO UPDATE SET hits = hits + 1, units = units + excluded.units`,
    [fingerprint, bucket, units]
  );
  const row = await first(
    env,
    'SELECT hits, units FROM integration_rates WHERE token_fp = ? AND bucket = ?',
    [fingerprint, bucket]
  );
  // 顺手清掉老窗口；表里最多十几行，这条 DELETE 走不走索引都无所谓
  await run(env, 'DELETE FROM integration_rates WHERE bucket < ?', [bucket - RATE_KEEP_BUCKETS]);
  return {
    hits: Number((row && row.hits) || 0),
    units: Number((row && row.units) || 0),
  };
}

function rateLimited(counter) {
  const wait = RATE_WINDOW_SECONDS - (Math.floor(Date.now() / 1000) % RATE_WINDOW_SECONDS);
  const byHits = counter.hits > RATE_MAX_HITS;
  return json(
    {
      ok: false,
      error: {
        code: 'rate_limited',
        message: byHits
          ? `一分钟内发得太勤了（${counter.hits}/${RATE_MAX_HITS} 次），${wait} 秒后再试`
          : `一分钟内发得太多了（${counter.units}/${RATE_MAX_UNITS} 字符），${wait} 秒后再试`,
      },
      retryAfter: wait,
    },
    429,
    { 'Retry-After': String(wait) }
  );
}

/**
 * POST /api/integrations/drafts
 * { source: "drafts", sourceId: "文稿UUID", title: "标题", body: "Markdown 正文" }
 *
 * 200 created / 200 updated / 200 unchanged —— 三种都是「服务端确认过了，可以报成功」。
 * 401 令牌不对，409 冲突（已删 / 已发布 / Beta 改过 / 并发），413 正文超长，
 * 429 发得太勤，5xx 服务端问题。
 */
export async function handleDraftsImport(request, env) {
  const expected = String(env.DRAFTS_INTEGRATION_TOKEN || '').trim();
  if (!expected) {
    return fail(
      503,
      'integration_not_configured',
      '还没配置 Drafts 集成令牌：npx wrangler secret put DRAFTS_INTEGRATION_TOKEN'
    );
  }
  const given = providedToken(request);
  if (!given || !timingSafeEqual(given, expected)) {
    // 只回一句人话，绝不回显令牌；下面的日志也只写指纹
    return fail(401, 'unauthorized', '令牌不对：检查 Drafts 里保存的 Token 是否与 Worker Secret 一致');
  }

  const text = await request.text();
  if (!text) return fail(400, 'bad_json', '请求体是空的');
  if (text.length > REQUEST_LIMIT) {
    return fail(413, 'body_too_large', `正文太长，这一篇发不出去（上限约 ${BODY_LIMIT} 字）`);
  }

  await ensureSchema(env);

  // 指纹只用于记账和日志，反推不出令牌本身
  const fingerprint = (await sha256(expected)).slice(0, 16);
  const quota = await chargeQuota(env, fingerprint, text.length);
  if (quota.hits > RATE_MAX_HITS || quota.units > RATE_MAX_UNITS) {
    console.warn('[drafts] rate limited', fingerprint, quota.hits, quota.units);
    return rateLimited(quota);
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail(400, 'bad_json', '请求体不是合法的 JSON');
  }
  if (!payload || typeof payload !== 'object') return fail(400, 'bad_json', '请求体格式不对');

  const source = String(payload.source || '').trim().toLowerCase();
  if (source !== SOURCE) {
    // 留着这道门，将来接别的来源时不会误用一个来源的令牌写另一个来源的草稿
    return fail(400, 'bad_source', `source 只能是 "${SOURCE}"`);
  }

  const rawId = String(payload.sourceId || '').trim();
  if (!UUID_RE.test(rawId)) {
    return fail(400, 'bad_source_id', 'sourceId 必须是 Drafts 文稿的 UUID（8-4-4-4-12 十六进制）');
  }
  const sourceId = canonicalUuid(rawId);

  const title = normalizeText(payload.title).trim();
  if (!title) return fail(400, 'title_required', '标题是空的：第一行留一句标题再发');
  if (title.length > TITLE_LIMIT) {
    return fail(400, 'title_too_long', `标题 ${title.length} 字，超过 ${TITLE_LIMIT} 字上限`);
  }

  // 正文只归一换行符，不 trim、不补空行、不动任何标记
  const body = normalizeText(payload.body);
  if (body.length > BODY_LIMIT) {
    return fail(413, 'body_too_large', `正文 ${body.length} 字，超过 ${BODY_LIMIT} 字上限（Beta 草稿同步也是这条线）`);
  }

  const id = ID_PREFIX + sourceId;
  const incoming = await contentHash(title, body);

  /* ------------------------- 读 → 判断 → 条件写 ------------------------- */

  const readRow = () => first(env, `SELECT ${COLUMNS} FROM write_drafts WHERE id = ?`, [id]);

  /**
   * 终态判断。返回 Response 就到此为止；返回 null 表示「Drafts 变了、Beta 没变」，
   * 可以继续往下写 —— 但这只在第一次读的时候允许（allowWrite=true）。
   * 条件写失败之后重读的那一轮，allowWrite=false：说明别人刚写过，这时候再写一次
   * 就等于拿旧快照去盖新内容，宁可让客户端重发。
   */
  const settle = async (row, allowWrite) => {
    // id 是推导出来的，撞上 Beta 自己的草稿几乎不可能；真撞了就别动手
    if (String(row.source || '') !== SOURCE) {
      return fail(409, 'id_conflict', '这个 id 已经被另一篇草稿占用，没有写入任何内容');
    }

    // 用户已经在 Beta 删掉了：不能因为 uuid 还在就把它复活
    if (Number(row.deleted_at || 0) > 0) {
      return fail(
        409,
        'draft_deleted',
        '这篇草稿已经在 Beta 删除；为免误恢复，Drafts 不会再写回来。要重新收进来，请在 Drafts 里复制成一篇新文稿再发'
      );
    }

    // 已经发布：published_at 或 edit.path 任一存在都算，两道都看更稳
    if (Number(row.published_at || 0) > 0 || row.edit_path) {
      return fail(
        409,
        'draft_published',
        '这篇已经发布成正式文章；为避免动到线上内容，Drafts 不再改它。要接着写请在 Beta 里直接开新草稿'
      );
    }

    // 第一步：Beta 端的内容和上次导入时不一样，就是被改过 —— 不管 Drafts 变没变
    const betaHash = await contentHash(row.title, row.body);
    if (!row.source_hash || betaHash !== row.source_hash) {
      const draftsChanged = incoming !== row.source_hash;
      return json(
        {
          ok: false,
          error: {
            code: 'draft_conflict',
            message: draftsChanged
              ? 'Beta 里这篇草稿已经被改过，这次没有覆盖它；请在 Beta 里自己合并两边的内容'
              : 'Beta 里这篇草稿已经被改过，Drafts 这次发的内容和上次一样，所以什么都没写',
          },
          conflict: {
            id,
            reason: draftsChanged ? 'both_modified' : 'beta_modified',
            beta: {
              title: row.title || '',
              excerpt: excerpt(row.body),
              updatedAt: Number(row.updated_at || 0),
            },
            incoming: { title, length: body.length },
            hint: draftsChanged
              ? 'Beta 里的版本原样保留，Drafts 里的这篇也没动。要整篇替换，请在 Beta 里删掉旧草稿后重新发送（会当成新草稿）'
              : 'Beta 里的修改保留着，不用重发；要接着用 Drafts 的内容，先在 Beta 里删掉这篇草稿',
          },
        },
        409
      );
    }

    // 第二步：Drafts 和上次发的完全一样，就什么都不做（网络重试、连点两次走这条）
    if (incoming === row.source_hash) {
      return json({
        ok: true,
        status: 'unchanged',
        id,
        title: row.title || '',
        updatedAt: Number(row.updated_at || 0),
        serverTime: Date.now(),
      });
    }

    if (allowWrite) return null;

    // 读到的是别人刚写完的状态，内容和我们要写的又不一样：不覆盖，让客户端重发
    console.warn('[drafts] write race lost', fingerprint, id);
    return fail(409, 'concurrent_update', '这篇草稿刚被另一处写入，这次没有覆盖它，请再发一次');
  };

  let row = await readRow();

  if (!row) {
    const now = Date.now();
    const created = await run(
      env,
      `INSERT INTO write_drafts
         (id, title, body, tags, slug, edit_path, edit_name, edit_url,
          published_at, created_at, updated_at, deleted_at,
          source, source_id, source_hash, source_at)
       VALUES (?, ?, ?, '[]', '', NULL, NULL, NULL, 0, ?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [id, title, body, now, now, SOURCE, sourceId, incoming, now]
    );
    if (created.changes) {
      return json({ ok: true, status: 'created', id, title, updatedAt: now, serverTime: now }, 201);
    }
    // 同一瞬间另一个请求先插进去了：退一步，按它写下的状态判断，不覆盖
    row = await readRow();
    if (!row) {
      console.warn('[drafts] insert raced and vanished', fingerprint, id);
      return fail(409, 'concurrent_update', '这篇草稿刚被另一处写入，这次没有覆盖它，请再发一次');
    }
    return (await settle(row, false))
      || fail(409, 'concurrent_update', '这篇草稿刚被另一处写入，这次没有覆盖它，请再发一次');
  }

  const stop = await settle(row, true);
  if (stop) return stop;

  // 只剩「Drafts 变了、Beta 没变」。带上读到的内容做条件写：这一瞬间被改过就写不进去
  const now = Date.now();
  const updated = await run(
    env,
    `UPDATE write_drafts
        SET title = ?, body = ?, updated_at = ?, source_hash = ?, source_at = ?
      WHERE id = ? AND deleted_at = 0 AND source_hash IS ? AND title IS ? AND body IS ?`,
    [title, body, now, incoming, now, id, row.source_hash, row.title, row.body]
  );
  if (updated.changes) {
    return json({ ok: true, status: 'updated', id, title, updatedAt: now, serverTime: now });
  }

  // 条件没命中：这一瞬间别人动过。重读一次，只判 unchanged / 冲突，不再写
  const fresh = await readRow();
  if (!fresh) {
    console.warn('[drafts] cas lost and vanished', fingerprint, id);
    return fail(409, 'concurrent_update', '这篇草稿刚被另一处写入，这次没有覆盖它，请再发一次');
  }
  return (await settle(fresh, false))
    || fail(409, 'concurrent_update', '这篇草稿刚被另一处写入，这次没有覆盖它，请再发一次');
}
