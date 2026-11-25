/* ==========================================================================
   bb-comments.js
   1) 在「哔哔」列表（首页 / /bb/）里给每条 memos 挂上评论入口
   2) 让每条 memos 拥有独立链接 /m/<id>/，页面上单独渲染这条哔哔 + 评论区
   依赖 comments.js；不依赖 Twikoo，可与 Twikoo 并存或单独使用。
   ========================================================================== */

(function () {
  'use strict';

  var cfg = Object.assign({
    api: '/api/comments',
    memosUrl: '/memos.json',
    listIndex: '/bb/',
    adminHash: '',
    turnstileSiteKey: '',
    avatar: '',
    hideTwikooPill: true,
    /* 评论展开方式：
       sheet  —— 提到 body 级浮层里（首页卡片墙用，一栏宽塞不下评论框）
       inline —— 在原条目下方就地展开（/bb/ 单列页用，一条占整行，放得下） */
    inline: false
  }, window.bbComments || {});

  var countCache = {};

  /* --------------------------------- 工具 --------------------------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function siteUrl() {
    return window.location.origin;
  }

  function memoPermalink(id) {
    return siteUrl() + '/m/' + encodeURIComponent(String(id)) + '/';
  }

  // 浮层标题用的编号：历史条目是纯数字（#1250），FlareMo 之后是 UUID，
  // 整串太长撑不住标题栏，截前 8 位够认人。
  function memoLabel(id) {
    var raw = String(id == null ? '' : id);
    if (/^\d+$/.test(raw)) return '哔哔·#' + raw;
    return '哔哔·#' + raw.slice(0, 8);
  }

  var COMMENT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

  // reacttargetid 的形态是 memo-<id>。id 可能是数字（历史条目），也可能是 UUID
  // （FlareMo 之后新发的），所以不能再用 \d+ 去截，否则 30abf140-… 会被截成 30，
  // 评论会挂到 id=30 那条哔哔下面。
  function memoIdOf(item) {
    var node = item.querySelector('emoji-reaction[reacttargetid]');
    if (node) {
      var raw = String(node.getAttribute('reacttargetid') || '').trim();
      var prefixed = raw.match(/^memo-(.+)$/);
      if (prefixed && prefixed[1]) return prefixed[1].trim();
      if (/^\d+$/.test(raw)) return raw;
    }
    var btn = item.querySelector('.comment-pill-btn[data-id]');
    if (btn) return btn.getAttribute('data-id');
    var legacy = item.querySelector('[class*="twikoo-wrapper-"]');
    if (legacy) {
      var m2 = String(legacy.className).match(/twikoo-wrapper-(\d+)/);
      if (m2) return m2[1];
    }
    return null;
  }

  /* ------------------------------- 计数批量拉取 ------------------------------ */

  var pendingIds = new Set();
  var flushTimer = null;

  function scheduleCount() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      var ids = Array.from(pendingIds).filter(function (id) {
        return !(id in countCache);
      });
      pendingIds.clear();
      if (!ids.length) return;

      var threads = ids.map(function (id) { return 'memo:' + id; }).join(',');
      fetch(cfg.api + '/count?threads=' + encodeURIComponent(threads))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.ok) return;
          Object.keys(data.counts || {}).forEach(function (key) {
            var id = key.replace(/^memo:/, '');
            countCache[id] = data.counts[key];
            paintCount(id);
          });
        })
        .catch(function () { /* 计数失败不影响使用 */ });
    }, 180);
  }

  function paintCount(id) {
    var count = countCache[id] || 0;

    document.querySelectorAll('.cm-pill[data-memo="' + id + '"]').forEach(function (pill) {
      var label = pill.querySelector('.cm-pill-count');
      if (label) label.textContent = count > 0 ? count : '';
      pill.classList.toggle('has-comments', count > 0);
      pill.setAttribute('data-tip', count > 0 ? count + ' 条评论' : '等风，也等你');
    });

    // 首页卡片顶部的「已评论 N」：没评论就不占位。
    // 元素可能还没渲染（bb-home.js 会整体重画 #bber），MutationObserver 会再扫一遍，
    // 那时 countCache 已有值，injectActions 里的 paintCount 会把它补上。
    var item = document.querySelector('#bber .bb-item[data-cm-id="' + id + '"]');
    var badge = item && item.querySelector('.bb-comment-badge');
    if (badge) {
      badge.textContent = count > 0 ? '已评论 ' + count : '';
      badge.hidden = count <= 0;
    }

    // 首页卡片右下角那行摘要（表情 + 评论数）跟着一起刷新
    if (window.paintInteractionHints) window.paintInteractionHints();
  }

  /* ------------------------------- 列表：注入入口 ----------------------------- */

  /* 线程节点先挂在卡片里（隐藏、不占位），打开时被提进浮层，关闭时收回原位。
     不每次新建：Comments.mount 的实例、已加载的评论、输入到一半的草稿都留在
     同一个 DOM 上，反复开关不会重新拉数据，也不会把写了一半的字弄丢。 */
  function ensureInlineThread(item, id) {
    if (item.__cmThread) return item.__cmThread;

    var wrap = item.querySelector(':scope > .cm-inline-thread');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'cm-inline-thread';
      wrap.hidden = true;
      item.appendChild(wrap);
    }

    wrap.__cmHome = item;
    item.__cmThread = wrap;
    return wrap;
  }

  /* ----------------------------- 评论浮层（sheet） -----------------------------
     卡片墙里一张卡只有一栏宽，评论框留在卡里会被压成一条，输入区几乎不可用。
     点评论时把整条线程提到 body 级的浮层里：宽度给到 620px，卡片墙一格不动。 */

  var sheet = null;

  function ensureSheet() {
    if (sheet && document.body.contains(sheet.root)) return sheet;

    var root = document.createElement('div');
    root.className = 'bb-csheet';
    root.hidden = true;
    root.innerHTML =
      '<div class="bb-csheet-mask" data-cm-close></div>' +
      '<div class="bb-csheet-panel" role="dialog" aria-modal="true" aria-label="评论" tabindex="-1">' +
        '<div class="bb-csheet-head">' +
          '<a class="bb-csheet-title">' +
            '<svg class="bb-csheet-title-ic" viewBox="0 0 24 24" aria-hidden="true">' +
              '<path d="M10 5h9v9"></path>' +
              '<path d="M19 5 8 16"></path>' +
            '</svg>' +
            '<span class="bb-csheet-title-txt"></span>' +
          '</a>' +
          '<button type="button" class="bb-csheet-close" data-cm-close aria-label="关闭评论">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg>' +
          '</button>' +
        '</div>' +
        '<div class="bb-csheet-body"></div>' +
      '</div>';

    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-cm-close]')) closeSheet();
    });

    document.body.appendChild(root);

    sheet = {
      root: root,
      panel: root.querySelector('.bb-csheet-panel'),
      body: root.querySelector('.bb-csheet-body'),
      title: root.querySelector('.bb-csheet-title'),
      titleTxt: root.querySelector('.bb-csheet-title-txt'),
      current: null,
      lastFocus: null
    };
    return sheet;
  }

  function parkThread(wrap) {
    if (!wrap) return;
    wrap.hidden = true;
    var home = wrap.__cmHome;
    if (home && home.isConnected) home.appendChild(wrap);
  }

  /* 浮层只在右侧正文栏里居中，不越过分隔线：
     量一下正文容器（.main，退到 #bber / article）的左右边界，写成两个 CSS 变量，
     让 .bb-csheet 的 left/right 贴着这个范围。窗口换宽度时重量一次。 */
  function positionSheet() {
    if (!sheet || sheet.root.hidden) return;

    var host = document.querySelector('.main') ||
               document.querySelector('#bber') ||
               document.querySelector('article');

    if (!host) {
      sheet.root.style.removeProperty('--bb-sheet-left');
      sheet.root.style.removeProperty('--bb-sheet-right');
      return;
    }

    var rect = host.getBoundingClientRect();
    var left = Math.max(0, Math.round(rect.left));
    var right = Math.max(0, Math.round(window.innerWidth - rect.right));
    sheet.root.style.setProperty('--bb-sheet-left', left + 'px');
    sheet.root.style.setProperty('--bb-sheet-right', right + 'px');
  }

  window.addEventListener('resize', positionSheet);

  var sheetTimer = null;

  function closeSheet(silent) {
    if (!sheet || sheet.root.hidden) return;

    var view = sheet;
    var wrap = view.current;
    var focusBack = view.lastFocus;

    view.current = null;
    view.lastFocus = null;
    view.root.classList.remove('is-open');
    document.documentElement.classList.remove('bb-csheet-open');

    // 等淡出跑完再收起来。这两件事要分开判：面板可能已经被重新打开
    // （重开时 is-open 要等下一帧才加，正好落在这个窗口里），但那条旧线程
    // 无论如何都得收回去，否则浮层里会叠着两条评论区。
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(function () {
      if (wrap && wrap !== view.current) {
        if (silent) wrap.remove();
        else if (wrap.parentElement === view.body) parkThread(wrap);
      }
      if (view.current || view.root.classList.contains('is-open')) return;
      view.root.hidden = true;
      if (focusBack && focusBack.isConnected && focusBack.focus) {
        try { focusBack.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
      }
    }, 200);
  }

  /* 浮层上半截：被评论的这条哔哔本身，按主页卡片的样子搬过来 ——
     正文 + 底部那行（日期 · 标签 · 表情 · 评论）。
     正文直接克隆 .bb-cont：渲染好的 HTML，不用再解析一遍 markdown，
     也不会因为两处渲染逻辑分叉而长得不一样。 */
  function buildMemoPane(item) {
    var cont = item.querySelector('.bb-cont');
    if (!cont) return null;

    var pane = document.createElement('div');
    pane.className = 'bb-csheet-memo';

    // 正文自己滚（长哔哔不至于把评论框顶下去），但底部那行留在滚动容器外面 ——
    // 表情的挑选弹层是绝对定位、往上翻的，套在 overflow 里会被裁掉。
    var scroller = document.createElement('div');
    scroller.className = 'bb-csheet-memo-body';
    pane.appendChild(scroller);

    var clone = cont.cloneNode(true);

    // 卡片里那个 320px 悬浮预览向上翻，进了浮层会被面板的圆角裁掉，去掉
    clone.querySelectorAll('.bb-image-preview').forEach(function (node) { node.remove(); });

    // cloneNode 不带监听器，点图片图标得转回原按钮，走的还是原来那套灯箱
    var origins = cont.querySelectorAll('.bb-image-trigger');
    clone.querySelectorAll('.bb-image-trigger').forEach(function (btn, index) {
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var origin = origins[index];
        if (origin) origin.click();
      });
    });

    scroller.appendChild(clone);

    var footClone = memoFootNode(item);
    if (footClone) {
      footClone.querySelectorAll('.bb-image-preview').forEach(function (node) { node.remove(); });

      // 表情组件是 shadow DOM，cloneNode 只复制一个空壳（内部 DOM 和状态都不跟），
      // 复制过来既没药丸也点不动。改成按原组件的属性新建一个实例：
      // 它自己会去拉计数，药丸可点、笑脸按钮也能用，跟卡片上是同一个组件。
      var originReact = item.querySelector('.bb-foot-right emoji-reaction') ||
                        item.querySelector('.bb-info emoji-reaction') ||
                        item.querySelector('emoji-reaction');
      footClone.querySelectorAll('emoji-reaction').forEach(function (dead) {
        if (!originReact) { dead.remove(); return; }
        var fresh = document.createElement('emoji-reaction');
        Array.prototype.forEach.call(originReact.attributes, function (attr) {
          fresh.setAttribute(attr.name, attr.value);
        });
        dead.replaceWith(fresh);
        tuneReactionPopup(fresh);
      });

      // 克隆里的评论按钮同样没有监听：点它就当「收起评论」
      footClone.querySelectorAll('.cm-pill').forEach(function (btn) {
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          closeSheet();
        });
      });
      pane.appendChild(footClone);
    }

    return pane;
  }

  /* 浮层底部那一行：普通卡直接克隆 .bb-foot-right；
     置顶那条没有底部行（标签在顶部 .bb-info、动作单独挂在右上角），
     这里照同样的结构拼一行出来，日期就不再重复显示。 */
  function memoFootNode(item) {
    var foot = item.querySelector('.bb-foot-right');
    if (foot) {
      var clone = foot.cloneNode(true);
      // 置顶那条的标签住在 .bb-info 里、没进底部这行，克隆过来会缺一段，
      // 这里从原卡片补一份，日期后面跟着。
      if (!clone.querySelector('.bb-foot-tags')) {
        var infoTags = item.querySelectorAll('.bb-info .tag-span');
        if (infoTags.length) {
          var tagsWrap = document.createElement('span');
          tagsWrap.className = 'bb-foot-tags';
          infoTags.forEach(function (node) { tagsWrap.appendChild(node.cloneNode(true)); });
          var dateNode = clone.querySelector('.datatime');
          if (dateNode) dateNode.insertAdjacentElement('afterend', tagsWrap);
          else clone.insertBefore(tagsWrap, clone.firstChild);
        }
      }
      return clone;
    }

    var info = item.querySelector('.bb-info');
    if (!info) return null;

    var row = document.createElement('div');
    row.className = 'bb-foot-right';

    var tags = info.querySelectorAll('.tag-span');
    if (tags.length) {
      var tagWrap = document.createElement('span');
      tagWrap.className = 'bb-foot-tags';
      tags.forEach(function (node) { tagWrap.appendChild(node.cloneNode(true)); });
      row.appendChild(tagWrap);
    }

    // 置顶那条的动作不在 .bb-info 里了，是卡片右上角那个独立容器
    var actions = info.querySelector('.bb-foot-actions') || item.querySelector('.bb-foot-actions');
    if (actions) row.appendChild(actions.cloneNode(true));

    return row.children.length ? row : null;
  }

  /* 卡片上那个表情弹层是相对工具栏往上翻、往右展开的，卡片本身不裁，所以看得见。
     浮层里换了个容器，弹层要么落到面板外面、要么被右边裁掉。给它补一条样式：
     挂在底行右上角往上长，宽了就换行，始终留在面板里。 */
  function tuneReactionPopup(host) {
    var apply = function () {
      var root = host.shadowRoot;
      if (!root || root.querySelector('style[data-bb-pane]')) return;
      var style = document.createElement('style');
      style.setAttribute('data-bb-pane', '1');
      style.textContent =
        '.reaction-available-popup{left:auto!important;right:0!important;' +
        'top:auto!important;bottom:calc(100% + 6px)!important;' +
        'width:max-content!important;flex-wrap:nowrap!important;' +
        'max-width:min(320px,86vw)!important;overflow-x:auto;}';
      root.appendChild(style);
    };

    if (host.updateComplete && host.updateComplete.then) host.updateComplete.then(apply);
    setTimeout(apply, 60);
    setTimeout(apply, 400);
  }

  /* 线程挂一次就够：Comments.mount 的实例、已加载的评论、输入到一半的草稿
     都留在这段 DOM 上，反复开关不重新拉数据。 */
  function mountThread(wrap, id) {
    if (wrap.dataset.mounted) return;
    wrap.dataset.mounted = '1';
    var mountNode = document.createElement('div');
    wrap.appendChild(mountNode);
    window.Comments.mount(mountNode, {
      threadKey: 'memo:' + id,
      threadUrl: memoPermalink(id),
      threadTitle: '哔哔 · ' + id,
      api: cfg.api,
      avatar: cfg.avatar,
      adminHash: cfg.adminHash,
      turnstileSiteKey: cfg.turnstileSiteKey,
      showHeader: false,
      placeholder: '回复这条哔哔…'
    });
  }

  /* 单列页（/bb/）的内联展开：跟改版前一样 —— 点一下在原条目下方长出评论区，
     再点收起。一条占整行，宽度够，不需要浮层。 */
  function toggleInline(item, id) {
    var wrap = ensureInlineThread(item, id);

    if (!wrap.hidden) {
      wrap.hidden = true;
      return;
    }

    mountThread(wrap, id);
    wrap.hidden = false;

    setTimeout(function () {
      if (!wrap.hidden) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  }

  function openThread(item, id) {
    var wrap = ensureInlineThread(item, id);
    var view = ensureSheet();

    // 再点一次同一个入口 = 收起
    if (view.current === wrap && !view.root.hidden) {
      closeSheet();
      return;
    }

    if (view.current) parkThread(view.current);

    view.current = wrap;
    view.lastFocus = document.activeElement;

    // 淡出那 200ms 里换了一条：旧线程还躺在浮层里，先立刻收走，别让两段评论并排
    view.body.querySelectorAll('.cm-inline-thread').forEach(function (node) {
      if (node !== wrap) parkThread(node);
    });

    // 换一条就把上一篇原帖撤掉，同一条重开则复用，避免正文闪一下
    var oldPane = view.body.querySelector('.bb-csheet-memo');
    if (oldPane && oldPane.dataset.memoId !== String(id)) oldPane.remove();
    if (!view.body.querySelector('.bb-csheet-memo')) {
      var pane = buildMemoPane(item);
      if (pane) {
        pane.dataset.memoId = String(id);
        view.body.appendChild(pane);
        // 卡片上的日期是 Lately 换过的「1天前」，克隆出来是原始日期，得再走一遍
        if (window.Lately) {
          try { window.Lately.init({ target: '.bb-csheet-memo .datatime' }); } catch (error) { /* ignore */ }
        }
      }
    }

    view.body.appendChild(wrap);
    wrap.hidden = false;

    mountThread(wrap, id);

    // 标题就是这条的编号：一眼知道在给哪条留言。
    // 做成药丸（.cm-pill 那套）而不是裸文字：它是「去独立页面看这条」的入口，
    // 长相跟下面评论按钮一致，才看得出这是个能点的东西。
    if (view.titleTxt) view.titleTxt.textContent = memoLabel(id);
    view.title.setAttribute('href', memoPermalink(id));
    // 提示走全站那套 data-tip 药丸气泡（comments.js 的委托），
    // 不要原生 title：方角系统气泡跟这层浮层不是一套语言。
    view.title.setAttribute('data-tip', '在独立页面查看这条哔哔');
    view.title.setAttribute('data-tip-place', 'right');
    view.title.removeAttribute('title');

    view.body.scrollTop = 0;
    view.root.hidden = false;
    document.documentElement.classList.add('bb-csheet-open');
    // 锁滚动会挪掉滚动条，正文栏的左右边界要等这之后再量
    positionSheet();

    // 连拍两帧再加 is-open，否则 hidden 刚撤掉就上过渡，动画不会跑
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        view.root.classList.add('is-open');
        try { view.panel.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
      });
    });
  }

  function injectActions(item, id) {
    var info = item.querySelector('.bb-info') || item;

    if (cfg.hideTwikooPill) {
      item.querySelectorAll('.comment-pill-btn:not(.attach-btn)').forEach(function (node) {
        node.style.display = 'none';
      });
    }

    // 悬停工具栏最右侧那一组：紧跟在表情按钮后面；没有那个容器时退回工具栏/元信息行
    var slot = item.querySelector('.bb-foot-actions') || item.querySelector('.bb-foot-right') || info;

    var group = document.createElement('span');
    group.className = 'cm-actions';
    group.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:0;';
    group.innerHTML =
      '<button type="button" class="cm-pill" data-memo="' + esc(id) + '">' +
        COMMENT_ICON + '<span class="cm-pill-count"></span>' +
      '</button>';

    group.querySelector('.cm-pill').addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      // 单列页就地展开，卡片墙提到浮层
      if (cfg.inline) toggleInline(item, id);
      else openThread(item, id);
    });

    slot.appendChild(group);
    paintCount(id);
  }

  function scanList() {
    var root = document.querySelector('#bber');
    if (!root) return;

    // #bber 被整体重画时，浮层里那条线程的原位卡片已经不在文档里了，
    // 留在浮层上只会变成一个关不掉的孤儿
    if (sheet && sheet.current && !sheet.root.hidden) {
      var home = sheet.current.__cmHome;
      if (!home || !home.isConnected) closeSheet(true);
    }

    root.querySelectorAll('.bb-item').forEach(function (item) {
      if (item.dataset.cmReady) return;
      var id = memoIdOf(item);
      if (!id) return;
      item.dataset.cmReady = '1';
      item.dataset.cmId = id;
      injectActions(item, id);
      pendingIds.add(id);
    });

    scheduleCount();
  }

  function initListObserver() {
    var root = document.querySelector('#bber');
    if (!root) return;

    scanList();

    var observer = new MutationObserver(function () {
      // bb-focus / bb.js 会整体重绘 #bber，这里重新扫描即可
      scanList();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  // 点页面空白处也收起浮层：遮罩只铺在正文栏里，左侧导航那边点不到，
  // 所以在文档上补一层。点面板内部、点另一条评论按钮（切线程）都不算。
  document.addEventListener('click', function (event) {
    if (!sheet || sheet.root.hidden) return;

    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.indexOf(sheet.panel) > -1) return;

    var target = event.target;
    if (target && target.closest) {
      if (target.closest('.bb-csheet')) return;   // 遮罩和叉自己有出口
      if (target.closest('.cm-pill')) return;     // 换一条看评论
    }

    // 大图还开着时，那一下点击是给它关的
    var lightbox = document.querySelector('.view-image');
    if (lightbox && lightbox.getBoundingClientRect().width > 0) return;

    closeSheet();
  });

  // Esc 收起浮层：和点遮罩、点叉是同一个出口
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (!sheet || sheet.root.hidden) return;
    // 浮层里点开的大图还在，这一下 Esc 先归它，别一按把两层一起关了
    var lightbox = document.querySelector('.view-image');
    if (lightbox && lightbox.getBoundingClientRect().width > 0) return;
    event.preventDefault();
    closeSheet();
  });

  // 评论新增后同步列表上的计数
  document.addEventListener('comments:created', function (event) {
    var threadKey = event.detail && event.detail.threadKey;
    if (!threadKey || threadKey.indexOf('memo:') !== 0) return;
    // 没有审核环节，发出去就算数，计数直接 +1
    var id = threadKey.replace('memo:', '');
    countCache[id] = (countCache[id] || 0) + 1;
    paintCount(id);
  });

  /* ------------------------------- 单条：/m/:id ------------------------------ */

  var LEGACY_RESOURCE_CUTOFF = Date.parse('2024-08-03T00:00:00+08:00') / 1000;
  var LEGACY_RESOURCE_BASE = 'https://memos.hux.ink/o/r/';

  function imageUrls(memo) {
    var urls = [];
    (Array.isArray(memo.resourceList) ? memo.resourceList : []).forEach(function (res) {
      var isLegacy = Number(memo.createdTs) < LEGACY_RESOURCE_CUTOFF;
      var url = isLegacy && res && res.id != null
        ? LEGACY_RESOURCE_BASE + encodeURIComponent(res.id)
        : (res && (res.externalLink || res.publicUrl || res.filename));
      var type = String((res && res.type) || '').toLowerCase();
      if (url && (type.indexOf('image') === 0 || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url))) {
        urls.push(url);
      }
    });
    var markdown = String(memo.content || '').match(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g) || [];
    markdown.forEach(function (chunk) {
      var m = chunk.match(/\(\s*(?:<([^>]+)>|([^\s)]+))/);
      if (m) urls.push(m[1] || m[2]);
    });
    return Array.from(new Set(urls));
  }

  function stripImages(text) {
    return String(text || '').replace(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g, '');
  }

  function renderMemoCard(memo, list) {
    var plain = stripImages(memo.content).replace(/#[^\s#]+/g, '').trim();
    // 引用标记 `[ID.x](/m/x/)` 展开成文末的引用卡片；手写引用的条目保持原样。
    if (window.bbQuote && Array.isArray(list)) plain = window.bbQuote.expand(plain, list);
    var body = window.marked
      ? window.marked.parse(plain.replace(/\n/g, '  \n'))
      : esc(plain).replace(/\n/g, '<br>');

    var images = imageUrls(memo);
    // 单张图留空行；两张以上放进同一个段落，交给文章那套等高画廊排版（图片之间不换行）
    var imagesHtml = images.length
      ? '<p class="cm-memo-images">' + images.map(function (url) {
          return '<img src="' + esc(url) + '" alt="" loading="lazy" data-view-image>';
        }).join('') + '</p>'
      : '';

    var tags = (memo.tags || []).map(function (tag) {
      return '<a class="cm-memo-tag" href="' + esc(cfg.listIndex) + '">#' + esc(tag) + '</a>';
    }).join(' ');

    var date = new Date(Number(memo.createdTs) * 1000);
    var dateText = date.getFullYear() + ' 年 ' + (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日 ' +
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');

    return '<article class="cm-memo-card">' +
      '<div class="cm-memo-content">' + body + imagesHtml + '</div>' +
      '<div class="cm-memo-meta"><span class="cm-memo-date">' + esc(dateText) + '</span>' + tags + '</div>' +
    '</article>';
  }

  function initSingle() {
    var root = document.getElementById('memo-single');
    if (!root) return false;

    var api = root.dataset.memoApi || cfg.api;
    var source = root.dataset.memoSource || cfg.memosUrl;
    var index = root.dataset.memoIndex || cfg.listIndex;

    // FlareMo 之后新发的哔哔是 UUID（30abf140-…），历史条目才是纯数字，
    // 所以不能再只认 \d+，否则详情页会报「没有指定要查看的哔哔」。
    var id =
      decodeURIComponent(((window.location.pathname.match(/^\/m\/([^/?#]+)\/?$/) || [])[1]) || '') ||
      new URLSearchParams(window.location.search).get('memo') ||
      ((window.location.hash || '').match(/^#memo-([^\s&]+)$/) || [])[1];

    if (!id) {
      root.innerHTML = '<p class="cm-single-loading">没有指定要查看的哔哔。' +
        '<a href="' + esc(index) + '" class="cm-single-back">返回哔哔列表</a></p>';
      return true;
    }

    fetch(source, { cache: 'no-cache' })
      .then(function (res) { return res.json(); })
      .then(function (payload) {
        var list = Array.isArray(payload) ? payload : (payload && payload.items) || [];
        var memo = list.find(function (item) { return String(item.id) === String(id); });

        if (!memo) {
          root.innerHTML = '<p class="cm-single-loading">这条哔哔可能已经不在了。' +
            '<a href="' + esc(index) + '" class="cm-single-back">返回列表</a></p>';
          return;
        }

        var summary = stripImages(memo.content).replace(/#[^\s#]+/g, '').trim().slice(0, 40);
        document.title = (summary || '哔哔') + ' · ' + document.title;

        root.innerHTML =
          '<div class="cm-single-nav">' +
            '<a class="cm-single-back" href="' + esc(index) + '">← 返回哔哔列表</a>' +
          '</div>' +
          '<div id="cm-single-thread"></div>';

        var jump = root.querySelector('#cm-jump-comments');
        if (jump) {
          jump.addEventListener('click', function (event) {
            event.preventDefault();
            var target = document.getElementById('cm-single-thread');
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }

        root.querySelector('#cm-single-thread').insertAdjacentHTML('beforebegin', renderMemoCard(memo, list));

        // 多图按文章的等高画廊排版（与主题 post-justified-gallery 同一套规则）
        if (window.PostGallery) {
          try { window.PostGallery.init('.cm-memo-content'); } catch (error) { /* ignore */ }
        }

        if (window.ViewImage) {
          try { window.ViewImage.init('.cm-memo-content img'); } catch (error) { /* ignore */ }
        }

        window.Comments.mount('#cm-single-thread', {
          threadKey: 'memo:' + id,
          threadUrl: memoPermalink(id),
          threadTitle: '哔哔 · ' + id,
          api: api,
          avatar: root.dataset.memoAvatar || cfg.avatar,
          adminHash: root.dataset.memoAdminHash || cfg.adminHash
          ,turnstileSiteKey: root.dataset.memoTurnstile || cfg.turnstileSiteKey
        });
      })
      .catch(function () {
        root.innerHTML = '<p class="cm-single-loading">载入失败，请稍后刷新重试。</p>';
      });

    return true;
  }

  /* --------------------------------- 启动 --------------------------------- */

  function boot() {
    if (initSingle()) return;

    // 列表页可能在 DOMContentLoaded 之后才由 bb-focus/bb.js 渲染
    if (document.querySelector('#bber')) {
      initListObserver();
    } else {
      document.addEventListener('DOMContentLoaded', initListObserver);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.bbCommentsApi = { refresh: scanList };
})();
