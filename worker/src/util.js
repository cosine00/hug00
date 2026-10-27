/**
 * 通用工具：哈希、校验、UA 解析、地区、反垃圾。
 * 全部为 Workers 运行时可直接使用的实现（不依赖 Node 内置模块）。
 */

/* --------------------------------- 哈希 ---------------------------------- */

// RFC 1321 MD5 的紧凑实现。
// Workers 的 Web Crypto 不提供 MD5，而邮箱头像（Gravatar）必须用 MD5，
// 所以这里自己实现，避免为了一个哈希去开 nodejs_compat。
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }
  return k;
})();

export function md5(value) {
  const msg = new TextEncoder().encode(String(value));
  const len = msg.length;
  const total = (((len + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;

  const view = new DataView(buf.buffer);
  const bitLen = len * 8;
  view.setUint32(total - 8, bitLen >>> 0, true);
  view.setUint32(total - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Int32Array(16);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) m[i] = view.getInt32(off + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + MD5_K[i] + m[g]) | 0;
      a = d;
      d = c;
      c = b;
      const s = MD5_S[i];
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const word = (n) => {
    let out = '';
    for (let i = 0; i < 4; i += 1) {
      out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return out;
  };

  return word(a0) + word(b0) + word(c0) + word(d0);
}

export async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------- 响应工具 -------------------------------- */

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function fail(status, code, message) {
  return json({ ok: false, error: { code, message } }, status);
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    // 不强制，但常见表单提交也允许
  }
  const text = await request.text();
  if (!text) return {};
  if (text.length > 64 * 1024) throw new Error('payload_too_large');
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    ''
  );
}

/* ------------------------------ 线程 Key 规范 ----------------------------- */

/**
 * 线程 key 是评论归属的唯一锚点：
 *   文章：post:<相对路径>   例 post:/posts/hello/
 *   哔哔：memo:<memo id>    例 memo:1233
 *   独立页：page:<相对路径>  例 page:/about/
 *
 * 兼容旧 Twikoo 的 path（/posts/xxx/、/memos/1233），方便迁移历史评论。
 */
export function normalizeThreadKey(input) {
  let key = String(input || '').trim();
  if (!key) return '';

  // 带域名的地址先剥成 path，后面几条规则才认得出来
  if (/^https?:\/\//i.test(key)) {
    try {
      key = new URL(key).pathname || key;
    } catch (error) {
      /* 不像 URL 就原样保留 */
    }
  }

  const legacyMemo = key.match(/^\/?memos\/(\d+)\/?$/);
  if (legacyMemo) return `memo:${legacyMemo[1]}`;

  // 哔哔单条页 /m/1233/ → memo:1233（导回 Twikoo 时 url 就是这个形状）
  const memoPath = key.match(/^\/?m\/(\d+)\/?$/);
  if (memoPath) return `memo:${memoPath[1]}`;

  // 老 Twikoo 的文章 path：/posts/hello/ → post:/posts/hello/
  // 老数据里见过三种不规范写法，这里一并抹平，否则同一篇文章会被拆成两个线程：
  //   /posts/watermelon        —— 少了结尾斜杠
  //   /posts/posts/easy-go/    —— 早年前缀重复了一层
  //   //posts/xxx/             —— 多打了一根斜杠
  if (/^\/?posts\//.test(key)) {
    let path = key.startsWith('/') ? key : `/${key}`;
    path = path.replace(/\/{2,}/g, '/');
    path = path.replace(/^\/posts\/posts\//, '/posts/');
    if (!path.endsWith('/')) path += '/';
    return `post:${path}`.slice(0, 512);
  }

  if (/^\d+$/.test(key)) return `memo:${key}`;

  if (/^(post|memo|page):/.test(key)) return key.slice(0, 512);

  if (key.length > 512) key = key.slice(0, 512);
  return `page:${key.startsWith('/') ? key : `/${key}`}`;
}

export function memoThreadKey(id) {
  return `memo:${String(id).replace(/[^\d]/g, '')}`;
}

/* -------------------------------- 输入校验 ------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

export function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

/**
 * 补全网址的协议头。
 * 从 Twikoo 迁过来的 link 有一大半是裸域名（hux.ink、www.hux.ink/xxx），
 * 直接塞进 <a href> 会被浏览器当成相对路径，点一下跑到 /about/hux.ink 去。
 * 危险协议（javascript:、data:）原样返回，交给 URL_RE 报错，不静默吞掉。
 */
export function normalizeWebsite(value) {
  const raw = cleanText(value, 200);
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

export function validateCommentInput(input) {
  const errors = [];
  const nick = cleanText(input.nick, 40);
  const email = cleanText(input.email, 120).toLowerCase();
  const website = normalizeWebsite(input.website);
  // 页面上的字数上限是 500，服务端按住同一条线；超了明确报错，不静默截断
  const rawContent = String(input.content == null ? '' : input.content)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  const content = rawContent.slice(0, 500);
  const threadKey = normalizeThreadKey(input.threadKey);
  const threadUrl = cleanText(input.threadUrl, 512);
  const threadTitle = cleanText(input.threadTitle, 200);

  if (!nick) errors.push(['nick_required', '请填写昵称']);
  // 邮箱是头像与回复提醒的依据，必须填写（不会公开）
  if (!email) errors.push(['email_required', '请填写邮箱，它不会公开显示']);
  else if (!EMAIL_RE.test(email)) errors.push(['email_invalid', '邮箱格式不正确']);
  // 上面已经自动补过协议，走到这里还不过就说明协议本身有问题
  if (website && !URL_RE.test(website)) errors.push(['website_invalid', '网址格式不正确，只支持 http/https']);
  if (!content) errors.push(['content_required', '说点什么吧']);
  if (content.length < 2) errors.push(['content_too_short', '内容太短了']);
  if (rawContent.length > 500) errors.push(['content_too_long', '内容不要超过 500 字']);
  if (!threadKey) errors.push(['thread_required', '缺少评论目标']);

  let parentId = null;
  if (input.parentId != null && input.parentId !== '') {
    parentId = Number(input.parentId);
    if (!Number.isInteger(parentId) || parentId <= 0) errors.push(['parent_invalid', '回复目标不正确']);
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      nick,
      email,
      website,
      content,
      threadKey,
      threadUrl,
      threadTitle,
      parentId,
      notify: Boolean(input.notify),
      honeypot: cleanText(input.hp, 200),
      elapsed: Number(input.elapsed) || 0,
      turnstileToken: cleanText(input.turnstileToken, 2048),
    },
  };
}

/* -------------------------------- UA 解析 -------------------------------- */

const BROWSERS = [
  [/EdgA?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/Vivaldi\/(\d+)/, 'Vivaldi'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/MicroMessenger\/(\d+)/, '微信'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari'],
  [/Safari\/(\d+)/, 'Safari'],
];

const SYSTEMS = [
  [/Windows NT 10\.0/, 'Windows 10/11'],
  [/Windows NT 6\.3/, 'Windows 8.1'],
  [/Windows NT 6\.1/, 'Windows 7'],
  [/iPhone|iPod/, 'iOS'],
  [/iPad/, 'iPadOS'],
  [/Android (\d+)/, 'Android'],
  [/Mac OS X (\d+)[._](\d+)/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function parseUserAgent(ua) {
  const raw = String(ua || '');
  if (!raw) return { browser: '', os: '' };

  let browser = '';
  for (const [re, name] of BROWSERS) {
    const m = raw.match(re);
    if (m) {
      browser = m[1] ? `${name} ${m[1]}` : name;
      break;
    }
  }

  let os = '';
  for (const [re, name] of SYSTEMS) {
    const m = raw.match(re);
    if (m) {
      os = name;
      if (name === 'Android' && m[1]) os = `Android ${m[1]}`;
      if (name === 'macOS') os = `macOS ${m[1]}.${m[2]}`;
      break;
    }
  }

  return { browser, os };
}

/* -------------------------------- 地区映射 ------------------------------- */

const COUNTRY_CN = {
  CN: '中国', HK: '中国香港', MO: '中国澳门', TW: '中国台湾',
  US: '美国', JP: '日本', SG: '新加坡', MY: '马来西亚', KR: '韩国',
  GB: '英国', DE: '德国', FR: '法国', CA: '加拿大', AU: '澳大利亚',
  NL: '荷兰', RU: '俄罗斯', IN: '印度', TH: '泰国', VN: '越南',
  ID: '印度尼西亚', PH: '菲律宾', NZ: '新西兰', SE: '瑞典', CH: '瑞士',
  IT: '意大利', ES: '西班牙', BR: '巴西', AE: '阿联酋', IE: '爱尔兰',
  FI: '芬兰', NO: '挪威', DK: '丹麦', PL: '波兰', TR: '土耳其',
  IL: '以色列', ZA: '南非', MX: '墨西哥', AR: '阿根廷', PT: '葡萄牙',
  BE: '比利时', AT: '奥地利', CZ: '捷克', UA: '乌克兰', PK: '巴基斯坦',
};

function safeDecode(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Cloudflare 会在边缘填充 request.cf（国家、城市等）。
 * 优先用 cf-ipcity 头（按访问者语言本地化，中文访问者得到中文城市名），
 * 退化到 request.cf 的英文字段。
 */
export function formatRegion(request) {
  const country = String(
    request.headers.get('cf-ipcountry') || (request.cf && request.cf.country) || ''
  ).toUpperCase();

  const city =
    safeDecode(request.headers.get('cf-ipcity')) ||
    String((request.cf && request.cf.city) || '');
  const region =
    safeDecode(request.headers.get('cf-region')) ||
    String((request.cf && request.cf.region) || '');

  const countryName = COUNTRY_CN[country] || country;
  if (!countryName) return '';
  if (city) return `${countryName} ${city}`;
  if (region) return `${countryName} ${region}`;
  return countryName;
}

/* -------------------------------- 等级徽章 ------------------------------- */

export const LEVELS = [
  { min: 1, name: '新朋友', tone: 'new' },
  { min: 5, name: '常客', tone: 'regular' },
  { min: 20, name: '老茶客', tone: 'veteran' },
  { min: 50, name: '元老', tone: 'elder' },
];

export function levelFor(count) {
  let level = LEVELS[0];
  for (const item of LEVELS) {
    if (count >= item.min) level = item;
  }
  return { name: level.name, tone: level.tone };
}

/* -------------------------------- 反垃圾 --------------------------------- */

const SPAM_PATTERNS = [
  /(?:https?:\/\/|www\.)[^\s]{0,80}(?:casino|porn|sex|viagra|loan|betting|gambling|彩票|博彩|代开|发票|加微)/i,
  /(?:加|联系)\s*(?:微信|QQ|telegram|TG)\s*[:：]?\s*\w{5,}/i,
];

export function spamScore({ content, nick, website }) {
  let score = 0;
  const text = `${nick}\n${content}`;

  if (SPAM_PATTERNS.some((re) => re.test(text))) score += 6;

  const links = content.match(/https?:\/\/[^\s]+/gi) || [];
  if (links.length >= 3) score += 4;
  else if (links.length === 2) score += 1;

  if (website && links.length === 0 && content.length < 12) score += 2;

  const cjk = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
  const letters = (content.match(/[a-zA-Z]/g) || []).length;
  if (letters > 60 && cjk === 0) score += 2;

  if (/(.)\1{9,}/.test(content)) score += 2;

  return score;
}
