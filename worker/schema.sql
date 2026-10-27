-- Cloudflare D1 建表脚本
-- 本地：npx wrangler d1 execute comments --local --file=worker/schema.sql
-- 线上：npx wrangler d1 execute comments --remote --file=worker/schema.sql
--
-- 已经建过表的老库不用重跑本文件：Worker 启动时会自动补齐新增字段
-- （legacy_id / parent_legacy_id 用于重复导入时把楼层重新挂回去，
--   edit_token 是提交人改错别字的凭据）。
-- 想手动补也行：ALTER TABLE comments ADD COLUMN edit_token TEXT;

CREATE TABLE IF NOT EXISTS threads (
  key        TEXT PRIMARY KEY,
  url        TEXT,
  title      TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS comments (
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
  legacy_id TEXT,
  parent_legacy_id TEXT,
  edit_token TEXT,
  notify_token TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  is_top INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_comments_thread  ON comments (thread_key, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_root    ON comments (root_id);
CREATE INDEX IF NOT EXISTS idx_comments_email   ON comments (email_hash);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at);
CREATE INDEX IF NOT EXISTS idx_comments_legacy  ON comments (thread_key, legacy_id);
CREATE INDEX IF NOT EXISTS idx_comments_ip_time ON comments (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS thread_stats (
  thread_key TEXT PRIMARY KEY,
  views      INTEGER NOT NULL DEFAULT 0,
  likes      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS view_sessions (
  thread_key   TEXT    NOT NULL,
  session_hash TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (thread_key, session_hash)
);

CREATE INDEX IF NOT EXISTS idx_view_sessions_created ON view_sessions (created_at);

CREATE TABLE IF NOT EXISTS likes (
  thread_key   TEXT    NOT NULL,
  visitor_hash TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (thread_key, visitor_hash)
);

-- 严格的滑动窗口限流事件。检查与插入在一条 SQL 内完成，并发请求不能一起穿透。
CREATE TABLE IF NOT EXISTS comment_rate_events (
  actor_hash TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  nonce      TEXT    NOT NULL PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_comment_rate_actor_time
  ON comment_rate_events (actor_hash, created_at);
