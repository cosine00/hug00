/**
 * 测试用的 D1 假库：底层是 Node 自带的 SQLite（node:sqlite），
 * 只实现 worker/src/db.js 用到的那几个方法。
 *
 * 为什么不用手写的假对象：会话过期、唯一约束、RETURNING、unixepoch() 这些
 * 真实行为都要跟着 SQL 走，手写桩很容易「测过了但线上不是这样」。
 */
import { DatabaseSync } from 'node:sqlite';

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.args);
    if (!row) return null;
    if (column) return Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
    return row;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.args);
    return { success: true, results };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return {
      success: true,
      meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) },
    };
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  return {
    _db: db,
    prepare: (sql) => new Stmt(db, sql),
    batch: async (statements) => Promise.all(statements.map((item) => item.run())),
    /** 只给测试用：批量断言前清数据、把会话改成过期 */
    exec: (sql) => db.exec(sql),
  };
}
