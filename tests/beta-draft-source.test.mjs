/**
 * Beta 前端「打开草稿」这一段的回归。
 *
 * 起因：loadActive() 会用 paragraphize() 把「一行一段」的旧稿补成真段落，并且写回
 * draft.body。对早年手写的稿子是善意补救，对 Drafts 发来的正牌 Markdown 就是替人
 * 改文章 —— 软换行会被改成硬段落，而且服务端的内容指纹随之对不上，下次发送就误报
 * 冲突。所以加了一个来源判断：source 是 'drafts' 的稿子原样装载。
 *
 * 这里做两件事：
 *   1. 把 paragraphize 单独拎出来跑，证明它确实会改软换行（这就是要绕开它的理由）；
 *   2. 盯住那行判断本身 —— 它一旦被谁删掉，这个测试要红。
 * 真实的「打开—切后台—再回来」需要浏览器，见文档里的未验证项。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../static/beta/index.html'), 'utf8');

function slice(start, end) {
  const at = html.indexOf(start);
  assert.ok(at >= 0, `找不到：${start}`);
  const to = html.indexOf(end, at);
  assert.ok(to > at, `找不到结尾：${end}`);
  return html.slice(at, to);
}

// blockKind 与 paragraphize 是纯函数，没有 DOM 依赖
const code = slice('function blockKind(', 'function markdown(');
const sandbox = { String };
vm.createContext(sandbox);
vm.runInContext(`${code}\nthis.paragraphize = paragraphize;`, sandbox);
const paragraphize = sandbox.paragraphize;

test('paragraphize 会把软换行改成硬段落（所以 Drafts 的稿子必须绕开它）', () => {
  assert.equal(paragraphize('第一行\n第二行'), '第一行\n\n第二行');

  // 已经是空行分隔的段落、列表、代码块、表格、引用，都不该被动
  assert.equal(paragraphize('第一段\n\n第二段'), '第一段\n\n第二段');
  assert.equal(paragraphize('- 一条\n- 两条'), '- 一条\n- 两条');
  assert.equal(paragraphize('```\na\nb\n```'), '```\na\nb\n```');
  assert.equal(paragraphize('| a | b |\n| - | - |'), '| a | b |\n| - | - |');
  assert.equal(paragraphize('> 一行\n> 两行'), '> 一行\n> 两行');
});

test('loadActive 对 Drafts 来源的稿子跳过自动排版', () => {
  assert.match(
    html,
    /var body = draft\.source === 'drafts' \? String\(draft\.body \|\| ''\) : paragraphize\(draft\.body \|\| ''\);/,
    '这行判断被删掉，Drafts 草稿打开就会被重排、下次发送误报冲突'
  );
  // 普通草稿仍然走原来的路
  assert.match(html, /if \(body !== draft\.body\) draft\.body = body;/);
});

test('来源标记能一路带过来：新建、云端合并都要有；上行不能带', () => {
  // 新建的草稿默认没有来源
  assert.match(slice('function blankDraft()', 'function migrateLegacy()'), /source: ''/);

  // 从云端拉到本地时带上 source
  assert.match(slice('if (!local) {', 'if (remote.updatedAt <= local.updatedAt) return;'), /source: remote\.source \|\| ''/);

  // 覆盖本地旧版本时也别把来源抹掉
  assert.match(slice('if (remote.updatedAt <= local.updatedAt) return;', 'prunePublished()'), /if \(remote\.source\) local\.source = remote\.source;/);

  // 上行（wireDraft）不带 source：来源只能由导入接口写，客户端说了不算
  assert.doesNotMatch(slice('function wireDraft(', 'function markDirty('), /source/);
});
