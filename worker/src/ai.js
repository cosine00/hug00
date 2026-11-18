/**
 * AI 润色：把一段 Markdown 正文交给 DeepSeek，拿回「同构」的润色稿。
 *
 * 为什么放在 Worker 里而不是浏览器直连
 * ────────────────────────────────────
 * 密钥只能待在服务端。走这一步顺带把事情收窄了：
 *   · 鉴权复用 adminGate（会话 Cookie 或管理口令），没有新增口令；
 *   · 输入长度、并发、重复提交都在这里卡死，前端只是调用方；
 *   · 日志只记状态码和字数，草稿正文一个字都不落盘。
 *
 * 接口
 * ────
 *   POST /api/write/polish
 *        { text, mode?, instruction?, scope?, rid? } →
 *        { ok, text, warnings: [], model, chars }
 *
 * 设计取舍
 * ────────
 * 1. 不做流式。写作页要的是「完整结果 + 差异对比」，流式只会在手机上多一层
 *    渲染压力；一次请求、一个 JSON，前端拿到的就是要对比的那份终稿。
 * 2. 不切片摘要式改写。整段送进去、整段拿回来，段落对应关系由提示词守住，
 *    再配合 checkProtected() 在服务端做一次「非正文有没有被动过」的体检。
 * 3. 提示词是这个功能的全部功夫：模型很容易把个人博客写成公众号。styleRules
 *    里那些「不许」就是这么来的，改之前先想清楚会不会把作者的语气洗掉。
 */

import { clientIp, fail, json } from './util.js';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-flash';

/** 12000 字 ≈ 6k~8k token，一篇长文够用；再长就让作者选中一段来润，别一把梭。 */
const MAX_INPUT_CHARS = 12000;
const MAX_INSTRUCTION_CHARS = 200;
const MAX_OUTPUT_TOKENS = 8192;
const TIMEOUT_MS = 60000;

/** 单机（单 isolate）内的软限流：一分钟 8 次、两次之间至少 1.2 秒。 */
const RATE_WINDOW_MS = 60000;
const RATE_MAX_IN_WINDOW = 8;
const MIN_GAP_MS = 1200;
const RID_TTL_MS = 120000;

const MODES = {
  polish: {
    temperature: 0.65,
    brief:
      '在保持原意和个人语气的前提下，把拗口、重复、搭配不当的地方理顺。改动要克制——读者不应该看出这篇被 AI 动过。',
  },
  tighten: {
    temperature: 0.4,
    brief:
      '删掉多余的修饰、重复的表达和绕圈子的口水话，把松散的长句压紧。信息量不能少，事实、细节、个人观点都要留着。',
  },
  proofread: {
    temperature: 0.15,
    brief:
      '只修错别字、标点误用、语法错误和明显不通顺的搭配。读得通的句子一律不动，能不改就不改。',
  },
};

/* ------------------------------ 提示词 ------------------------------ */

const STYLE_RULES = `你是一位中文博客作者的文字编辑。你只做「润色」，不做改写。

【总原则】
- 只调整表达：语序、用词、标点、句子衔接。事实、观点、叙述顺序一概不动。
- 保持原文的段落划分和段落顺序。不要合并段落，也不要把一段拆成一堆短句。
- 不升华主题，不总结陈词，不提炼金句，不写「在这个快节奏的时代」这类空话。
- 不用公文腔、营销腔、翻译腔；这是个人博客，语气像跟熟人聊天。
- 原文里的语气词、口语、玩笑、方言、感叹号、省略号、破折号，属于作者的说话方式，保留。
- 篇幅与原文同一量级，不要为了「丰满」而扩写。
- 人名、地名、机构名、数字、日期、金额、单位、英文单词、代码标识符，逐字照抄。

【Markdown 硬约束】
- 逐字保留全部标记：标题的 #、列表的 - 和 1.、引用的 >、表格的 |、分隔线 ---、
  **加粗**、*斜体*、\`行内代码\`、代码围栏、图片 ![](...)、链接 [](...)、HTML 标签。
- 代码块内部一个字符都不许改，包括缩进和空行。
- 图片地址、链接地址、front matter（文件开头 --- 之间的部分）一律不改、不重排。
- 不要新增或删除段落之外的结构；不要把正文再包一层代码围栏。
- 段落之间仍然用一个空行分隔，原文怎么分就怎么分。

【输出】
- 只输出润色后的 Markdown 正文本身。不要前言、说明、总结、致谢、分隔线。
- 不要写「以下是润色后的版本」这类话，也不要解释你改了什么。`;

function scopeNote(scope) {
  if (scope === 'selection') {
    return '这次给你的是一篇文章中的一段（可能从句子中间开始、也可能在句子中间结束）。只润色给你这段，不要补全上下文，不要添加开头或结尾。';
  }
  return '这次给你的是完整的一篇。可以照顾全篇的呼应，但仍然逐段对应，一段对一段。';
}

/**
 * 拼消息。抽出来是为了能单测：提示词是这个功能里唯一「改了就出事」的地方，
 * 别让它只活在请求链里、测不到。
 */
export function buildMessages({ text, mode = 'polish', instruction = '', scope = 'document' }) {
  const preset = MODES[mode] || MODES.polish;
  let system = [
    STYLE_RULES,
    '',
    '【这一次的任务】',
    preset.brief,
    '',
    scopeNote(scope),
  ].join('\n');

  const extra = String(instruction || '').trim();
  if (extra) {
    // 自定义要求放在最后，权重高；但先声明它不能越过上面的硬约束
    system += `\n\n【作者的补充要求】\n${extra}\n（补充要求只改变写法偏好；与上面的 Markdown 硬约束冲突时，以硬约束为准。）`;
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
}

/* --------------------------- 非正文体检 --------------------------- */

function codeFences(text) {
  return (String(text).match(/^\s*(?:```|~~~)/gm) || []).length;
}

function inlineCodes(text) {
  return (String(text).match(/`[^`\n]+`/g) || []).length;
}

function linksIn(text) {
  const out = [];
  const pattern = /\]\(([^)\s]+)\)/g;
  const source = String(text);
  let match = pattern.exec(source);
  while (match) {
    out.push(match[1]);
    match = pattern.exec(source);
  }
  return out;
}

/**
 * 模型偶尔会「顺手」把链接删掉、把代码块里的注释翻译掉。
 * 这里不比正文，只比那些不该被碰的东西，返回人话警告给前端提示作者。
 * 只警告不拦截：多数情况下结果仍然可用，拦下来反而让人没法采纳。
 */
export function checkProtected(before, after) {
  const warnings = [];
  const a = String(before || '');
  const b = String(after || '');

  if (a.trimStart().startsWith('---') && !b.trimStart().startsWith('---')) {
    warnings.push('开头的 front matter 被改动了');
  }
  if (codeFences(a) !== codeFences(b)) {
    warnings.push('代码块的围栏数量跟原文对不上，检查一下代码有没有被改');
  }
  if (inlineCodes(a) !== inlineCodes(b)) {
    warnings.push('行内代码的数量跟原文对不上');
  }

  const missing = linksIn(a).filter((url) => b.indexOf(url) === -1);
  if (missing.length) {
    warnings.push(`有 ${missing.length} 个链接或图片地址不见了`);
  }
  return warnings;
}

/* ---------------------------- 结果清理 ---------------------------- */

/** 模型有时候会把整段答案套进 ``` 里，是「唯一的围栏」就剥掉。 */
export function unwrapFence(text) {
  const source = String(text || '').trim();
  const match = source.match(/^```[a-zA-Z0-9+-]*[ \t]*\n([\s\S]*?)\n?```$/);
  if (!match) return source;
  // 原文本身就是一段代码的话，剥完就空了——那种情况说明不该剥
  return match[1].trim() ? match[1].replace(/\s+$/, '') : source;
}

/* ---------------------------- 限流与去重 ---------------------------- */

/**
 * Workers 的 isolate 内存不是全局共享，这层限流只能管住「同一个边缘节点上的
 * 同一个作者」，严格说不是分布式限流。对单人后台够用，而且比每次都写 D1 便宜。
 */
const buckets = new Map();
const seenRids = new Map();

function prune(now) {
  for (const [key, bucket] of buckets) {
    if (!bucket.at.length || now - bucket.at[bucket.at.length - 1] > RATE_WINDOW_MS) buckets.delete(key);
  }
  for (const [rid, at] of seenRids) {
    if (now - at > RID_TTL_MS) seenRids.delete(rid);
  }
}

function gateRate(actor, rid) {
  const now = Date.now();
  prune(now);

  if (rid) {
    if (seenRids.has(rid)) return { ok: false, code: 'duplicate_request', message: '这一条已经在生成了，别重复点' };
    seenRids.set(rid, now);
  }

  const bucket = buckets.get(actor) || { at: [] };
  bucket.at = bucket.at.filter((t) => now - t < RATE_WINDOW_MS);
  if (bucket.at.length >= RATE_MAX_IN_WINDOW) {
    return { ok: false, code: 'rate_limited', message: '一分钟内润色次数到上限了，歇一会儿再来' };
  }
  const last = bucket.at[bucket.at.length - 1];
  if (last && now - last < MIN_GAP_MS) {
    return { ok: false, code: 'too_fast', message: '上一句还没生成完，慢一点' };
  }
  bucket.at.push(now);
  buckets.set(actor, bucket);
  return { ok: true };
}

/* ------------------------------ 上游错误 ------------------------------ */

function upstreamError(status, upstreamMessage) {
  const detail = String(upstreamMessage || '').slice(0, 160);
  if (status === 401 || status === 403) {
    return fail(502, 'ai_auth_failed', 'DeepSeek 密钥无效或没权限：重新 npx wrangler secret put DEEPSEEK_API_KEY');
  }
  if (status === 402) return fail(402, 'ai_no_balance', 'DeepSeek 账户余额不足，充值后再试');
  if (status === 429) return fail(429, 'ai_busy', 'DeepSeek 那边排队了，过十秒再试');
  if (status === 400) return fail(502, 'ai_bad_request', `DeepSeek 拒绝了这次请求：${detail || '参数有问题'}`);
  return fail(502, 'ai_upstream', `润色服务暂时不可用（${status}）${detail ? '：' + detail : ''}`);
}

/* -------------------------------- 主流程 -------------------------------- */

export async function handlePolish(request, env) {
  const apiKey = String(env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) {
    return fail(503, 'ai_not_configured', '还没配密钥：npx wrangler secret put DEEPSEEK_API_KEY（配完立即生效，不用重新部署）');
  }

  const raw = await request.text();
  if (raw.length > MAX_INPUT_CHARS * 4) return fail(413, 'payload_too_large', '这次送来的内容太大了');
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return fail(400, 'bad_json', '请求不是合法 JSON');
  }

  const text = String((body && body.text) || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return fail(400, 'empty_text', '没拿到要润色的正文');
  if (text.length > MAX_INPUT_CHARS) {
    return fail(413, 'text_too_long', `一次最多润色 ${MAX_INPUT_CHARS} 字，这段 ${text.length} 字——先选中一部分来润`);
  }

  const mode = MODES[body && body.mode] ? body.mode : 'polish';
  const scope = body && body.scope === 'selection' ? 'selection' : 'document';
  const instruction = String((body && body.instruction) || '').slice(0, MAX_INSTRUCTION_CHARS).trim();
  const rid = String((body && body.rid) || '').slice(0, 48).replace(/[^\w-]/g, '');

  const gate = gateRate(clientIp(request) || 'unknown', rid);
  if (!gate.ok) return fail(gate.code === 'rate_limited' || gate.code === 'too_fast' ? 429 : 409, gate.code, gate.message);

  const model = String(env.DEEPSEEK_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // 请求体在 try 之外拼：拼包本身的 bug 不该被当成「网络连不上」糊过去
  const upstreamBody = JSON.stringify({
    model,
    messages: buildMessages({ text, mode, instruction, scope }),
    temperature: (MODES[mode] || MODES.polish).temperature,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: false,
    // 润色是纯改写任务，不需要思考链：关掉既快又省，温度也才生效
    thinking: { type: 'disabled' },
  });

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: upstreamBody,
    });
  } catch (error) {
    clearTimeout(timer);
    // 请求体已经拼好了，这里再出错基本只剩「连不上」和「超时」两种
    if (error && error.name === 'AbortError') {
      console.error('[ai] timeout after', TIMEOUT_MS, 'ms');
      return fail(504, 'ai_timeout', '等了 60 秒还没回音，可能这段太长了，试着少选一点');
    }
    console.error('[ai] fetch failed:', String((error && error.message) || error).slice(0, 120));
    return fail(502, 'ai_network', '连不上润色服务，检查一下网络再试');
  }
  clearTimeout(timer);

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && (payload.error && payload.error.message || payload.message);
    // 只记状态码和一句话，绝不打印原文
    console.error('[ai] upstream', response.status, String(message || '').slice(0, 80));
    return upstreamError(response.status, message);
  }

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
  const polished = unwrapFence(content);
  if (!polished.trim()) {
    console.error('[ai] empty content, finish_reason=', choice && choice.finish_reason);
    return fail(502, 'ai_empty', '这次没拿到有效结果，再点一次试试');
  }
  if (choice.finish_reason === 'length') {
    return fail(502, 'ai_truncated', '结果被长度上限截断了，选中一段再润一次');
  }

  const elapsed = Date.now() - started;
  console.log('[ai] polish ok', mode, scope, text.length, '→', polished.length, `${elapsed}ms`);

  return json({
    ok: true,
    text: polished.replace(/\s+$/, ''),
    warnings: checkProtected(text, polished),
    model,
    chars: { in: text.length, out: polished.length },
    elapsed,
  });
}
