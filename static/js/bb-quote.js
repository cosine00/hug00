(function () {
  'use strict';

  // 每条哔哔最多自动展开几张引用卡片；再多只会让人分不清正文在哪。
  var MAX_QUOTES = 3;
  // 引用片段截断长度。卡片是「摘一段回头看」，不是全文转载。
  var SNIPPET_LIMIT = 200;

  // 匹配引用标记：`[ID.1234](/m/1234/)`、`[1234](https://hux.ink/m/1234/)`
  // 等写法。链接目标里的编号优先，缺失时退回链接文字里的编号。
  var LINK_RE = /\[((?:ID\.?\s*)?[\w-]+)\]\(\s*<?[^)\s]*\/m\/([\w-]+)\/?>?(?:\s+["'][^"']*["'])?\s*\)/gi;

  // 引用卡片里的片段要退掉正文才有的一些东西：图片（卡片里放不下）、
  // 标签、手写引用层（避免嵌套 blockquote 打断外层卡片）。
  function snippetOf(content) {
    var text = String(content || '')
      .replace(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g, '')
      .replace(/^>[^\n]*$/gm, '')
      .replace(/#[^\s#]+/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    if (text.length > SNIPPET_LIMIT) {
      text = text.slice(0, SNIPPET_LIMIT).replace(/\s+\S*$/, '') + ' ……';
    }
    return text;
  }

  /**
   * 把正文里的引用标记展开成引用卡片（blockquote 形式）。
   *
   * `plain` 是还没交给 marked 的 markdown 文本，`all` 是页面已加载的完整
   * memos.json 数组。规则：
   *  - 正文已经有手写引用（`>` 开头的行）时整体跳过，避免和旧快照重复；
   *  - 被引用的条目不在公开列表里（已删除、转私人）时保留原链接不动；
   *  - 命中的引用标记留在正文里，在文末补上引用卡片。
   *
   * 标记不删：作者常把引用写在句子中间（"详情见 [ID.12](/m/12/)"），删掉
   * 只剩"详情见 。"，读起来是断的。行内留一个短链接，文末给卡片，两处都能
   * 到达那条哔哔。
   *
   * 返回处理后的 markdown；没有可展开的引用时原样返回。
   */
  function expand(plain, all) {
    var text = String(plain || '');
    if (!text || !Array.isArray(all) || !all.length) return text;
    // 手写引用的条目维持作者自己排的版。
    if (/^\s*>/m.test(text)) return text;

    var byId = Object.create(null);
    for (var i = 0; i < all.length; i += 1) {
      if (all[i] && all[i].id != null) byId[String(all[i].id)] = all[i];
    }

    var picked = [];
    var found;
    LINK_RE.lastIndex = 0;
    while ((found = LINK_RE.exec(text)) !== null) {
      if (picked.length >= MAX_QUOTES) break;
      var id = String(found[2] || '').trim() || String(found[1] || '').replace(/^ID\.?\s*/i, '').trim();
      if (!id || picked.some(function (item) { return item.id === id; })) continue;
      var source = byId[id];
      if (!source || !source.content) continue;
      picked.push({ id: id, source: source });
    }
    if (!picked.length) return text;

    var cards = picked.map(function (item) {
      var snippet = snippetOf(item.source.content);
      var lines = ['> [ID.' + item.id + '](/m/' + encodeURIComponent(item.id) + '/)'];
      if (snippet) lines.push('>' + snippet.split('\n').map(function (line) { return ' ' + line; }).join('\n>'));
      return lines.join('\n');
    });

    return text + '\n\n' + cards.join('\n\n') + '\n';
  }

  window.bbQuote = { expand: expand };
})();
