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
    hideTwikooPill: true
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

  var COMMENT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

  function memoIdOf(item) {
    var node = item.querySelector('emoji-reaction[reacttargetid]');
    if (node) {
      var match = String(node.getAttribute('reacttargetid')).match(/(\d+)/);
      if (match) return match[1];
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

  function memoDateText(item) {
    var node = item.querySelector('.datatime');
    if (node) return node.getAttribute('title') || node.textContent;
    return '';
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
    document.querySelectorAll('.cm-pill[data-memo="' + id + '"]').forEach(function (pill) {
      var count = countCache[id] || 0;
      var label = pill.querySelector('.cm-pill-count');
      if (label) label.textContent = count > 0 ? count : '';
      pill.classList.toggle('has-comments', count > 0);
      pill.setAttribute('data-tip', count > 0 ? count + ' 条评论' : '等风，也等你');
    });
  }

  /* ------------------------------- 列表：注入入口 ----------------------------- */

  function ensureInlineThread(item, id) {
    var wrap = item.querySelector(':scope > .cm-inline-thread');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.className = 'cm-inline-thread';
    wrap.hidden = true;
    item.appendChild(wrap);
    return wrap;
  }

  function openThread(item, id) {
    var wrap = ensureInlineThread(item, id);

    if (!wrap.hidden) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;

    if (!wrap.dataset.mounted) {
      wrap.dataset.mounted = '1';
      var mountNode = document.createElement('div');
      wrap.appendChild(mountNode);
      window.Comments.mount(mountNode, {
        threadKey: 'memo:' + id,
        threadUrl: memoPermalink(id),
        threadTitle: '哔哔 · ' + (memoDateText(item) || id),
        api: cfg.api,
        avatar: cfg.avatar,
        adminHash: cfg.adminHash,
        turnstileSiteKey: cfg.turnstileSiteKey,
        showHeader: false,
        placeholder: '回复这条哔哔…'
      });
    }

    setTimeout(function () {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 30);
  }

  function injectActions(item, id) {
    var info = item.querySelector('.bb-info') || item;

    if (cfg.hideTwikooPill) {
      item.querySelectorAll('.comment-pill-btn:not(.attach-btn)').forEach(function (node) {
        node.style.display = 'none';
      });
    }

    // 右小角：紧跟在表情按钮后面；没有那个容器时退回 bb-info
    var slot = item.querySelector('.bb-foot-right') || info;

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
      openThread(item, id);
    });

    slot.appendChild(group);
    paintCount(id);
  }

  function scanList() {
    var root = document.querySelector('#bber');
    if (!root) return;

    root.querySelectorAll('.bb-item').forEach(function (item) {
      if (item.dataset.cmReady) return;
      var id = memoIdOf(item);
      if (!id) return;
      item.dataset.cmReady = '1';
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

  function renderMemoCard(memo) {
    var plain = stripImages(memo.content).replace(/#[^\s#]+/g, '').trim();
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

        root.querySelector('#cm-single-thread').insertAdjacentHTML('beforebegin', renderMemoCard(memo));

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
          threadTitle: summary || ('哔哔 ' + id),
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
