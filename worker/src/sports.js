/**
 * 工作台抽屉里的运动记录读写，以及「手工补抓 RSS」的触发器。
 *
 * 为什么不照搬老后台
 * ──────────────────
 * 老 admin 是浏览器直连 GitHub：token 在 localStorage，写完要自己拼
 * blob/tree/commit，还得维护本地草稿、dirty 标记、提交前 sha 比对。
 * 那三百多行里有一大半是在替「浏览器可能没网 / 可能多端并发」打补丁。
 *
 * 这里换成服务端单条读-改-写：
 *   表单 → 一次 POST → 服务端读出最新文件、改一条、带 sha 写回
 * 撞车（409）就自动重读重来一次；还撞就明说「刚有自动同步在跑」。
 * 前端因此不需要任何草稿态，失败就是失败，成功就是成功。
 *
 * 数据文件
 * ────────
 *   assets/act.json                    手工记录（Notion 同步也往这里合并）
 *   assets/activity-name-overrides.json { "start_date_local": "自定义名称" }
 *   assets/activities.json             自动同步的运动（只读，1.3MB，只取最近几十条）
 *
 * 接口
 * ────
 *   GET  /api/write/sports            手工 + 最近同步记录，合成一张扁平表
 *   POST /api/write/sports            { action, kind, key, name, when, minutes, type, hr }
 *   POST /api/write/refresh           { task: 'friends' } 触发 Actions 手工补抓
 */

import { fail, json, readJson } from './util.js';
import {
  base64Utf8,
  branchOf,
  contentEndpoint,
  githubReady,
  githubRequest,
  readPostFile,
  repoOf,
  textFromBase64,
} from './write.js';

const ACT_PATH = 'assets/act.json';
const OVERRIDES_PATH = 'assets/activity-name-overrides.json';
const ACTIVITIES_PATH = 'assets/activities.json';

/** activities.json 有近七百条，整份回给手机太重；只取最近这些 */
const SYNC_TAIL = 40;
/** 抽屉里滚动的上限，手工记录全给，同步记录按时间补足 */
const LIST_LIMIT = 60;
const TYPES = ['Stair', 'RopeSkipping', 'Workout'];
const MAX_MINUTES = 24 * 60;
const MAX_NAME = 40;

/* ------------------------------ 小工具 ------------------------------ */

function timeToMinutes(text) {
  const parts = String(text || '').split(':').map(Number);
  if (parts.length < 2 || !parts.every(Number.isFinite)) return 0;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
  return parts[0] * 60 + Math.round(parts[1] / 60);
}

function minutesToTime(minutes) {
  const total = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 手工记录的时间一律是「YYYY-MM-DD HH:MM」，不多不少十六位 */
function cleanWhen(value) {
  const text = String(value || '').trim().replace('T', ' ');
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text) ? text : '';
}

/** 同一天里已有的最大序号加一，删过记录也不会撞号 */
function nextRunId(list, day) {
  const prefix = day.replace(/-/g, '');
  let max = 0;
  list.forEach((item) => {
    const id = String(item.run_id == null ? '' : item.run_id);
    if (id.length === 11 && id.indexOf(prefix) === 0) {
      const seq = Number(id.slice(8));
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
  });
  return Number(`${prefix}${String(max + 1).padStart(3, '0')}`);
}

function sortedDesc(list) {
  return list.slice().sort((a, b) => String(b.start_date_local || '').localeCompare(String(a.start_date_local || '')));
}

/* ------------------------------ 文件 IO ------------------------------ */

/** 读 JSON 文件；不存在或坏掉时给个兜底值，不让整条链路失败。 */
async function readJsonOr(env, path, fallback) {
  const got = await readPostFile(env, path);
  if (got.error) return { value: fallback, sha: null, missing: true };
  let value = fallback;
  try {
    value = JSON.parse(got.text || 'null');
  } catch (error) {
    console.error('[sports] parse failed:', path, error && error.message);
    value = fallback;
  }
  return { value, sha: got.sha, missing: false };
}

/**
 * activities.json 有 1.3MB，超过 GitHub contents API 的 1MB 上限：
 * 那边只会回一个空字符串 + sha，正文得另走 git blobs 拿。
 * 这一点不处理的话，同步记录会静默变成空列表 —— 改名功能看着没坏，其实没数据。
 */
async function readActivities(env) {
  const endpoint = `${contentEndpoint(env, ACTIVITIES_PATH)}?ref=${encodeURIComponent(branchOf(env))}`;
  const head = await githubRequest(env, endpoint);
  if (!head.response.ok || !head.body) {
    if (head.response.status !== 404) {
      console.error('[sports] activities head failed:', head.response.status);
    }
    return [];
  }

  const inline = head.body.content;
  if (typeof inline === 'string' && inline) {
    try {
      return JSON.parse(textFromBase64(inline));
    } catch (error) {
      console.error('[sports] activities inline parse failed:', error && error.message);
    }
  }

  const sha = String(head.body.sha || '');
  if (!sha) return [];

  const blob = await githubRequest(env, `/repos/${repoOf(env)}/git/blobs/${sha}`);
  if (!blob.response.ok || !blob.body || typeof blob.body.content !== 'string') {
    console.error('[sports] activities blob failed:', blob.response.status);
    return [];
  }
  try {
    return JSON.parse(textFromBase64(blob.body.content));
  } catch (error) {
    console.error('[sports] activities blob parse failed:', error && error.message);
    return [];
  }
}

async function putJson(env, path, value, message, sha) {  const payload = {
    message,
    content: base64Utf8(JSON.stringify(value, null, 2) + '\n'),
    branch: branchOf(env),
  };
  if (sha) payload.sha = sha;
  const { response, body } = await githubRequest(env, contentEndpoint(env, path), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return {
      error: (body && body.message) || `GitHub 返回 ${response.status}`,
      status: response.status,
    };
  }
  return { ok: true, sha: (body && body.content && body.content.sha) || '' };
}

/**
 * 读 → 改 → 带 sha 写回。撞车（409/422）说明这期间有人（比如 Notion 同步的
 * workflow）刚提交过，重读一次重新改；连续两次撞车就不再硬试，把话说清楚。
 */
async function mutateJson(env, path, fallback, mutate, message) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readJsonOr(env, path, fallback);
    const base = current.value == null ? fallback : current.value;
    const next = mutate(base);
    if (next && next.error) return next;
    if (next && next.unchanged) return { ok: true, unchanged: true };
    const put = await putJson(env, path, next.value, message, current.sha);
    if (put.ok) return put;
    if (put.status !== 409 && put.status !== 422) return put;
    console.warn('[sports] conflict, retrying:', path);
  }
  return { error: '刚有自动同步在改这份文件，等两秒再点一次', status: 409 };
}

/* ------------------------------ 读 ------------------------------ */

function manualRow(item) {
  const when = String(item.start_date_local || '').trim();
  return {
    id: 'm:' + when,
    kind: 'manual',
    key: when,
    name: String(item.name || '运动'),
    type: String(item.type || 'Workout'),
    when,
    minutes: timeToMinutes(item.moving_time),
    km: Number(item.distance) > 0 ? Math.round(Number(item.distance) / 100) / 10 : 0,
    hr: Number(item.average_heartrate) || 0,
  };
}

function syncedRow(item, overrides) {
  const when = String(item.start_date_local || '').trim();
  const source = String(item.name || '运动');
  const custom = overrides && Object.prototype.hasOwnProperty.call(overrides, when) ? String(overrides[when] || '') : '';
  return {
    id: 's:' + when,
    kind: 'synced',
    key: when,
    name: custom || source,
    source,
    type: String(item.type || 'Workout'),
    when,
    minutes: timeToMinutes(item.moving_time),
    km: Number(item.distance) > 0 ? Math.round(Number(item.distance) / 100) / 10 : 0,
    hr: Number(item.average_heartrate) || 0,
    renamed: Boolean(custom),
  };
}

export async function handleSportsGet(env) {
  if (!githubReady(env)) {
    return fail(503, 'github_not_configured', '还没配置仓库凭证：wrangler secret put GITHUB_TOKEN');
  }

  const [manualFile, overridesFile, syncedRaw] = await Promise.all([
    readJsonOr(env, ACT_PATH, []),
    readJsonOr(env, OVERRIDES_PATH, {}),
    readActivities(env),
  ]);

  if (manualFile.missing && !syncedRaw.length) {
    return fail(502, 'sports_unreadable', '读不到运动数据文件，检查仓库里 assets/ 下那几个 JSON');
  }

  const act = Array.isArray(manualFile.value) ? manualFile.value : [];
  const overrides = overridesFile.value && typeof overridesFile.value === 'object' && !Array.isArray(overridesFile.value)
    ? overridesFile.value
    : {};
  const synced = Array.isArray(syncedRaw) ? syncedRaw : [];

  const manual = act.filter((item) => item && item.start_date_local).map(manualRow);
  const recent = sortedDesc(synced.filter((item) => item && item.start_date_local))
    .slice(0, SYNC_TAIL)
    .map((item) => syncedRow(item, overrides));

  const items = manual.concat(recent)
    .sort((a, b) => String(b.when).localeCompare(String(a.when)))
    .slice(0, LIST_LIMIT);

  return json({
    ok: true,
    items,
    counts: { manual: act.length, synced: synced.length },
  });
}

/* ------------------------------ 写 ------------------------------ */

function normalizeInput(body) {
  const name = String(body.name == null ? '' : body.name).trim().slice(0, MAX_NAME);
  const type = TYPES.indexOf(String(body.type || '')) > -1 ? String(body.type) : 'Workout';
  const minutes = Math.round(Number(body.minutes) || 0);
  const hr = Math.round(Number(body.hr) || 0);
  return { name, type, minutes, hr };
}

/** 一条手工记录的全部字段，保持与 act.json 现有条目同构 */
function manualRecord({ runId, name, type, minutes, hr, when }) {
  return {
    run_id: runId,
    name,
    moving_time: minutesToTime(minutes),
    type,
    start_date_local: when,
    summary_polyline: '',
    average_heartrate: hr,
    source: 'manual',
  };
}

function addManual(base, input) {
  const when = cleanWhen(input.when);
  if (!when) return { error: '时间没填对', status: 400 };
  if (!input.name) return { error: '名称不能空着', status: 400 };
  if (input.minutes < 1 || input.minutes > MAX_MINUTES) return { error: '时长要在一分钟到 24 小时之间', status: 400 };

  const clash = base.find((item) => String(item.start_date_local || '').trim() === when);
  if (clash) return { error: '这个时间点已经有一条记录了，换个时间或直接改那条', status: 409 };

  const record = manualRecord({
    runId: nextRunId(base, when.slice(0, 10)),
    name: input.name,
    type: input.type,
    minutes: input.minutes,
    hr: input.hr,
    when,
  });
  return { value: sortedDesc(base.concat([record])) };
}

function updateManual(base, input) {
  const key = String(input.key || '').trim();
  const index = base.findIndex((item) => String(item.start_date_local || '').trim() === key);
  if (index < 0) return { error: '这条记录已经不在了，刷新看看', status: 404 };

  const when = cleanWhen(input.when) || key;
  if (!input.name) return { error: '名称不能空着', status: 400 };
  if (input.minutes < 1 || input.minutes > MAX_MINUTES) return { error: '时长要在一分钟到 24 小时之间', status: 400 };
  if (when !== key && base.some((item, at) => at !== index && String(item.start_date_local || '').trim() === when)) {
    return { error: '新时间和另一条记录撞上了', status: 409 };
  }

  const old = base[index];
  const next = base.slice();
  next[index] = manualRecord({
    // 改时间不换号：这条记录的身份还是原来那个
    runId: old.run_id,
    name: input.name,
    type: input.type,
    minutes: input.minutes,
    hr: input.hr,
    when,
  });
  return { value: sortedDesc(next) };
}

function deleteManual(base, key) {
  const index = base.findIndex((item) => String(item.start_date_local || '').trim() === key);
  if (index < 0) return { error: '这条记录已经不在了，刷新看看', status: 404 };
  const next = base.slice();
  next.splice(index, 1);
  return { value: sortedDesc(next) };
}

/** 同步记录的改名只碰覆盖表，原始 activities.json 一个字节都不动 */
function writeOverride(base, key, name) {
  const when = String(key || '').trim();
  if (!when) return { error: '没指定是哪一条', status: 400 };
  const next = { ...base };
  if (!name) {
    if (!Object.prototype.hasOwnProperty.call(next, when)) return { unchanged: true };
    delete next[when];
    return { value: next };
  }
  if (next[when] === name) return { unchanged: true };
  next[when] = name;
  return { value: next };
}

export async function handleSportsSave(request, env) {
  if (!githubReady(env)) {
    return fail(503, 'github_not_configured', '还没配置仓库凭证：wrangler secret put GITHUB_TOKEN');
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(400, 'bad_json', '请求体不是 JSON');
  }

  const action = String(body.action || '').trim();
  const kind = String(body.kind || 'manual').trim();
  const input = normalizeInput(body);

  if (kind === 'synced') {
    if (action !== 'update') return fail(400, 'bad_action', '同步记录只能改名');
    const result = await mutateJson(
      env,
      OVERRIDES_PATH,
      {},
      (base) => writeOverride(base && typeof base === 'object' && !Array.isArray(base) ? base : {}, body.key, input.name),
      `sports: 重命名 ${String(body.key || '').slice(0, 16)}`
    );
    if (result.error) return fail(result.status || 502, 'sports_write_failed', result.error);
    return json({ ok: true, action, kind });
  }

  if (TYPES.indexOf(kind) > -1) return fail(400, 'bad_kind', 'kind 只能是 manual 或 synced');

  const label = action === 'add' ? '新增' : action === 'update' ? '修改' : '删除';
  const result = await mutateJson(
    env,
    ACT_PATH,
    [],
    (base) => {
      const list = Array.isArray(base) ? base : [];
      if (action === 'add') return addManual(list, { ...input, when: body.when });
      if (action === 'update') return updateManual(list, { ...input, key: body.key, when: body.when });
      if (action === 'delete') return deleteManual(list, String(body.key || '').trim());
      return { error: '不认识这个操作', status: 400 };
    },
    `sports: ${label} ${input.name || String(body.key || '')}`.trim()
  );

  if (result.error) return fail(result.status || 502, 'sports_write_failed', result.error);
  return json({ ok: true, action, kind: 'manual', unchanged: Boolean(result.unchanged) });
}

/* ------------------------------ 手工补抓 ------------------------------ */

const REFRESH_TASKS = {
  friends: { file: 'fetch-friend-circle.yml', label: '博友 RSS' },
};

export async function handleRefresh(request, env) {
  if (!githubReady(env)) {
    return fail(503, 'github_not_configured', '还没配置仓库凭证：wrangler secret put GITHUB_TOKEN');
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return fail(400, 'bad_json', '请求体不是 JSON');
  }

  const task = REFRESH_TASKS[String(body.task || '').trim()];
  if (!task) return fail(400, 'unknown_task', '不认识这个抓取任务');

  const { response } = await githubRequest(
    env,
    `/repos/${repoOf(env)}/actions/workflows/${task.file}/dispatches`,
    { method: 'POST', body: JSON.stringify({ ref: branchOf(env) }) }
  );

  if (response.status === 204) {
    return json({ ok: true, queued: true, label: task.label });
  }
  if (response.status === 403 || response.status === 404) {
    // 404 多半也是权限问题：令牌看不到这个 workflow 就当成不存在
    return fail(502, 'actions_forbidden', 'GitHub 令牌没有触发 Actions 的权限，重新生成 PAT 时勾上 Actions: write');
  }
  return fail(502, 'dispatch_failed', `触发失败：GitHub 返回 ${response.status}`);
}
