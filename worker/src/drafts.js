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
 * 怎么判断「该不该覆盖」
 * ────────────────────
 * 不用任何一端的时钟。两端时间对不上是常态（手机时区、时钟漂移），一旦拿时间
 * 当判据，就会出现「明明没改却报冲突」或「改过却被悄悄覆盖」。这里只比内容：
 *   source_hash  = 上一次由 Drafts 写进来的 (标题+正文) 指纹
 *   现在的行内容 = 当前 (标题+正文) 的指纹
 * 两者一致 → Beta 端没动过 → 可以安全跟着 Drafts 更新；
 * 两者不一致 → Beta 端被改过（哪怕只多一个空行）→ 409 冲突，两边都留着。
 *
 * id 为什么是 dr- + uuid
 * ────────────────────
 * 草稿 id 就是主键，用它当幂等键最省事：同一份 Drafts 文稿永远算出同一个 id，
 * 网络重试、连续点两次都只会有一行。加 dr- 前缀是让它和 Beta 本机生成的 d… 分开，
 * 一眼能看出这篇是外部来的；长度也还在现有的 ^[\w-]{2,64}$ 之内。
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
// Drafts 的 uuid 是 36 位带连字符的十六进制，这里放宽一点，只要不是路径或注入
const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

const COLUMNS =
  'id, title, body, edit_path, published_at, created_at, updated_at, deleted_at, source, source_id, source_hash';

/** 内容指纹：标题与正文之间用 \n 隔开，避免标题尾巴和正文开头拼出同一串。 */
function contentHash(title, body) {
  return sha256(`${String(title)}\n${String(body)}`);
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
 * POST /api/integrations/drafts
 * { source: "drafts", sourceId: "文稿UUID", title: "标题", body: "Markdown 正文" }
 *
 * 200 created / 200 updated / 200 unchanged —— 三种都是「服务端确认过了，可以报成功」。
 * 401 令牌不对，409 冲突（已删 / 已发布 / Beta 改过），413 正文超长，5xx 服务端问题。
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
    return fail(401, 'unauthorized', '令牌不对：检查 Drafts 里保存的 Token 是否与 Worker Secret 一致');
  }

  const text = await request.text();
  if (!text) return fail(400, 'bad_json', '请求体是空的');
  if (text.length > REQUEST_LIMIT) {
    return fail(413, 'body_too_large', `正文太长，这一篇发不出去（上限约 ${BODY_LIMIT} 字）`);
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

  const sourceId = String(payload.sourceId || '').trim();
  if (!SOURCE_ID_RE.test(sourceId)) {
    return fail(400, 'bad_source_id', 'sourceId 不像 Drafts 的文稿 UUID');
  }

  const title = String(payload.title == null ? '' : payload.title).replace(/\r\n/g, '\n').trim();
  if (!title) return fail(400, 'title_required', '标题是空的：第一行留一句标题再发');
  if (title.length > TITLE_LIMIT) {
    return fail(400, 'title_too_long', `标题 ${title.length} 字，超过 ${TITLE_LIMIT} 字上限`);
  }

  const body = String(payload.body == null ? '' : payload.body).replace(/\r\n/g, '\n');
  if (body.length > BODY_LIMIT) {
    return fail(413, 'body_too_large', `正文 ${body.length} 字，超过 ${BODY_LIMIT} 字上限（Beta 草稿同步也是这条线）`);
  }

  await ensureSchema(env);

  const id = ID_PREFIX + sourceId.toLowerCase();
  const now = Date.now();
  const incoming = await contentHash(title, body);
  const row = await first(env, `SELECT ${COLUMNS} FROM write_drafts WHERE id = ?`, [id]);

  /* ------------------------------ 已有这一篇 ------------------------------ */

  if (row) {
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

    // 内容与上次导入完全一致：什么都不做。网络重试、连点两次都走这条路
    if (row.source_hash && incoming === row.source_hash) {
      return json({
        ok: true,
        status: 'unchanged',
        id,
        title: row.title || '',
        updatedAt: Number(row.updated_at || 0),
        serverTime: now,
      });
    }

    // Beta 端被改过 → 不覆盖，把两边都报回去
    const current = await contentHash(row.title, row.body);
    if (!row.source_hash || current !== row.source_hash) {
      return json(
        {
          ok: false,
          error: {
            code: 'draft_conflict',
            message: 'Beta 里这篇草稿已经被改过，这次没有覆盖它；请在 Beta 里自己合并两边的内容',
          },
          conflict: {
            id,
            beta: {
              title: row.title || '',
              excerpt: excerpt(row.body),
              updatedAt: Number(row.updated_at || 0),
            },
            incoming: { title, length: body.length },
            hint: 'Beta 里的版本原样保留，Drafts 里的这篇也没动。要整篇替换，请在 Beta 里删掉旧草稿后重新发送（会当成新草稿）',
          },
        },
        409
      );
    }

    // Beta 没动过 → 跟着 Drafts 更新。只改标题正文，标签/slug/发布时间一律不碰
    const result = await run(
      env,
      `UPDATE write_drafts
          SET title = ?, body = ?, updated_at = ?, source_hash = ?, source_at = ?
        WHERE id = ? AND deleted_at = 0`,
      [title, body, now, incoming, now, id]
    );
    // changes=0：SELECT 之后这一刻被人删掉了。按删除处理，别谎报成功
    if (!result.changes) {
      return fail(409, 'draft_deleted', '这篇刚在 Beta 被删掉，这次没有写回去；要重新收进来请在 Drafts 里复制成新文稿');
    }
    return json({ ok: true, status: 'updated', id, title, updatedAt: now, serverTime: now });
  }

  /* ------------------------------- 全新一篇 ------------------------------- */

  const insert = () =>
    run(
      env,
      `INSERT INTO write_drafts
         (id, title, body, tags, slug, edit_path, edit_name, edit_url,
          published_at, created_at, updated_at, deleted_at,
          source, source_id, source_hash, source_at)
       VALUES (?, ?, ?, '[]', '', NULL, NULL, NULL, 0, ?, ?, 0, ?, ?, ?, ?)`,
      [id, title, body, now, now, SOURCE, sourceId, incoming, now]
    );

  try {
    await insert();
  } catch (error) {
    // 同一篇同时发了两次（重试、手抖连点）：后到的那条撞主键。
    // 只要落库的内容和这次要写的一致，就当成功，别让用户看到一条假失败。
    const again = await first(env, `SELECT ${COLUMNS} FROM write_drafts WHERE id = ?`, [id]);
    if (again && again.source_hash === incoming && Number(again.deleted_at || 0) === 0) {
      return json({
        ok: true,
        status: 'unchanged',
        id,
        title: again.title || '',
        updatedAt: Number(again.updated_at || 0),
        serverTime: now,
      });
    }
    console.error('[drafts] insert failed:', error && error.message);
    return fail(500, 'draft_save_failed', '草稿没写进云库，稍后再试');
  }

  return json({ ok: true, status: 'created', id, title, updatedAt: now, serverTime: now }, 201);
}
