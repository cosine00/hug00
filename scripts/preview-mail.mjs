/**
 * 本地预览评论通知邮件（不发送，只把 HTML 渲染到磁盘）。
 *
 *   node scripts/preview-mail.mjs
 *
 * 产出：.preview/mail-reply.html、.preview/mail-new-comment.html
 * 直接双击（或用浏览器打开）即可看到邮件在邮件客户端里的样子。
 * 想临时换主色：COMMENTS_MAIL_ACCENT='#c86f67' node scripts/preview-mail.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderNewCommentEmail, renderReplyEmail } from '../worker/src/mail.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.preview');

const env = {
  COMMENTS_MAIL_ACCENT: process.env.COMMENTS_MAIL_ACCENT || '#6870a8',
  COMMENTS_MAIL_BRAND: process.env.COMMENTS_MAIL_BRAND || 'Counting Stars💫',
  COMMENTS_MAIL_FOOTER: process.env.COMMENTS_MAIL_FOOTER || '',
  COMMENTS_MAIL_LOGO: process.env.COMMENTS_MAIL_LOGO || '',
  COMMENTS_SITE_URL: 'https://hux.ink',
};

const now = Math.floor(Date.now() / 1000);

const samples = {
  'mail-reply.html': renderReplyEmail(env, {
    threadTitle: '三大自托管系统使用感受',
    threadUrl: 'https://hux.ink/posts/self-hosted-stack/#comments',
    nick: 'Mr.He',
    content: '家里没有公网，网友真强大。我这边干脆挂了个 frp 到云服务器上，延迟还行，就是流量费有点肉。\n图片我一般直接丢对象存储，省得占 VPS。',
    parentNick: '落落vici',
    parentContent: '我的 twikoo 都署在家里的群晖上😜',
    parentCreatedAt: now - 86400 * 3,
    createdAt: now,
  }),
  'mail-new-comment.html': renderNewCommentEmail(env, {
    threadTitle: '小狐狸钱包 万象拼音 ＋ 极点五笔 三方案部署教程',
    threadUrl: 'https://hux.ink/posts/ime-setup/#comments',
    nick: '老张',
    content: '现在兼容输入法，在PC就直接口喷了！',
    website: 'https://laozhang.org',
    region: '中国 广东',
    createdAt: now,
  }),
};

await mkdir(outDir, { recursive: true });
for (const [name, mail] of Object.entries(samples)) {
  await writeFile(join(outDir, name), mail.html, 'utf8');
  console.log(`✓ ${name}  (${mail.subject})`);
}
console.log(`\n输出目录：${outDir}`);
