/**
 * 邮件通知（可选）。未配置 RESEND_API_KEY / COMMENTS_MAIL_FROM 时静默跳过。
 * Worker 里不能用浮动 Promise（请求结束后执行环境可能被回收），
 * 所以调用方必须 await，内部把错误吞掉。
 *
 * 版式说明（2026-10 重做）：
 * - 整封信是一张航空信封：米色信封体 + 淡红淡蓝斜纹，桌面/手机都居中单列；
 * - 斜纹只出现在信封那一段（左右两条 10px 窄列 + 底部一条），信纸两侧是页面底色；
 * - 「信纸」与信封内胆同宽（10px + 中列 + 10px 三列固定布局，别用 padding + width:100%，会错位）；
 *   信纸下沿接住前袋的白色 V 形三角（信纸顺着 V 陷进信封里）；
 * - 信纸里抬头是「评论通知」小字 + 大标题，正文一行灰字交代语境（谁 / 在哪篇文章）；
 * - 新评论/回复内容放进左侧 3px 主色竖条的浅色卡片，作者与时间在卡片顶部；
 * - 原评论另起一个灰底引用块（只截前 160 字），形成"新回复 vs 我的原话"的对照；
 * - 主按钮实色 + 次按钮描边，都用 table 布局保证各邮箱客户端一致；
 * - 信封下沿是虚线邮票 + 品牌落款，卡片外面是"自动发出请勿直接回复"与版权页脚。
 * 所有颜色取值都走 mailTheme()，可用环境变量覆盖，不写死在模板里。
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/* 中国大陆常用邮箱对字体/行高的容忍度较好，这里只放最通用的一档 */
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 转义后把换行变成 <br>：邮件里 white-space:pre-wrap 在部分客户端会被吃掉 */
function nl2br(value) {
  return escapeHtml(String(value == null ? '' : value).replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

/** 只放行 http(s)，挡掉 javascript: 之类的脏数据 */
function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
  } catch {
    /* 非法地址直接丢弃 */
  }
  return '';
}

/** 截断超长内容，避免引用块把邮件拉得很长 */
function clamp(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 秒级时间戳 → 北京时间 YYYY-MM-DD HH:MM（固定 +8，不依赖运行时 ICU） */
function formatTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date((seconds + 8 * 3600) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

async function send(env, { to, subject, html, text, replyTo }) {
  const key = env.RESEND_API_KEY;
  const from = env.COMMENTS_MAIL_FROM;
  if (!key || !from || !to) return { skipped: true };

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  return { ok: true };
}

/* --------------------------------- 配色 / 文案 -------------------------------- */

function mailTheme(env) {
  const accentRaw = String(env.COMMENTS_MAIL_ACCENT || '#6870a8').trim();
  const accent = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(accentRaw) ? accentRaw : '#6870a8';
  const brand = String(env.COMMENTS_MAIL_BRAND || 'Counting Stars💫').trim().slice(0, 80);
  const year = new Date().getFullYear();
  // 页脚版权行默认不显示（2026-10-28 用户要求去掉）；显式配置 COMMENTS_MAIL_FOOTER 才渲染
  const footer = String(env.COMMENTS_MAIL_FOOTER || '').trim().slice(0, 160);
  const logoRaw = String(env.COMMENTS_MAIL_LOGO || '').trim();
  let logo = '';
  try {
    const parsed = new URL(logoRaw);
    if (parsed.protocol === 'https:') logo = parsed.href;
  } catch {
    /* 不合法的 logo 地址直接忽略 */
  }
  const siteUrl = safeUrl(env.COMMENTS_SITE_URL || 'https://hux.ink');
  return { accent, brand, footer, logo, siteUrl };
}

/* ---------------------------------- 版式积木 --------------------------------- */

function button(href, label, theme) {
  const url = safeUrl(href);
  if (!url) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
    <tr>
      <td align="center" bgcolor="${theme.accent}" style="border-radius:8px;background:${theme.accent};">
        <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:11px 22px;font-family:${FONT_STACK};font-size:14px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function ghostButton(href, label) {
  const url = safeUrl(href);
  if (!url) return '';
  // 次按钮落在米色信封上，描边与文字都取米色系，避免一块白底贴在信身上
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
    <tr>
      <td align="center" bgcolor="#fffdf7" style="border:1px solid #e2d8c2;border-radius:8px;background:#fffdf7;">
        <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:11px 22px;font-family:${FONT_STACK};font-size:14px;font-weight:600;line-height:1.2;color:#7d7461;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** 一行灰字语境说明：谁 + 做了什么 + 在哪篇文章（书名号由这里统一加） */
function contextLine(leading, threadTitle, threadUrl, theme, suffix) {
  const title = escapeHtml(threadTitle || '未命名页面');
  const link = safeUrl(threadUrl);
  const titleHtml = link
    ? `<a href="${escapeHtml(link)}" target="_blank" style="color:${theme.accent};text-decoration:none;font-weight:600;">《${title}》</a>`
    : `<strong style="color:#3a3d43;">《${title}》</strong>`;
  return `<div style="font-family:${FONT_STACK};font-size:14px;line-height:1.7;color:#83868d;">${leading}${titleHtml}${suffix || ''}</div>`;
}

/** 正文卡片：左侧 3px 主色竖条 + 作者/时间 + 内容 */
function contentCard({ accent, meta, content, tone }) {
  const bg = tone === 'muted' ? '#f7f6f3' : '#fbfaf8';
  const border = tone === 'muted' ? '#efeee9' : '#f0efea';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${bg};border:1px solid ${border};border-left:3px solid ${accent};border-radius:10px;">
    <tr>
      <td style="padding:14px 16px 15px;">
        ${meta ? `<div style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:#9a9da4;margin-bottom:8px;">${meta}</div>` : ''}
        <div style="font-family:${FONT_STACK};font-size:15px;line-height:1.8;color:${tone === 'muted' ? '#6f7278' : '#2f3238'};">${nl2br(content)}</div>
      </td>
    </tr>
  </table>`;
}

/** 原评论引用块（灰底、无竖条、字号略小），和新内容区分开 */
function quoteBlock(label, content) {
  const text = clamp(content, 160);
  if (!text) return '';
  return `<div style="margin-top:14px;padding:13px 16px;background:#f7f6f3;border-radius:10px;">
    <div style="font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:#a0a29f;margin-bottom:6px;">${escapeHtml(label)}</div>
    <div style="font-family:${FONT_STACK};font-size:14px;line-height:1.7;color:#77797f;">${nl2br(text)}</div>
  </div>`;
}

/**
 * 信封外壳：航空信封的淡色红蓝斜纹 + 米色信封体，信纸（正文）与信封内胆同宽。
 * 整封信自上而下三截：
 * 1. 信纸（露在信封外面的上半段）：左右 10px 是页面底色，斜纹还没出现；
 * 2. 信封口（按钮所在的这一截）：左右 10px 换成斜纹，中间仍是白纸——斜纹从两侧包上来，
 *    白纸继续往下写，视觉上就是信纸的下半截插进了信封，按钮正好落在信封中部高度；
 * 3. 前袋 + 落款：白色 V 形三角接住白纸（信纸顺着 V 陷进去），下面是邮票与品牌。
 * 全部纯 CSS，不依赖外链图片：
 * - 前袋 V：白色 border 三角，底边与信纸同宽、平顶对齐信纸下沿，
 *   容器 overflow:hidden 让窄屏两侧自然裁掉，V 尖始终在正中；
 * - 邮票：虚线圆 + STAMP 字样（Outlook 不认圆角时退化成虚线方块，也能看）。
 */
function envelope(theme, { eyebrow, heading, body, action }) {
  const stripes =
    'repeating-linear-gradient(45deg,#dfa5a1 0 12px,#fdfcf8 12px 24px,#adbede 24px 36px,#fdfcf8 36px 48px)';
  const stripeCell = `<td width="10" bgcolor="#fdfcf8" style="width:10px;background:${stripes};background-color:#fdfcf8;font-size:0;line-height:0;">&nbsp;</td>`;
  const plainCell = '<td width="10" bgcolor="#f4f3ef" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>';
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f3ef" style="width:100%;max-width:600px;table-layout:fixed;border-collapse:separate;">
          <!-- 信纸上半段：露在信封口外面；两侧 10px 留给页面底色，斜纹还没开始 -->
          <tr>
            ${plainCell}
            <td bgcolor="#ffffff" style="background:#ffffff;border-top:4px solid ${theme.accent};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:separate;background:#ffffff;">
                <tr>
                  <td style="padding:22px 26px 0;">
                    ${theme.logo ? `<img src="${escapeHtml(theme.logo)}" width="26" height="26" alt="" style="display:block;border:0;border-radius:7px;margin-bottom:12px;">` : ''}
                    ${eyebrow ? `<div style="font-family:${FONT_STACK};font-size:12px;font-weight:600;line-height:1.4;letter-spacing:0.06em;color:#a6a49d;">${escapeHtml(eyebrow)}</div>` : ''}
                    <div style="${eyebrow ? 'margin-top:9px' : 'margin-top:0'};font-family:${FONT_STACK};font-size:21px;font-weight:700;line-height:1.45;color:#23262b;letter-spacing:0.01em;">${heading}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 26px 22px;">
                    ${body}
                  </td>
                </tr>
              </table>
            </td>
            ${plainCell}
          </tr>
          <!-- 信封口：斜纹从两侧包上来，白纸在这里收尾（信的正文刚插进信封） -->
          <tr>
            ${stripeCell}
            <td bgcolor="#ffffff" style="background:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:separate;background:#ffffff;">
                <tr>
                  <td style="padding:0 26px 18px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
            ${stripeCell}
          </tr>
          <!-- 信封前袋：白纸顺着 V 陷进米色信封里，按钮落在信封口下方、整只信封的中段 -->
          <tr>
            ${stripeCell}
            <td bgcolor="#fcf9f0" style="background:#fcf9f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fcf9f0" style="border-collapse:separate;background:#fcf9f0;">
                <tr>
                  <td style="padding:0;background:#fcf9f0;">
                    <div style="height:90px;overflow:hidden;background:#fcf9f0;font-size:0;line-height:0;">
                      <div style="width:0;height:0;margin:0 auto;border-left:290px solid transparent;border-right:290px solid transparent;border-top:90px solid #ffffff;font-size:0;line-height:0;"></div>
                    </div>
                  </td>
                </tr>
                ${
                  action
                    ? `<tr>
                  <td align="center" style="padding:22px 20px 16px;background:#fcf9f0;">${action}</td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding:${action ? '0' : '12px'} 20px 14px;background:#fcf9f0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="62" height="62" align="center" valign="middle" style="width:62px;height:62px;border:1px dashed #d9cdb4;border-radius:50%;color:#c9bda3;font-family:${FONT_STACK};font-size:8px;font-weight:600;letter-spacing:0.2em;">STAMP</td>
                        <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
                        <td style="font-family:${FONT_STACK};font-size:11px;line-height:1.7;color:#bfb39a;">${escapeHtml(theme.brand)}<br>评论通知</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
            ${stripeCell}
          </tr>
          <!-- 信封底沿的斜纹 -->
          <tr>
            <td colspan="3" height="10" bgcolor="#fdfcf8" style="height:10px;background:${stripes};background-color:#fdfcf8;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>`;
}

function shell(env, { eyebrow, title, body, action, footerNote }) {
  const theme = mailTheme(env);
  const siteUrl = escapeHtml(theme.siteUrl || 'https://hux.ink');
  // 页脚里的品牌名统一做成回主页的链接；footer 是自定义文案时也只替换品牌名那一段
  const brandLink =
    `<a href="${siteUrl}" target="_blank" style="color:#8f8d86;text-decoration:underline;">${escapeHtml(theme.brand)}</a>`;
  const footerHtml = theme.footer
    ? escapeHtml(theme.footer).split(escapeHtml(theme.brand)).join(brandLink)
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title || '')}</title>
</head>
<body style="margin:0;padding:0;background:#f4f3ef;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(footerNote || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f3ef;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        ${envelope(theme, { eyebrow, heading: escapeHtml(title || ''), body, action })}
        <div style="margin-top:16px;font-family:${FONT_STACK};font-size:12px;line-height:1.9;color:#a3a29d;">此邮件由 ${brandLink} 自动发出，请勿直接回复。</div>
        ${footerHtml ? `<div style="margin-top:4px;font-family:${FONT_STACK};font-size:11px;line-height:1.6;color:#b8b6af;">${footerHtml}</div>` : ''}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ---------------------------------- 模板函数 --------------------------------- */

/** 有人回复了您 —— 主场景 */
export function renderReplyEmail(env, params) {
  const theme = mailTheme(env);
  const {
    threadTitle,
    threadUrl,
    nick,
    content,
    parentNick,
    parentContent,
    parentCreatedAt,
    createdAt,
  } = params || {};

  const who = escapeHtml(nick || '有人');
  const time = formatTime(createdAt);
  const meta = time ? `${who} · ${escapeHtml(time)}` : who;

  // 评论链接通常带 #comments 锚点；「原文页面」去掉锚点指回文章本身，
  // 两者相同时就不重复放第二个按钮
  const fullUrl = safeUrl(threadUrl);
  let articleUrl = '';
  try {
    if (fullUrl) {
      const parsed = new URL(fullUrl);
      parsed.hash = '';
      if (parsed.href !== fullUrl) articleUrl = parsed.href;
    }
  } catch {
    /* 链接不合法就不给次要按钮 */
  }

  const body = `
    ${contextLine(`${who} 回复了您在`, threadTitle, threadUrl, theme, '中的评论')}
    <div style="margin-top:16px;">
      ${contentCard({ accent: theme.accent, meta, content })}
    </div>
    ${quoteBlock(`${parentNick || '您'} 的原评论${parentCreatedAt ? ` · ${formatTime(parentCreatedAt)}` : ''}`, parentContent)}
  `;

  // 按钮单独交给信封「信封口」那一截渲染，落在信封的中部高度
  const action = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
      <tr>
        <td>${button(threadUrl, '查看完整对话', theme)}</td>
        ${articleUrl ? `<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td><td>${ghostButton(articleUrl, '原文页面')}</td>` : ''}
      </tr>
    </table>`;

  const text = [
    `${parentNick || '您'}，${nick} 回复了您在《${threadTitle || '页面'}》的评论：`,
    '',
    content,
    parentContent ? `\n—— 您的原评论 ——\n${clamp(parentContent, 160)}` : '',
    threadUrl ? `\n查看：${threadUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: `${nick} 回复了您在《${threadTitle || '页面'}》的评论`,
    html: shell(env, {
      title: `您在 ${theme.brand} 上的评论有了新回复`,
      body,
      action,
      footerNote: `${nick} 回复了您的评论：${clamp(content, 80)}`,
    }),
    text,
  };
}

/** 站里有新评论 —— 发给博主自己 */
export function renderNewCommentEmail(env, params) {
  const theme = mailTheme(env);
  const { threadTitle, threadUrl, nick, content, website, region, createdAt } = params || {};

  const who = escapeHtml(nick || '匿名');
  const time = formatTime(createdAt);
  const extras = [region ? escapeHtml(region) : '', safeUrl(website)
    ? `<a href="${escapeHtml(safeUrl(website))}" target="_blank" style="color:${theme.accent};text-decoration:none;">${escapeHtml(safeUrl(website))}</a>`
    : '']
    .filter(Boolean)
    .join(' · ');
  const meta = [time ? escapeHtml(time) : '', extras].filter(Boolean).join(' · ');

  const body = `
    ${contextLine(`<strong style="color:#3a3d43;">${who}</strong> 在`, threadTitle, threadUrl, theme, '留言了')}
    <div style="margin-top:16px;">
      ${contentCard({ accent: theme.accent, meta, content })}
    </div>
  `;

  const action = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
      <tr>
        <td>${button(threadUrl, '前往查看 / 回复', theme)}</td>
      </tr>
    </table>`;

  const text = `${nick} 在《${threadTitle || '未命名页面'}》留言：\n\n${content}${threadUrl ? `\n\n查看：${threadUrl}` : ''}`;

  return {
    subject: `新评论：${nick} 在《${threadTitle || '未命名页面'}》留言了`,
    html: shell(env, {
      title: `${theme.brand} 有新的评论了耶~`,
      body,
      action,
      footerNote: `${nick} 在《${threadTitle || '页面'}》留言：${clamp(content, 80)}`,
    }),
    text,
  };
}

/* ----------------------------------- 对外接口 -------------------------------- */

export async function notifyNewComment(env, params) {
  const to = env.COMMENTS_ADMIN_EMAIL;
  if (!to) return { skipped: true };

  const mail = renderNewCommentEmail(env, params);
  return send(env, { to, ...mail }).catch((error) => {
    console.error('[comments] notify admin failed:', error.message);
    return { ok: false };
  });
}

export async function notifyReply(env, params) {
  const toEmail = params && params.toEmail;
  if (!toEmail) return { skipped: true };

  const mail = renderReplyEmail(env, params);
  return send(env, { to: toEmail, ...mail }).catch((error) => {
    console.error('[comments] notify reply failed:', error.message);
    return { ok: false };
  });
}
