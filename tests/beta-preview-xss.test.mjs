import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * 预览与 AI 结果的渲染链：markdown() → inline() → escapeHtml()。
 * 这条链的输出会被塞进 previewFrame.srcdoc 和 aiRenderEl.innerHTML，
 * 所以「正文里的字符有没有可能变成标签或属性」是这里要盯的事。
 *
 * 直接把源文件里的函数抽出来跑，避免测试里再抄一份实现 —— 抄一份就测不到真实代码。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(here, '..', 'static', 'beta', 'index.html'), 'utf8');

/** 从 index.html 里按名字取一个函数声明（花括号配平，够用且不依赖格式）。 */
function grab(name) {
  const start = HTML.indexOf('function ' + name + '(');
  assert.ok(start > -1, `源文件里找不到 function ${name}`);
  let index = HTML.indexOf('{', start);
  let depth = 0;
  for (; index < HTML.length; index += 1) {
    if (HTML[index] === '{') depth += 1;
    else if (HTML[index] === '}') {
      depth -= 1;
      if (!depth) return HTML.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 没有闭合`);
}

const SOURCE = ['escapeHtml', 'safeUrl', 'inline', 'markdown'].map(grab).join('\n');
const { escapeHtml, safeUrl, inline, markdown } = new Function(
  SOURCE + '\nreturn { escapeHtml, safeUrl, inline, markdown };'
)();

const PICTURE = 'https://img.hux.ink/2026/11/a.png';

/* ------------------------------ 转义本身 ------------------------------- */

test('escapeHtml 连引号一起转义：属性值里的引号是最容易被忽略的突破口', () => {
  assert.equal(escapeHtml('a"b\'c<d>&'), 'a&quot;b&#39;c&lt;d&gt;&amp;');
});

test('escapeHtml 先处理 & 再处理别的，不会二次转义', () => {
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

/* ------------------------------ 属性注入 ------------------------------- */

test('图片 alt 里的引号注入被挡住：整段降级成文字', () => {
  // 未修复前会输出 <img alt="a"onerror="alert(1)" src="x">
  const out = inline(escapeHtml('![a"onerror="alert(1)](x)'));
  assert.ok(!out.includes('<img'), `不该生成 img：${out}`);
  assert.ok(!out.includes('<'), `一个标签都不该留下：${out}`);
  assert.ok(out.includes('&quot;'), '引号应该以实体形式留在文字里');
});

test('alt 里有引号但地址合法时，仍然出图，且属性结构没有被撑开', () => {
  const out = inline(escapeHtml(`![a"onerror="alert(1)](${PICTURE})`));
  // 严格结构：三个属性，值里不许出现裸引号（否则就跳出属性了）
  assert.match(out, /^<img alt="[^"<>]*" src="[^"<>]*" loading="lazy">$/, out);
  assert.ok(out.includes('&quot;onerror='), '引号应该以实体形式留在 alt 里');
  assert.equal((out.match(/="/g) || []).length, 3, '属性数量不能变多');
});

test('地址里的引号也进不了属性：整体被拒，只剩文字', () => {
  const out = inline(escapeHtml('![x](x"onerror="alert(1))'));
  assert.ok(!out.includes('<img'), out);
});

test('链接文字里的引号同样撑不开标签', () => {
  const out = inline(escapeHtml('[a"onclick="alert(1)](https://hux.ink/)'));
  assert.match(out, /^<a href="[^"<>]*" target="_blank" rel="noopener">[^<>]*<\/a>$/, out);
  assert.ok(!/\sonclick=/.test(out.replace(/&quot;/g, '')), '去掉实体后也不该出现 onclick 属性');
});

/* ------------------------------ 危险协议 ------------------------------- */

test('javascript: 链接降级成纯文字', () => {
  const out = inline(escapeHtml("[点我](javascript:location='//evil.example')"));
  assert.ok(!out.includes('<a'), out);
  assert.ok(out.includes('点我'));
});

test('实体写法的 javascript&#58; 也绕不过去', () => {
  // 浏览器解属性值时会先把 &#58; 还原成冒号，所以白名单必须判在解析之前
  const out = inline(escapeHtml('[x](javascript&#58;alert(1))'));
  assert.ok(!out.includes('<a'), out);
});

test('大小写混写、带前导空格的 javascript: 一样拒绝', () => {
  for (const url of ['JavaScript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)']) {
    assert.ok(!inline(escapeHtml(`[x](${url})`)).includes('<a'), url);
  }
});

test('data: 图片被拒（拿 SVG 或 html 当图片是常见载荷）', () => {
  for (const url of ['data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml,<svg onload=alert(1)>']) {
    assert.ok(!inline(escapeHtml(`![x](${url})`)).includes('<img'), url);
  }
});

test('vbscript: 与 file: 同样拒绝', () => {
  for (const url of ['vbscript:msgbox(1)', 'file:///etc/passwd']) {
    assert.ok(!inline(escapeHtml(`[x](${url})`)).includes('<a'), url);
  }
});

/* ------------------------------ 正常内容 ------------------------------- */

test('正常链接照常渲染，& 保持为实体', () => {
  const out = inline(escapeHtml('[官网](https://hux.ink/a?b=1&c=2)'));
  assert.equal(out, '<a href="https://hux.ink/a?b=1&amp;c=2" target="_blank" rel="noopener">官网</a>');
});

test('正常图片、站内路径、协议相对地址都放行', () => {
  assert.ok(inline(escapeHtml(`![图](${PICTURE})`)).includes('<img'));
  assert.ok(inline(escapeHtml('![图](/images/a.png)')).includes('src="/images/a.png"'));
  assert.ok(inline(escapeHtml('![图](//img.hux.ink/a.png)')).includes('src="//img.hux.ink/a.png"'));
});

test('页内锚点和 mailto 只给链接，不给图片', () => {
  assert.ok(inline(escapeHtml('[跳到底部](#bottom)')).includes('href="#bottom"'));
  assert.ok(inline(escapeHtml('[写信](mailto:a@b.com)')).includes('href="mailto:a@b.com"'));
  assert.ok(!inline(escapeHtml('![图](#bottom)')).includes('<img'));
  assert.ok(!inline(escapeHtml('![图](mailto:a@b.com)')).includes('<img'));
});

test('safeUrl 对空值和纯文字的判定', () => {
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');
  assert.equal(safeUrl('随便写的'), '');
  assert.equal(safeUrl('?a=1'), '');
});

/* ---------------------------- 整条渲染链 ------------------------------- */

test('markdown() 端到端：注入载荷不会在结果里留下可执行属性', () => {
  const out = markdown('![a"onerror="alert(1)](https://img.hux.ink/x.png)');
  assert.ok(!markdown('![a"onerror="alert(1)](https://img.hux.ink/x.png)').includes('<img alt="a"'), out);
  assert.ok(!/\sonerror\s*=/.test(out.replace(/&quot;/g, '\u0000')), out);
});

test('markdown() 里代码块和引用仍正常，改动没有破坏排版', () => {
  const out = markdown('> 引用\n\n```\n<b>x</b>\n```\n\n**粗** 和 `code`');
  assert.ok(out.includes('<blockquote>引用</blockquote>'), out);
  assert.ok(out.includes('<pre><code>') && out.includes('&lt;b&gt;x&lt;/b&gt;'), out);
  assert.ok(out.includes('<strong>粗</strong>'), out);
});

/* ------------------------------ 沙箱与外壳 ----------------------------- */

test('预览 iframe 带 sandbox，且不给 allow-scripts', () => {
  const tag = HTML.match(/<iframe[^>]*id="previewFrame"[^>]*>/);
  assert.ok(tag, '找不到预览 iframe');
  assert.match(tag[0], /sandbox="[^"]*"/, '必须有 sandbox');
  assert.match(tag[0], /sandbox="allow-same-origin"/, '当前只放允许同源，保证外链字体照旧');
  assert.ok(!/allow-scripts/.test(tag[0]), '不能给 allow-scripts：给了等于没有沙箱');
});

test('预览外壳里没有内联脚本（拦链接改由 CSS 负责）', () => {
  const shell = grab('previewShell');
  assert.ok(!/<script/i.test(shell), '外壳不该再内联 script');
  assert.ok(HTML.includes('.post-content a{pointer-events:none}'), '链接要在预览里点不动，靠这条 CSS');
});
