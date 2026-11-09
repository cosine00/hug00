(function () {
  'use strict';

  // 每条哔哔最多自动展开几张引用卡片；再多只会让人分不清正文在哪。
  var MAX_QUOTES = 3;
  // 引用片段截断长度。卡片是「摘一段回头看」，不是全文转载。
  var SNIPPET_LIMIT = 200;
  // 正文里的引用缩成角标序号，和下方第几张卡片一一对应。上标数字用
  // Unicode 字符而不是 <sup>：正文要过 marked，纯文本写法在 RSS 里也认。
  var MARKS = ['¹', '²', '³'];

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
   *  - 命中的引用标记在正文里缩成角标序号（¹ ² ³），文末按同一顺序补卡片。
   *
   * 正文不显示 `ID.1234`：读句子时那一串编号是噪音，而卡片就在下面，编号
   * 重复出现两次。角标只占一个字符，既保住句子通顺（删干净会剩「详情见 。」），
   * 也仍然能点开被引用的那条哔哔。
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
    var body = text.replace(LINK_RE, function (match, label, idFromUrl) {
      var id =
        String(idFromUrl || '').trim() ||
        String(label || '').replace(/^ID\.?\s*/i, '').trim();
      if (!id) return match;

      var index = picked.indexOf(id);
      if (index === -1) {
        var source = byId[id];
        // 找不到、没有正文、或已超出卡片上限：链接原样留着，别让读者点空。
        if (!source || !source.content) return match;
        if (picked.length >= MAX_QUOTES) return match;
        picked.push(id);
        index = picked.length - 1;
      }
      return '[' + MARKS[index] + '](/m/' + encodeURIComponent(id) + '/)';
    });

    if (!picked.length) return text;

    var cards = picked.map(function (id) {
      var snippet = snippetOf(byId[id].content);
      var lines = ['> [ID.' + id + '](/m/' + encodeURIComponent(id) + '/)'];
      if (snippet) lines.push('>' + snippet.split('\n').map(function (line) { return ' ' + line; }).join('\n>'));
      return lines.join('\n');
    });

    return body + '\n\n' + cards.join('\n\n') + '\n';
  }

  window.bbQuote = { expand: expand };
})();
