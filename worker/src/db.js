/**
 * D1 适配层。
 * 把「绑定参数 → 执行 → 取结果」收敛成三个函数，业务层不直接碰 D1 API。
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS threads (
     key        TEXT PRIMARY KEY,
     url        TEXT,
     title      TEXT,
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE TABLE IF NOT EXISTS comments (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     thread_key TEXT    NOT NULL,
     parent_id  INTEGER,
     root_id    INTEGER,
     nick       TEXT    NOT NULL,
     email      TEXT,
     email_hash TEXT,
     website    TEXT,
     content    TEXT    NOT NULL,
     ua         TEXT,
     region     TEXT,
     ip_hash    TEXT,
     status     TEXT    NOT NULL DEFAULT 'approved',
     is_admin   INTEGER NOT NULL DEFAULT 0,
     notify     INTEGER NOT NULL DEFAULT 1,
     pending_token TEXT,
     legacy_id  TEXT,
     parent_legacy_id TEXT,
     edit_token TEXT,
     notify_token TEXT,
     like_count INTEGER NOT NULL DEFAULT 0,
     is_top INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments (thread_key, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_root ON comments (root_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_email ON comments (email_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_ip_time ON comments (ip_hash, created_at)`,
  // 注意：别在这里加 idx_comments_legacy —— 老库还没有 legacy_id 列，
  // CREATE INDEX 会直接抛 "no such column"，把整个建表流程带崩。
  // 带列的索引一律放 MIGRATIONS，那里是先加列再建索引。
  `CREATE TABLE IF NOT EXISTS settings (
     key   TEXT PRIMARY KEY,
     value TEXT
   )`,
  // 阅读量 / 点赞：与评论同库，省一个 KV
  `CREATE TABLE IF NOT EXISTS thread_stats (
     thread_key TEXT PRIMARY KEY,
     views      INTEGER NOT NULL DEFAULT 0,
     likes      INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  // 按会话去重：同一个 session 反复刷新只记一次
  `CREATE TABLE IF NOT EXISTS view_sessions (
     thread_key   TEXT    NOT NULL,
     session_hash TEXT    NOT NULL,
     created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
     PRIMARY KEY (thread_key, session_hash)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_view_sessions_created ON view_sessions (created_at)`,
  // 点赞按访客去重，可取消
  `CREATE TABLE IF NOT EXISTS likes (
     thread_key   TEXT    NOT NULL,
     visitor_hash TEXT    NOT NULL,
     created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
     PRIMARY KEY (thread_key, visitor_hash)
   )`,
  `CREATE TABLE IF NOT EXISTS comment_rate_events (
     actor_hash TEXT    NOT NULL,
     created_at INTEGER NOT NULL,
     nonce      TEXT    NOT NULL PRIMARY KEY
   )`,
  `CREATE INDEX IF NOT EXISTS idx_comment_rate_actor_time
     ON comment_rate_events (actor_hash, created_at)`,
];

// 已有库（CREATE TABLE 不会补列）需要单独加字段，报「重复列」时忽略即可
const MIGRATIONS = [
  `ALTER TABLE comments ADD COLUMN pending_token TEXT`,
  // 老 id 留下来，迁移分多批提交时也能靠它把父子关系接回去
  `ALTER TABLE comments ADD COLUMN legacy_id TEXT`,
  // 父评论的老 id 也存一份：父评论可能比子评论晚导入（Twikoo 导出不是按时间排的），
  // 有它就能在后续任何一次导入时把挂错的楼层重新挂回去
  `ALTER TABLE comments ADD COLUMN parent_legacy_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_comments_legacy ON comments (thread_key, legacy_id)`,
  // 改自己评论的凭据：只回给提交人，不进列表接口
  `ALTER TABLE comments ADD COLUMN edit_token TEXT`,
  `ALTER TABLE comments ADD COLUMN notify_token TEXT`,
  `ALTER TABLE comments ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE comments ADD COLUMN is_top INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE comments ADD COLUMN updated_at INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_comments_ip_time ON comments (ip_hash, created_at)`,
];

// 每个 isolate 只跑一次建表；失败则重置，下一请求重试
let schemaReady = false;
let schemaPromise = null;

// 「历史待审评论已放行过」的标记键
const NO_REVIEW_FLAG = 'migrate:no-review';
const SCHEMA_VERSION_KEY = 'schema:version';
const SCHEMA_VERSION = '3';

function normalizeArgs(args) {
  return args.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

export async function ensureSchema(env) {
  if (schemaReady) return true;
  if (!env || !env.DB) throw new Error('D1 binding "DB" is missing (check wrangler.toml)');
  if (env.COMMENTS_AUTO_MIGRATE === '0') return true;

  if (!schemaPromise) {
    schemaPromise = (async () => {
      // 大多数冷启动只做一次轻量版本读取，避免每个 isolate 都重复跑整套 DDL。
      try {
        const version = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
          .bind(SCHEMA_VERSION_KEY)
          .first();
        if (version && String(version.value) === SCHEMA_VERSION) {
          schemaReady = true;
          return true;
        }
      } catch {
        // 新库还没有 settings 表，继续执行完整建表。
      }
      for (const sql of SCHEMA) {
        await env.DB.prepare(sql).run();
      }
      for (const sql of MIGRATIONS) {
        try {
          await env.DB.prepare(sql).run();
        } catch (error) {
          const message = String((error && error.message) || '');
          // 列已存在就跳过，其余错误继续抛出
          if (!/duplicate column|already exists/i.test(message)) throw error;
        }
      }
      // 一次性数据修正：去掉审核之前压着的 pending 评论会永远看不到，这里统一放行。
      // 用 settings 里的标记只跑一次，别在每次冷启动都扫一遍全表。
      const done = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
        .bind(NO_REVIEW_FLAG)
        .first();
      if (!done) {
        await env.DB.prepare(
          `UPDATE comments SET status = 'approved', pending_token = NULL WHERE status = 'pending'`
        ).run();
        await env.DB.prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).bind(NO_REVIEW_FLAG, String(Math.floor(Date.now() / 1000))).run();
      }
      await env.DB.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).bind(SCHEMA_VERSION_KEY, SCHEMA_VERSION).run();
      schemaReady = true;
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

/** 返回行数组 */
export async function all(env, sql, args = []) {
  const result = await env.DB.prepare(sql).bind(...normalizeArgs(args)).all();
  return result.results || [];
}

/** 返回第一行或 null */
export async function first(env, sql, args = []) {
  const row = await env.DB.prepare(sql).bind(...normalizeArgs(args)).first();
  return row || null;
}

/** 执行写入，返回 { changes, lastId } */
export async function run(env, sql, args = []) {
  const result = await env.DB.prepare(sql).bind(...normalizeArgs(args)).run();
  const meta = result.meta || {};
  return {
    changes: Number(meta.changes || 0),
    lastId: Number(meta.last_row_id || 0),
  };
}

/** 批量写入（D1 会放进同一个事务） */
export async function batch(env, statements) {
  const prepared = statements.map((s) => s.sql && s.args
    ? env.DB.prepare(s.sql).bind(...normalizeArgs(s.args))
    : env.DB.prepare(s));
  return env.DB.batch(prepared);
}
