import { batch, ensureSchema, first, run, all } from './db.js';
import {
  levelFor,
  md5,
  normalizeThreadKey,
  normalizeWebsite,
  parseUserAgent,
  sha256,
  spamScore,
} from './util.js';

const DEFAULT_COMMENTS_PAGE = 200;
const MAX_COMMENTS_PAGE = 500;
// 频率限制是唯一挡在前面的东西（没有审核队列兜底了），所以给两道：
// 一道短的挡住连发脚本，一道长的挡住慢慢刷的机器人。
const RATE_WINDOW_SECONDS = 30;
const RATE_MAX_IN_WINDOW = 3;
const RATE_HOUR_WINDOW_SECONDS = 3600;
const RATE_MAX_PER_HOUR = 10;
const DUPLICATE_WINDOW_SECONDS = 600;
// 垃圾分到这条线就直接丢掉，不进库也不进审核队列
const SPAM_DROP_SCORE = 5;

// 随机凭据：只回给提交人，不进公开列表
function randomToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/* ------------------------------ 读取：评论列表 ------------------------------ */

/**
 * 评论列表：没有审核队列，写进来就是公开的，这里只取 approved。
 * status 里还留着 pending，是为了兼容去掉审核之前的历史数据（启动时会被一次性放行）。
 * @param {object} options
 * @param {string} options.threadKey
 */
export async function listComments(env, { threadKey, limit = DEFAULT_COMMENTS_PAGE, offset = 0 }) {
  await ensureSchema(env);
  const key = normalizeThreadKey(threadKey);
  if (!key) return { thread: null, comments: [], count: 0, pendingCount: 0 };

  const pageLimit = Math.min(Math.max(Number(limit) || DEFAULT_COMMENTS_PAGE, 1), MAX_COMMENTS_PAGE);
  const pageOffset = Math.max(Number(offset) || 0, 0);

  const columns = `id, parent_id, root_id, nick, email_hash, website, content, ua, region,
                   status, is_admin, created_at`;

  // 时间倒序取最近的若干条（列表展示时顶层还会再倒序一次）
  const rows = await all(
    env,
    `SELECT ${columns}
       FROM comments
      WHERE thread_key = ? AND status = 'approved'
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [key, pageLimit, pageOffset]
  );

  const thread = await first(env, `SELECT key, url, title FROM threads WHERE key = ?`, [key]);
  const totalRow = await first(
    env,
    `SELECT COUNT(*) AS c FROM comments WHERE thread_key = ? AND status = 'approved'`,
    [key]
  );
  const total = Number(totalRow ? totalRow.c : 0);

  // 以邮箱哈希为键统计历史评论数，用于等级徽章
  const hashes = [...new Set(rows.map((r) => r.email_hash).filter(Boolean))];
  let countsByHash = {};
  if (hashes.length) {
    // D1 每条 SQL 最多 100 个绑定参数；分块后大楼层也不会因参数过多而报错。
    for (let i = 0; i < hashes.length; i += 90) {
      const chunk = hashes.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      const stats = await all(
        env,
        `SELECT email_hash, COUNT(*) AS c
           FROM comments
          WHERE status = 'approved' AND email_hash IN (${placeholders})
          GROUP BY email_hash`,
        chunk
      );
      for (const stat of stats) countsByHash[stat.email_hash] = Number(stat.c);
    }
  }

  const items = rows.map((row) => serialize(row, countsByHash));
  return {
    thread: thread
      ? { key: thread.key, url: thread.url, title: thread.title }
      : { key, url: null, title: null },
    comments: items,
    count: total,
    loadedCount: items.length,
    offset: pageOffset,
    hasMore: pageOffset + items.length < total,
    // 审核队列已经没了，字段留着是为了不破坏老前端的解析
    pendingCount: 0,
  };
}

/**
 * 原子滑动窗口限流：计数判断和事件插入在同一条 SQL 里。
 * D1 会串行执行写语句，并发请求无法像“先 SELECT、再 INSERT”那样一起穿透。
 */
export async function consumeRateLimit(
  env,
  { actorHash, shortSeconds = RATE_WINDOW_SECONDS, shortMax = RATE_MAX_IN_WINDOW,
    longSeconds = RATE_HOUR_WINDOW_SECONDS, longMax = RATE_MAX_PER_HOUR } = {}
) {
  await ensureSchema(env);
  if (!actorHash) return { ok: true };
  const now = nowSeconds();
  const nonce = randomToken();
  const inserted = await first(
    env,
    `INSERT INTO comment_rate_events (actor_hash, created_at, nonce)
       SELECT ?, ?, ?
        WHERE (SELECT COUNT(*) FROM comment_rate_events
                WHERE actor_hash = ? AND created_at > ?) < ?
          AND (SELECT COUNT(*) FROM comment_rate_events
                WHERE actor_hash = ? AND created_at > ?) < ?
       RETURNING nonce`,
    [
      actorHash, now, nonce,
      actorHash, now - shortSeconds, shortMax,
      actorHash, now - longSeconds, longMax,
    ]
  );

  if (inserted && inserted.nonce) {
    if (Math.random() < 0.02) {
      try {
        await run(env, `DELETE FROM comment_rate_events WHERE created_at < ?`, [now - 86400]);
      } catch {
        /* 清理失败不影响限流 */
      }
    }
    return { ok: true };
  }

  const recent = await first(
    env,
    `SELECT COUNT(*) AS c FROM comment_rate_events WHERE actor_hash = ? AND created_at > ?`,
    [actorHash, now - shortSeconds]
  );
  return {
    ok: false,
    code: 'rate_limited',
    message: Number(recent && recent.c) >= shortMax
      ? '发言太快了，歇一会儿再来吧'
      : '这一小时说得够多了，喝口水再来吧',
    status: 429,
  };
}

function serialize(row, countsByHash) {
  const ua = parseUserAgent(row.ua);
  const historyCount = row.email_hash ? countsByHash[row.email_hash] || 1 : 1;
  return {
    id: Number(row.id),
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    rootId: row.root_id == null ? null : Number(row.root_id),
    nick: row.nick,
    emailHash: row.email_hash || '',
    hasEmail: Boolean(row.email_hash),
    website: row.website || '',
    content: row.content,
    createdAt: Number(row.created_at),
    status: row.status,
    pending: row.status === 'pending',
    isAdmin: Boolean(row.is_admin),
    browser: ua.browser,
    os: ua.os,
    region: row.region || '',
    level: levelFor(historyCount),
  };
}

/* ------------------------------ 读取：评论计数 ------------------------------ */

export async function countComments(env, threadKeys = []) {
  await ensureSchema(env);
  const keys = [...new Set(threadKeys.map(normalizeThreadKey).filter(Boolean))];
  if (!keys.length) return {};

  const placeholders = keys.map(() => '?').join(',');
  const rows = await all(
    env,
    `SELECT thread_key, COUNT(*) AS c
       FROM comments
      WHERE status = 'approved' AND thread_key IN (${placeholders})
      GROUP BY thread_key`,
    keys
  );

  const result = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const row of rows) result[row.thread_key] = Number(row.c);
  return result;
}

/* ------------------------------- 写入：新评论 ------------------------------- */

export async function createComment(env, input, context = {}) {
  await ensureSchema(env);

  const threadKey = normalizeThreadKey(input.threadKey);
  if (!threadKey) {
    return { ok: false, code: 'thread_required', message: '缺少评论目标', status: 400 };
  }

  const ip = context.ip || '';
  const ipHash = ip ? await sha256(`${ip}|${env.COMMENTS_SALT || 'comments-salt'}`) : '';
  const now = nowSeconds();
  const limited = await consumeRateLimit(env, { actorHash: ipHash });
  if (!limited.ok) return limited;

  // 蜜罐被填写：机器人，假装成功但不落库（请求仍然计入频率限制）
  if (input.honeypot) {
    return { ok: true, spam: true, comment: null, message: '已提交' };
  }

  // 打开页面不到 2 秒就提交：几乎可以肯定是脚本
  if (input.elapsed && input.elapsed > 0 && input.elapsed < 2000) {
    return { ok: true, spam: true, comment: null, message: '已提交' };
  }

  // 没有审核队列了，垃圾只能当场拦：够分的直接当没收到，不进库也不提示，
  // 机器人拿不到反馈，正常访客被误判的概率也远低于排队等人放行。
  if (spamScore(input) >= SPAM_DROP_SCORE) {
    return { ok: true, spam: true, comment: null, message: '已提交' };
  }

  const duplicate = await first(
    env,
    `SELECT id FROM comments
      WHERE thread_key = ? AND content = ? AND created_at > ?
      LIMIT 1`,
    [threadKey, input.content, now - DUPLICATE_WINDOW_SECONDS]
  );
  if (duplicate) {
    return { ok: false, code: 'duplicate', message: '这条内容刚刚已经发过了', status: 409 };
  }

  // 回复目标校验
  let parentId = null;
  let rootId = null;
  let parentRow = null;
  if (input.parentId) {
    parentRow = await first(
      env,
      `SELECT id, root_id, thread_key, email, email_hash, nick, status, notify, notify_token,
              content, is_admin, created_at
         FROM comments WHERE id = ?`,
      [input.parentId]
    );
    if (!parentRow || parentRow.thread_key !== threadKey || parentRow.status !== 'approved') {
      return { ok: false, code: 'parent_invalid', message: '回复的评论不存在', status: 400 };
    }
    parentId = Number(parentRow.id);
    // 只保留两层：对回复的回复自动拍平到顶层评论下
    rootId = parentRow.root_id == null ? Number(parentRow.id) : Number(parentRow.root_id);
    if (Number(parentRow.notify) !== 0 && !parentRow.notify_token) {
      parentRow.notify_token = randomToken();
      await run(env, `UPDATE comments SET notify_token = ? WHERE id = ?`, [
        parentRow.notify_token,
        parentId,
      ]);
    }
  }

  const emailHash = input.email ? md5(input.email.trim().toLowerCase()) : '';
  const adminEmail = String(env.COMMENTS_ADMIN_EMAIL || '').trim().toLowerCase();
  const inputEmail = String(input.email || '').trim().toLowerCase();
  // 邮箱是谁都能填的，不能当凭据；口令是凭据，但不能"进了管理模式就自动是博主"。
  // 两个都得对上：口令 + 邮箱 == COMMENTS_ADMIN_EMAIL，才算博主。
  const hasToken = Boolean(context.admin);
  const emailMatchesAdmin = Boolean(adminEmail && inputEmail && inputEmail === adminEmail);
  const isAdmin = hasToken && emailMatchesAdmin;
  // 填了博主邮箱但没口令 —— 冒充者。没有审核可压，就按普通访客存：
  // 反正「博主」标只认 is_admin，光填对邮箱什么也拿不到。

  // 改稿凭据：每条都发一把，只回给提交人。客人在 1 分钟内可以改自己的错别字，
  // 过期后只能由博主改（服务端按时间判断，前端只管藏不藏按钮）。
  const editToken = randomToken();
  const notifyToken = input.notify ? randomToken() : '';
  const region = context.region || '';
  const ua = context.ua || '';
  const website = input.website || '';
  const threadUrl = safeThreadUrl(env, threadKey, input.threadUrl);

  await run(
    env,
    `INSERT INTO threads (key, url, title, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            url = COALESCE(excluded.url, threads.url),
            title = COALESCE(excluded.title, threads.title),
            updated_at = excluded.updated_at`,
    [threadKey, threadUrl || null, input.threadTitle || null, now]
  );

  const inserted = await run(
    env,
    `INSERT INTO comments
       (thread_key, parent_id, root_id, nick, email, email_hash, website, content, ua, region,
        ip_hash, status, is_admin, notify, edit_token, notify_token, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`,
    [
      threadKey,
      parentId,
      rootId,
      input.nick,
      input.email || null,
      emailHash || null,
      website || null,
      input.content,
      ua || null,
      region || null,
      ipHash || null,
      isAdmin ? 1 : 0,
      input.notify ? 1 : 0,
      editToken,
      notifyToken || null,
      now,
      now,
    ]
  );

  const row = await first(
    env,
    `SELECT id, parent_id, root_id, nick, email_hash, website, content, ua, region, status, is_admin, created_at
       FROM comments WHERE id = ?`,
    [inserted.lastId]
  );

  return {
    ok: true,
    editToken,
    comment: row ? serialize(row, {}) : null,
    thread: { key: threadKey, url: threadUrl || null, title: input.threadTitle || null },
    notify: {
      enabled: Boolean(input.notify) && Boolean(input.email),
      adminEmail: env.COMMENTS_ADMIN_EMAIL || '',
      parentEmail: parentRow ? parentRow.email || '' : '',
      parentWantsNotify: parentRow ? Number(parentRow.notify) !== 0 : false,
      parentNotifyToken: parentRow ? parentRow.notify_token || '' : '',
      parentNick: parentRow ? parentRow.nick : '',
      // 邮件里要展示「原评论」引用块，所以把内容和时间一并带出去
      parentContent: parentRow ? parentRow.content || '' : '',
      parentCreatedAt: parentRow ? Number(parentRow.created_at) || 0 : 0,
      parentIsAdmin: parentRow ? Number(parentRow.is_admin) === 1 : false,
      parentId,
    },
    ip: ipHash,
  };
}

function safeThreadUrl(env, threadKey, submitted) {
  const originRaw = String(env.COMMENTS_SITE_URL || 'https://hux.ink').replace(/\/+$/, '');
  let origin;
  try {
    origin = new URL(originRaw);
  } catch {
    return '';
  }

  const raw = String(submitted || '').trim();
  if (raw) {
    try {
      const parsed = new URL(raw, origin);
      if (/^https?:$/.test(parsed.protocol) && parsed.origin === origin.origin) return parsed.href;
    } catch {
      /* 退回服务端派生地址 */
    }
  }

  let path = '/';
  if (threadKey.startsWith('memo:')) path = `/m/${threadKey.slice(5)}/`;
  else if (threadKey.startsWith('post:')) path = threadKey.slice(5);
  else if (threadKey.startsWith('page:')) path = threadKey.slice(5);
  try {
    return new URL(path || '/', origin).href;
  } catch {
    return origin.href;
  }
}

/* -------------------------------- 改自己的评论 ------------------------------- */

/* 客人能改自己 1 分钟内发的评论（错别字），博主任何时候都能改任何一条。
   凭据是建这条评论时回给提交人的 edit_token，不进公开列表。
   博主名下的评论不认这把 token —— 想改自己漏的字，必须先进管理模式。 */
const EDIT_WINDOW = 60;

export async function editComment(env, { id, content, token = '', admin = false } = {}) {
  await ensureSchema(env);
  const commentId = Number(id);
  if (!commentId) return { ok: false, status: 400, code: 'id_required', message: '缺少评论 id' };

  const text = String(content || '').trim();
  if (!text) return { ok: false, status: 400, code: 'content_required', message: '内容不能为空' };
  if (text.length > 500) return { ok: false, status: 400, code: 'content_too_long', message: '评论最多 500 字' };

  const row = await first(
    env,
    `SELECT id, thread_key, status, edit_token, is_admin, created_at FROM comments WHERE id = ?`,
    [commentId]
  );
  if (!row) return { ok: false, status: 404, code: 'not_found', message: '评论不存在' };
  if (row.status === 'deleted') {
    return { ok: false, status: 400, code: 'deleted', message: '这条评论已被删除' };
  }

  let allowed = admin;
  if (!allowed) {
    // 「博主」名下的评论只认管理口令：浏览器里留着的那把 edit_token 不改带博主标识的内容
    if (Number(row.is_admin) === 1) {
      return {
        ok: false,
        status: 403,
        code: 'admin_only',
        message: '这条是博主发的，要先进入管理模式才能改',
      };
    }
    const provided = String(token || '');
    const candidates = [row.edit_token].filter(Boolean).map(String);
    allowed = candidates.some((candidate) => candidate && candidate === provided);
    if (allowed && Date.now() / 1000 - Number(row.created_at || 0) > EDIT_WINDOW) {
      return { ok: false, status: 403, code: 'edit_window_closed', message: '超过 1 分钟就不能自己改了，让博主帮你改' };
    }
  }
  if (!allowed) return { ok: false, status: 403, code: 'forbidden', message: '没有权限修改这条评论' };

  await run(env, `UPDATE comments SET content = ?, updated_at = ? WHERE id = ?`, [
    text,
    nowSeconds(),
    commentId,
  ]);

  const updated = await first(
    env,
    `SELECT id, parent_id, root_id, thread_key, nick, email_hash, website, content, ua, region, status, is_admin, created_at
       FROM comments WHERE id = ?`,
    [commentId]
  );

  return {
    ok: true,
    edited: true,
    comment: updated ? serialize(updated, {}) : null,
    threadKey: row.thread_key,
  };
}

/* ------------------------------ 管理：列表与操作 ----------------------------- */

// 没有审核队列了，默认就给全部；status 参数留着，需要时仍可筛 spam / deleted
export async function adminList(env, { status = 'all', threadKey = '', limit = 50, offset = 0 }) {
  await ensureSchema(env);
  const where = [];
  const args = [];
  if (status && status !== 'all') {
    where.push('status = ?');
    args.push(status);
  }
  if (threadKey) {
    where.push('thread_key = ?');
    args.push(normalizeThreadKey(threadKey));
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await all(
    env,
    `SELECT id, thread_key, parent_id, nick, email, website, content, ua, region, status, is_admin, created_at
       FROM comments ${clause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...args, Math.min(Number(limit) || 50, 200), Number(offset) || 0]
  );
  const total = await first(env, `SELECT COUNT(*) AS c FROM comments ${clause}`, args);
  return { rows, total: Number(total ? total.c : 0) };
}

export async function adminUpdate(env, { action, id, threadKey }) {
  await ensureSchema(env);
  if (action === 'approve' && id) {
    // 通过后清掉取回凭据，避免旧 token 继续命中
    await run(env, `UPDATE comments SET status = 'approved', pending_token = NULL WHERE id = ?`, [
      Number(id),
    ]);
    return { ok: true };
  }
  if ((action === 'spam' || action === 'delete') && id) {
    // 顶层评论被隐藏时，连带把它楼下的回复一起藏掉，避免留下无主的楼层；
    // 只隐藏某条回复时不牵连同楼的其他回复。
    const target = await first(env, `SELECT id, parent_id FROM comments WHERE id = ?`, [Number(id)]);
    if (!target) return { ok: false, message: '评论不存在' };
    const status = action === 'delete' ? 'deleted' : 'spam';
    const statements = [
      { sql: `UPDATE comments SET status = ? WHERE id = ?`, args: [status, Number(id)] },
    ];
    if (target.parent_id == null) {
      statements.push({
        sql: `UPDATE comments SET status = ? WHERE root_id = ?`,
        args: [status, Number(id)],
      });
    }
    await batch(env, statements);
    return { ok: true };
  }
  if (action === 'hard-delete' && id) {
    await batch(env, [
      { sql: `DELETE FROM comments WHERE root_id = ?`, args: [Number(id)] },
      { sql: `DELETE FROM comments WHERE id = ?`, args: [Number(id)] },
    ]);
    return { ok: true };
  }
  if (action === 'thread-delete' && threadKey) {
    await run(env, `DELETE FROM comments WHERE thread_key = ?`, [normalizeThreadKey(threadKey)]);
    return { ok: true };
  }
  return { ok: false, message: '未知操作' };
}

export async function unsubscribeComment(env, token) {
  await ensureSchema(env);
  const value = String(token || '').trim();
  if (!value || value.length > 120) return { ok: false, code: 'token_invalid' };
  const result = await run(
    env,
    `UPDATE comments SET notify = 0, notify_token = NULL WHERE notify_token = ?`,
    [value]
  );
  return { ok: result.changes > 0, changed: result.changes > 0 };
}

/* ------------------------------- 管理：批量导入 ------------------------------ */

/**
 * 用于从 Twikoo 迁移历史评论。保持原时间与状态，不触发反垃圾与通知。
 */
/* 把 parent_legacy_id 落实成真正的 parent_id。
   Twikoo 导出的顺序不是按时间排的，父评论完全可能比子评论晚一批到；
   分批提交时内存里的映射跨不过批次，所以每批收尾都按 parent_legacy_id
   把「还没接上」或「接错了」的条目重挂一次。已经对了就是空操作。 */
async function relinkFamilies(env) {
  let changed = 0;
  for (let round = 0; round < 2; round += 1) {
    const linked = await run(
      env,
      `UPDATE comments
          SET parent_id = (
                SELECT p.id FROM comments p
                 WHERE p.thread_key = comments.thread_key
                   AND p.legacy_id = comments.parent_legacy_id
                 LIMIT 1)
        WHERE parent_legacy_id IS NOT NULL AND parent_legacy_id <> ''
          AND IFNULL(parent_id, -1) <> IFNULL((
                SELECT p.id FROM comments p
                 WHERE p.thread_key = comments.thread_key
                   AND p.legacy_id = comments.parent_legacy_id
                 LIMIT 1), -1)`
    );
    // 父级挂对了，root_id 再顺着父级带正（回复的回复要往上找一层）
    const rooted = await run(
      env,
      `UPDATE comments
          SET root_id = (
                SELECT CASE WHEN p.root_id IS NULL THEN p.id ELSE p.root_id END
                  FROM comments p WHERE p.id = comments.parent_id)
        WHERE parent_id IS NOT NULL
          AND IFNULL(root_id, -1) <> IFNULL((
                SELECT CASE WHEN p.root_id IS NULL THEN p.id ELSE p.root_id END
                  FROM comments p WHERE p.id = comments.parent_id), -1)`
    );
    const touched = Number(linked.changes || 0);
    changed += touched;
    if (!touched && !Number(rooted.changes || 0)) break;
  }
  return changed;
}

export async function importComments(env, items = [], options = {}) {
  await ensureSchema(env);
  if (!Array.isArray(items) || !items.length) return { imported: 0, skipped: 0, repaired: 0 };

  // 父评论必须先落库才能映射 parentId，所以按创建时间升序处理——
  // 回复一定晚于被回复的那条，升序天然满足父子先后（同秒的保持原顺序）。
  //
  // 注意：Twikoo 的 _id 是 32 位 hex 字符串，**绝不能 Number() 化**。
  // 早先用 Number(oldId) 做 Map 键，Number('f479549b...') === NaN，
  // 于是所有 id 塌缩成同一个 NaN 键，每条回复的父级都指向"最后导入的那条"，
  // 楼层被整体带偏。这里一律用字符串当键。
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ta = Number(a.item.createdAt) || 0;
      const tb = Number(b.item.createdAt) || 0;
      return ta - tb || a.index - b.index;
    })
    .map((entry) => entry.item);

  const idMap = new Map();
  const idKey = (value) => (value == null ? '' : String(value).trim());
  let imported = 0;
  let skipped = 0;
  let repaired = 0;

  for (const item of sorted) {
    const threadKey = normalizeThreadKey(item.threadKey || item.url || '');
    const content = String(item.content || '').trim();
    const nick = String(item.nick || '匿名').trim().slice(0, 40);
    if (!threadKey || !content) {
      skipped += 1;
      continue;
    }

    const email = String(item.email || '').trim().toLowerCase();
    const emailHash = email ? md5(email) : '';
    const adminEmail = String(env.COMMENTS_ADMIN_EMAIL || '').trim().toLowerCase();
    // 显式带了 isAdmin（Twikoo 的 master 字段）就认它，否则退回按邮箱比对
    const isAdmin = item.isAdmin == null
      ? Boolean(adminEmail && email && email === adminEmail)
      : Boolean(item.isAdmin);
    const createdAt = Number(item.createdAt) || Math.floor(Date.now() / 1000);

    // 父级先算出来，dedupe 分支也要用：以前挂错的楼层重导一遍就能纠正
    const parentKey = idKey(item.parentOldId);
    let parentId = null;
    if (parentKey) {
      // 先查库：管理页按 50 条一批串行提交，父评论很可能落在上一批里，
      // 只靠内存里的 idMap 会接不上，回复就变成"凭空出现的新评论"。
      const legacyRow = await first(
        env,
        `SELECT id FROM comments WHERE thread_key = ? AND legacy_id = ? LIMIT 1`,
        [threadKey, parentKey]
      );
      if (legacyRow) parentId = legacyRow.id;
      else if (idMap.has(parentKey)) parentId = idMap.get(parentKey);
    }
    const parentRow = parentId
      ? await first(env, `SELECT root_id FROM comments WHERE id = ?`, [parentId])
      : null;
    const rootId = parentRow
      ? parentRow.root_id == null
        ? parentId
        : Number(parentRow.root_id)
      : null;

    // 重复导入同一份备份时跳过已经存在的条目（同线程 + 同秒 + 同昵称 + 同内容）
    if (options.dedupe) {
      const dup = await first(
        env,
        `SELECT id, parent_id, root_id FROM comments
          WHERE thread_key = ? AND created_at = ? AND nick = ? AND content = ? LIMIT 1`,
        [threadKey, createdAt, nick, content]
      );
      if (dup) {
        skipped += 1;
        const oldKey = idKey(item.oldId);
        if (oldKey) {
          // 补上老 id：父评论可能在上一批被跳过了，后面的回复要靠它找回来。
          // 两个字段都用 COALESCE 保留已有值，重导 N 遍也不会写坏。
          await run(
            env,
            `UPDATE comments
                SET legacy_id = COALESCE(NULLIF(legacy_id, ''), ?),
                    parent_legacy_id = COALESCE(NULLIF(parent_legacy_id, ''), ?)
              WHERE id = ?`,
            [oldKey, parentKey || null, dup.id]
          );
          idMap.set(oldKey, dup.id);
        }
        // 自愈：这条以前可能因为父级没解析对而挂错了楼层，重导一遍就地纠正
        if (parentId && (Number(dup.parent_id) !== Number(parentId) || Number(dup.root_id) !== Number(rootId))) {
          await run(env, `UPDATE comments SET parent_id = ?, root_id = ? WHERE id = ?`, [
            parentId,
            rootId,
            dup.id,
          ]);
          repaired += 1;
        }
        continue;
      }
    }

    await run(
      env,
      `INSERT INTO threads (key, url, title, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              url = COALESCE(excluded.url, threads.url),
              title = COALESCE(excluded.title, threads.title),
              updated_at = excluded.updated_at`,
      [threadKey, item.threadUrl || null, item.threadTitle || null, createdAt]
    );

    const inserted = await run(
      env,
      `INSERT INTO comments
         (thread_key, parent_id, root_id, nick, email, email_hash, website, content, ua, region,
          ip_hash, status, is_admin, notify, created_at, legacy_id, parent_legacy_id,
          like_count, is_top, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        threadKey,
        parentId,
        rootId,
        nick,
        email || null,
        emailHash || null,
        normalizeWebsite(item.website) || null,
        content,
        item.ua || null,
        item.region || null,
        null,
        // 导入的评论一律视为已发布：审核队列没了，旧数据里的 pending 也直接当通过
        item.status === 'spam' ? 'spam' : item.status === 'deleted' ? 'deleted' : 'approved',
        isAdmin ? 1 : 0,
        0,
        createdAt,
        item.oldId ? String(item.oldId) : null,
        parentKey || null,
        Math.max(0, Number(item.likeCount) || 0),
        item.isTop ? 1 : 0,
        Number(item.updatedAt) || createdAt,
      ]
    );

    const oldKey = idKey(item.oldId);
    if (oldKey) idMap.set(oldKey, inserted.lastId);
    imported += 1;
  }

  // 收尾：把因为父评论还没到而挂空的条目重新挂回去。
  // 注意不能只在"本批有回复"时才跑——父评论所在的那一批往往自己全是顶层，
  // 恰恰是那一批最需要把之前挂空的子评论接回来。
  const hasParentRefs = sorted.some((item) => idKey(item.parentOldId));
  const relinked = hasParentRefs || options.dedupe ? await relinkFamilies(env) : 0;

  return { imported, skipped, repaired: repaired + relinked };
}

/* --------------------------- 阅读量 / 点赞 --------------------------- */

// 会话凭据保留 30 天，过期后同一个人再来会重新计一次阅读
const VIEW_SESSION_TTL = 30 * 24 * 3600;

function visitorSalt(env) {
  return env.COMMENTS_SALT || 'comments-salt';
}

async function statsOf(env, key, visitorHash) {
  const row = await first(env, `SELECT views, likes FROM thread_stats WHERE thread_key = ?`, [key]);
  let liked = false;
  if (visitorHash) {
    const hit = await first(
      env,
      `SELECT 1 AS hit FROM likes WHERE thread_key = ? AND visitor_hash = ?`,
      [key, visitorHash]
    );
    liked = Boolean(hit);
  }
  return {
    views: Number(row ? row.views : 0),
    likes: Number(row ? row.likes : 0),
    liked,
  };
}

/**
 * 记一次阅读。
 * 同一个 session 对同一篇只记一次——刷新页面数字不会涨，
 * 服务端用 (thread_key, session_hash) 主键兜底，改前端也刷不出假数。
 */
export async function recordView(env, { threadKey, session, visitor }) {
  await ensureSchema(env);
  const key = normalizeThreadKey(threadKey);
  if (!key) return { ok: false, code: 'thread_required', message: '缺少阅读目标' };

  const now = nowSeconds();
  const salt = visitorSalt(env);
  let counted = false;

  if (session) {
    const sessionHash = await sha256(`view|${session}|${salt}`);
    const inserted = await run(
      env,
      `INSERT OR IGNORE INTO view_sessions (thread_key, session_hash, created_at)
            VALUES (?, ?, ?)`,
      [key, sessionHash, now]
    );
    counted = inserted.changes > 0;
  }

  if (counted) {
    await run(
      env,
      `INSERT INTO thread_stats (thread_key, views, likes, updated_at)
            VALUES (?, 1, 0, ?)
            ON CONFLICT(thread_key) DO UPDATE SET
              views = views + 1,
              updated_at = excluded.updated_at`,
      [key, now]
    );
    // 顺手清掉过期的会话记录，5% 概率触发，避免每次请求都扫表
    if (Math.random() < 0.05) {
      try {
        await run(env, `DELETE FROM view_sessions WHERE created_at < ?`, [now - VIEW_SESSION_TTL]);
      } catch {
        /* 清理失败不影响计数 */
      }
    }
  }

  const visitorHash = visitor ? await sha256(`like|${visitor}|${salt}`) : '';
  return { ok: true, counted, threadKey: key, ...(await statsOf(env, key, visitorHash)) };
}

/** 点赞 / 取消点赞，一个访客同一篇只算一次 */
export async function toggleLike(env, { threadKey, visitor, action = 'like' }) {
  await ensureSchema(env);
  const key = normalizeThreadKey(threadKey);
  if (!key) return { ok: false, code: 'thread_required', message: '缺少点赞目标' };
  if (!visitor) return { ok: false, code: 'visitor_required', message: '缺少访客标识' };

  const now = nowSeconds();
  const visitorHash = await sha256(`like|${visitor}|${visitorSalt(env)}`);

  if (action === 'unlike') {
    const removed = await run(
      env,
      `DELETE FROM likes WHERE thread_key = ? AND visitor_hash = ?`,
      [key, visitorHash]
    );
    if (removed.changes > 0) {
      await run(
        env,
        `UPDATE thread_stats SET likes = MAX(likes - 1, 0), updated_at = ? WHERE thread_key = ?`,
        [now, key]
      );
    }
  } else {
    const added = await run(
      env,
      `INSERT OR IGNORE INTO likes (thread_key, visitor_hash, created_at) VALUES (?, ?, ?)`,
      [key, visitorHash, now]
    );
    if (added.changes > 0) {
      await run(
        env,
        `INSERT INTO thread_stats (thread_key, views, likes, updated_at)
              VALUES (?, 0, 1, ?)
              ON CONFLICT(thread_key) DO UPDATE SET
                likes = likes + 1,
                updated_at = excluded.updated_at`,
        [key, now]
      );
    }
  }

  return { ok: true, threadKey: key, ...(await statsOf(env, key, visitorHash)) };
}

/** 批量读统计（列表页显示每条的阅读/点赞） */
export async function statsFor(env, { threads = [], visitor = '' }) {
  await ensureSchema(env);
  const keys = [...new Set(threads.map(normalizeThreadKey).filter(Boolean))].slice(0, 100);
  if (!keys.length) return {};

  const placeholders = keys.map(() => '?').join(',');
  const rows = await all(
    env,
    `SELECT thread_key, views, likes FROM thread_stats WHERE thread_key IN (${placeholders})`,
    keys
  );
  const result = Object.fromEntries(keys.map((k) => [k, { views: 0, likes: 0, liked: false }]));
  for (const row of rows) {
    result[row.thread_key] = {
      views: Number(row.views),
      likes: Number(row.likes),
      liked: false,
    };
  }

  if (visitor) {
    const visitorHash = await sha256(`like|${visitor}|${visitorSalt(env)}`);
    // visitorHash 也占一个绑定参数，所以线程按 99 个一组。
    for (let i = 0; i < keys.length; i += 99) {
      const chunk = keys.slice(i, i + 99);
      const marks = chunk.map(() => '?').join(',');
      const liked = await all(
        env,
        `SELECT thread_key FROM likes
          WHERE visitor_hash = ? AND thread_key IN (${marks})`,
        [visitorHash, ...chunk]
      );
      for (const row of liked) {
        if (result[row.thread_key]) result[row.thread_key].liked = true;
      }
    }
  }
  return result;
}

/* -------------------------------- 导出备份 -------------------------------- */

export async function exportAll(env, limit = 1000, offset = 0) {
  await ensureSchema(env);
  const threads = await all(env, `SELECT * FROM threads ORDER BY key`);
  const threadStats = await all(env, `SELECT * FROM thread_stats ORDER BY thread_key`);
  const comments = await all(
    env,
    `SELECT * FROM comments ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const totalRow = await first(env, `SELECT COUNT(*) AS c FROM comments`);
  const total = Number(totalRow ? totalRow.c : 0);
  return {
    format: 'comments-native-v2',
    threads,
    comments,
    threadStats,
    pagination: { offset, limit, total, hasMore: offset + comments.length < total },
  };
}

/** 恢复本系统原始备份。调用方应按小批次先恢复 threads，再恢复 comments / threadStats。 */
export async function importNativeBackup(env, payload = {}) {
  await ensureSchema(env);
  const threads = Array.isArray(payload.threads) ? payload.threads : [];
  const comments = Array.isArray(payload.comments) ? payload.comments : [];
  const threadStats = Array.isArray(payload.threadStats) ? payload.threadStats : [];
  const statements = [];

  for (const row of threads) {
    const key = normalizeThreadKey(row && row.key);
    if (!key) continue;
    statements.push({
      sql: `INSERT INTO threads (key, url, title, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET
                url = excluded.url, title = excluded.title,
                created_at = excluded.created_at, updated_at = excluded.updated_at`,
      args: [
        key,
        row.url || null,
        row.title || null,
        Number(row.created_at) || nowSeconds(),
        Number(row.updated_at) || Number(row.created_at) || nowSeconds(),
      ],
    });
  }

  for (const row of comments) {
    const id = Number(row && row.id);
    const key = normalizeThreadKey(row && row.thread_key);
    const content = String((row && row.content) || '').trim();
    if (!id || !key || !content) continue;
    const rawStatus = String(row.status || 'approved');
    const status = rawStatus === 'delete' ? 'deleted'
      : ['approved', 'spam', 'deleted'].includes(rawStatus) ? rawStatus : 'approved';
    statements.push({
      sql: `INSERT INTO comments
              (id, thread_key, parent_id, root_id, nick, email, email_hash, website, content,
               ua, region, ip_hash, status, is_admin, notify, pending_token, legacy_id,
               parent_legacy_id, edit_token, notify_token, like_count, is_top, updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              thread_key=excluded.thread_key, parent_id=excluded.parent_id, root_id=excluded.root_id,
              nick=excluded.nick, email=excluded.email, email_hash=excluded.email_hash,
              website=excluded.website, content=excluded.content, ua=excluded.ua, region=excluded.region,
              ip_hash=excluded.ip_hash, status=excluded.status, is_admin=excluded.is_admin,
              notify=excluded.notify, pending_token=excluded.pending_token, legacy_id=excluded.legacy_id,
              parent_legacy_id=excluded.parent_legacy_id, edit_token=excluded.edit_token,
              notify_token=excluded.notify_token, like_count=excluded.like_count,
              is_top=excluded.is_top, updated_at=excluded.updated_at, created_at=excluded.created_at`,
      args: [
        id, key, row.parent_id == null ? null : Number(row.parent_id),
        row.root_id == null ? null : Number(row.root_id),
        String(row.nick || '匿名').slice(0, 40), row.email || null, row.email_hash || null,
        normalizeWebsite(row.website) || null, content, row.ua || null, row.region || null,
        row.ip_hash || null, status, Number(row.is_admin) ? 1 : 0, Number(row.notify) ? 1 : 0,
        row.pending_token || null, row.legacy_id || null, row.parent_legacy_id || null,
        row.edit_token || null, row.notify_token || null, Math.max(0, Number(row.like_count) || 0),
        Number(row.is_top) ? 1 : 0, Number(row.updated_at) || Number(row.created_at) || nowSeconds(),
        Number(row.created_at) || nowSeconds(),
      ],
    });
  }

  for (const row of threadStats) {
    const key = normalizeThreadKey(row && row.thread_key);
    if (!key) continue;
    statements.push({
      sql: `INSERT INTO thread_stats (thread_key, views, likes, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(thread_key) DO UPDATE SET
                views=excluded.views, likes=excluded.likes, updated_at=excluded.updated_at`,
      args: [
        key,
        Math.max(0, Number(row.views) || 0),
        Math.max(0, Number(row.likes) || 0),
        Number(row.updated_at) || nowSeconds(),
      ],
    });
  }

  if (statements.length) await batch(env, statements);
  return {
    imported: comments.length,
    threads: threads.length,
    stats: threadStats.length,
  };
}

/* ------------------------ 与 Twikoo 互通（导入 / 导出） --------------------- */

// Twikoo 的 _id 是 32 位 hex。这里用固定前缀派生，保证同一行每次导出 id 不变，
// 所以 pid / rid 的父子关系在多次导出、重新导回时都能对上。
function twikooIdOf(id) {
  return md5('hux-comment-' + id);
}

// 站点地址只用来拼 href 字段，Twikoo 靠它显示来源链接
function siteOrigin(env) {
  return String(env.COMMENTS_SITE_URL || 'https://hux.ink').replace(/\/+$/, '');
}

// Twikoo 的 url 字段只存路径，本站有的线程记的是绝对地址，先统一成 path
function pathOfUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return parsed.pathname + (parsed.search || '');
    } catch (error) {
      return raw;
    }
  }
  return raw.startsWith('/') ? raw : '/' + raw;
}

function threadUrlOf(key, thread) {
  if (thread && thread.url) return pathOfUrl(thread.url);
  const k = String(key || '');
  if (k.startsWith('memo:')) return '/m/' + k.slice(5) + '/';
  if (k.startsWith('post:')) return k.slice(5);
  if (k.startsWith('page:')) return k.slice(5);
  return '/' + k.replace(/^\/+/, '');
}

function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function stripTags(text) {
  return String(text).replace(/<[^>]*>/g, '');
}

// Twikoo 存的是渲染后的 HTML，我们存的是轻量 Markdown 文本，两个方向都要转一遍
export function htmlToText(html) {
  // 先把代码块/行内代码抽成占位符，免得里面的尖括号被当成标签吃掉
  const blocks = [];
  const inlines = [];
  const stashBlock = (body) => {
    blocks.push(stripTags(body));
    return '\u0000BLOCK' + (blocks.length - 1) + '\u0000';
  };
  const stashInline = (body) => {
    inlines.push(stripTags(body));
    return '\u0000INLINE' + (inlines.length - 1) + '\u0000';
  };

  let out = String(html || '');
  out = out.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m, body) => '\n' + stashBlock(body) + '\n');
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, body) => stashInline(body));
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, body) => '**' + body + '**');
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, body) => '*' + body + '*');
  out = out.replace(/<(del|s|strike)[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, body) => '~~' + body + '~~');
  out = out.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
    const text = stripTags(label).trim();
    return text && text !== href ? '[' + text + '](' + href + ')' : href;
  });
  // 图片保留为 Markdown，避免 Twikoo 的纯图片评论在迁移时整条消失。
  out = out.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    const src = (attrs.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || '';
    const alt = (attrs.match(/\balt=["']([^"']*)["']/i) || [])[1] || '图片';
    return /^https?:\/\//i.test(src) ? `![${stripTags(alt)}](${src})` : '';
  });
  out = out.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, body) =>
    stripTags(body).replace(/<\/p>\s*<p[^>]*>/gi, '\n').trim().replace(/^/gm, '> ')
  );
  out = out.replace(/<li[^>]*>/gi, '\n- ');
  out = out.replace(/<\/li>/gi, '');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  out = out.replace(/<\/(p|div|h[1-6]|ul|ol|tr)>/gi, '\n\n');
  out = out.replace(/<[^>]+>/g, '');
  out = decodeEntities(out);

  // 复原代码：整块用围栏，行内用反引号
  out = out.replace(/\u0000BLOCK(\d+)\u0000/g, (m, i) => '```\n' + decodeEntities(blocks[Number(i)]) + '\n```');
  out = out.replace(/\u0000INLINE(\d+)\u0000/g, (m, i) => '`' + decodeEntities(inlines[Number(i)]) + '`');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 反过来：把轻量 Markdown 变成 Twikoo 能直接渲染的 HTML
export function textToHtml(text) {
  let out = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    '<img src="$2" alt="$1" loading="lazy">');
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="nofollow noopener">$1</a>');
  const blocks = out.split(/\n{2,}/).map((block) => '<p>' + block.replace(/\n/g, '<br>') + '</p>');
  return blocks.join('\n') + '\n';
}

/**
 * 导出成 Twikoo 的格式（comment.json + counter.json 两份）。
 * 万一以后不用这套评论了，把这两个文件丢回 Twikoo 的管理面板就能继续用。
 */
export async function exportTwikoo(env, limit = 5000, offset = 0) {
  await ensureSchema(env);
  const threads = await all(env, `SELECT * FROM threads ORDER BY key`);
  const comments = await all(
    env,
    `SELECT * FROM comments
      WHERE status NOT IN ('deleted', 'delete')
      ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const totalRow = await first(
    env,
    `SELECT COUNT(*) AS c FROM comments WHERE status NOT IN ('deleted', 'delete')`
  );
  const total = Number(totalRow ? totalRow.c : 0);
  const stats = await all(env, `SELECT * FROM thread_stats`);
  const idRows = await all(
    env,
    `SELECT id, legacy_id FROM comments WHERE status NOT IN ('deleted', 'delete')`
  );
  const origin = siteOrigin(env);

  const threadMap = new Map(threads.map((row) => [row.key, row]));
  const statMap = new Map(stats.map((row) => [row.thread_key, row]));
  const idMap = new Map(idRows.map((row) => [row.id, row.legacy_id || twikooIdOf(row.id)]));

  const comment = comments.map((row) => {
    const thread = threadMap.get(row.thread_key);
    const url = threadUrlOf(row.thread_key, thread);
    const created = Number(row.created_at) * 1000;
    return {
      _id: row.legacy_id || twikooIdOf(row.id),
      uid: row.email_hash || '',
      nick: row.nick,
      mail: row.email || '',
      mailMd5: row.email_hash || '',
      link: row.website || '',
      ua: row.ua || '',
      ip: '',
      master: Number(row.is_admin) === 1,
      url,
      href: origin + url,
      comment: textToHtml(row.content),
      pid: row.parent_id ? idMap.get(row.parent_id) || twikooIdOf(row.parent_id) : '',
      rid: row.root_id ? idMap.get(row.root_id) || twikooIdOf(row.root_id) : '',
      isSpam: row.status === 'spam',
      created,
      updated: Number(row.updated_at || row.created_at) * 1000,
      ipRegion: row.region || '',
      top: Boolean(row.is_top),
      like: Math.max(0, Number(row.like_count) || 0),
    };
  });

  const counter = threads.map((row) => {
    const stat = statMap.get(row.key);
    return {
      url: threadUrlOf(row.key, row),
      title: row.title || '',
      time: Number(stat ? stat.views : 0),
      created: Number(row.created_at) * 1000,
      updated: Number(row.updated_at) * 1000,
    };
  });

  return {
    comment,
    counter,
    pagination: { offset, limit, total, hasMore: offset + comment.length < total },
  };
}

/**
 * 导入 Twikoo 导出文件（评论 + 阅读量）。重复导入同一份文件是安全的：
 * comments 走 dedupe，counter 取「已有值 / 导入值」里更大的那个。
 */
export async function importTwikoo(env, payload = {}) {
  await ensureSchema(env);
  const comments = Array.isArray(payload) ? payload : payload.comment || payload.comments || [];
  const counters = Array.isArray(payload) ? [] : payload.counter || payload.counters || [];

  const items = comments
    .filter((item) => item && item.comment && item.nick)
    .map((item) => ({
      oldId: item._id ? String(item._id) : '',
      parentOldId: item.pid && item.pid !== item._id ? String(item.pid) : '',
      threadKey: String(item.url || ''),
      threadUrl: item.href || '',
      threadTitle: item.title || '',
      nick: String(item.nick).slice(0, 40),
      email: String(item.mail || '').trim().toLowerCase(),
      website: item.link || '',
      content: htmlToText(item.comment).slice(0, 5000),
      ua: item.ua || '',
      region: item.ipRegion || '',
      createdAt: Math.floor(Number(item.created || Date.now()) / 1000),
      status: item.isSpam ? 'spam' : 'approved',
      isAdmin: Boolean(item.master),
      likeCount: Math.max(0, Number(item.like) || 0),
      isTop: Boolean(item.top),
      updatedAt: Math.floor(Number(item.updated || item.created || Date.now()) / 1000),
    }));

  const result = await importComments(env, items, { dedupe: true });

  let views = 0;
  const counterStatements = [];
  for (const row of counters) {
    const url = String((row && row.url) || '').trim();
    if (!url) continue;
    const threadKey = normalizeThreadKey(url);
    if (!threadKey) continue;
    const time = Math.max(0, Number(row.time) || 0);
    const createdAt = Math.floor(Number(row.created || Date.now()) / 1000);
    const updatedAt = Math.floor(Number(row.updated || Date.now()) / 1000);

    counterStatements.push({
      sql: `INSERT INTO threads (key, url, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              url = COALESCE(threads.url, excluded.url),
              title = COALESCE(NULLIF(threads.title, ''), excluded.title),
              updated_at = CASE WHEN excluded.updated_at > threads.updated_at
                                THEN excluded.updated_at ELSE threads.updated_at END`,
      args: [threadKey, url, row.title || null, createdAt, updatedAt],
    });
    // 只在导入值更大时覆盖，避免把本地后来攒的阅读量改小
    counterStatements.push({
      sql: `INSERT INTO thread_stats (thread_key, views, likes, updated_at)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(thread_key) DO UPDATE SET
              views = CASE WHEN excluded.views > thread_stats.views
                           THEN excluded.views ELSE thread_stats.views END`,
      args: [threadKey, time, updatedAt],
    });
    views += 1;
  }
  if (counterStatements.length) await batch(env, counterStatements);

  return { imported: result.imported, skipped: result.skipped, repaired: result.repaired || 0, counters: views };
}
