/**
 * 邮件通知（可选）。未配置 RESEND_API_KEY / COMMENTS_MAIL_FROM 时静默跳过。
 * Worker 里不能用浮动 Promise（请求结束后执行环境可能被回收），
 * 所以调用方必须 await，内部把错误吞掉。
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    const text = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
  }
  return { ok: true };
}

function mailTheme(env) {
  const accentRaw = String(env.COMMENTS_MAIL_ACCENT || '#42b983').trim();
  const accent = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(accentRaw) ? accentRaw : '#42b983';
  const brand = String(env.COMMENTS_MAIL_BRAND || 'Counting Stars').trim().slice(0, 80);
  const footer = String(env.COMMENTS_MAIL_FOOTER || `${brand} · 评论通知`).trim().slice(0, 160);
  const logoRaw = String(env.COMMENTS_MAIL_LOGO || '').trim();
  let logo = '';
  try {
    const parsed = new URL(logoRaw);
    if (parsed.protocol === 'https:') logo = parsed.href;
  } catch {
    /* 不合法的 logo 地址直接忽略 */
  }
  return { accent, brand, footer, logo };
}

function shell(env, title, bodyHtml) {
  const theme = mailTheme(env);
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6e6e6;border-radius:10px;overflow:hidden;">
    <div style="padding:16px 24px;border-bottom:1px solid #eee;font-weight:600;color:#3b3d42;">${theme.logo ? `<img src="${escapeHtml(theme.logo)}" alt="" width="28" height="28" style="vertical-align:middle;border-radius:6px;margin-right:10px;">` : ''}${escapeHtml(title)}</div>
    <div style="padding:20px 24px;color:#3b3d42;font-size:15px;line-height:1.7;">${bodyHtml}</div>
    <div style="height:3px;background:${theme.accent};"></div>
    <div style="padding:12px 24px;border-top:1px solid #eee;color:#999;font-size:12px;">${escapeHtml(theme.footer)}</div>
  </div></body></html>`;
}

export async function notifyNewComment(env, { threadTitle, threadUrl, nick, content, website, region }) {
  const to = env.COMMENTS_ADMIN_EMAIL;
  if (!to) return { skipped: true };

  const body = `
    <p style="margin:0 0 8px;color:#888;font-size:13px;">${escapeHtml(threadTitle || '未命名页面')}</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(nick)}</strong>
      ${region ? `<span style="color:#999;font-size:12px;"> · ${escapeHtml(region)}</span>` : ''}
      ${website ? ` · <a href="${escapeHtml(website)}" style="color:${mailTheme(env).accent};">${escapeHtml(website)}</a>` : ''}
    </p>
    <div style="padding:12px 16px;background:#fafafa;border-left:3px solid #42b983;border-radius:4px;white-space:pre-wrap;">${escapeHtml(content)}</div>
    ${threadUrl ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(threadUrl)}" style="color:${mailTheme(env).accent};">前往查看 / 回复 →</a></p>` : ''}
  `;

  return send(env, {
    to,
    subject: `新评论：${nick} 在《${threadTitle || '未命名页面'}》留言了`,
    html: shell(env, '收到一条新评论', body),
    text: `${nick} 在《${threadTitle || '未命名页面'}》留言：\n\n${content}${threadUrl ? `\n\n查看：${threadUrl}` : ''}`,
  }).catch((error) => {
    console.error('[comments] notify admin failed:', error.message);
    return { ok: false };
  });
}

export async function notifyReply(env, { toEmail, threadTitle, threadUrl, nick, content, parentNick, unsubscribeUrl }) {
  if (!toEmail) return { skipped: true };

  const body = `
    <p style="margin:0 0 12px;">${escapeHtml(parentNick || '你')}，有人在
      <strong>${escapeHtml(threadTitle || '页面')}</strong> 回复了你：</p>
    <p style="margin:0 0 12px;"><strong>${escapeHtml(nick)}</strong></p>
    <div style="padding:12px 16px;background:#fafafa;border-left:3px solid #42b983;border-radius:4px;white-space:pre-wrap;">${escapeHtml(content)}</div>
    ${threadUrl ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(threadUrl)}" style="color:${mailTheme(env).accent};">查看回复 →</a></p>` : ''}
    ${unsubscribeUrl ? `<p style="margin:18px 0 0;font-size:12px;color:#999;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#888;">不再接收这条评论的回复提醒</a></p>` : ''}
  `;

  return send(env, {
    to: toEmail,
    subject: `${nick} 回复了你在《${threadTitle || '页面'}》的评论`,
    html: shell(env, '有人回复了你', body),
    text: `${parentNick || '你'}，${nick} 回复了你在《${threadTitle || '页面'}》的评论：\n\n${content}${threadUrl ? `\n\n查看：${threadUrl}` : ''}${unsubscribeUrl ? `\n\n关闭提醒：${unsubscribeUrl}` : ''}`,
  }).catch((error) => {
    console.error('[comments] notify reply failed:', error.message);
    return { ok: false };
  });
}
