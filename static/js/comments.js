/* ==========================================================================
   comments.js · 无服务器评论系统前端
   纯原生 JS，无依赖。字体交给博客（全部 inherit），配色交给主题 CSS 变量。
   用法：
     Comments.mount('#comments', {
       threadKey: 'memo:1233',
       threadUrl: 'https://hux.ink/m/1233/',
       threadTitle: '哔哔',
       api: '/api/comments',
       adminHash: '<管理入口邮箱的 sha256>'
     })
   ========================================================================== */

(function () {
  'use strict';

  var IDENTITY_KEY = 'comments-identity';
  var ADMIN_KEY = 'comments-admin-token';
  // 「此刻是否处于管理模式」和「口令本身」分开存：
  // 管理口令只放 sessionStorage，关掉标签页即消失，降低同源页面脚本长期窃取风险。
  var ADMIN_ACTIVE_KEY = 'comments-admin-active';
  var EDIT_KEY = 'comments-edit-tokens';
  var VISITOR_KEY = 'comments-visitor';
  var SESSION_KEY = 'comments-session';

  // 客人改自己评论的时限（秒），要和服务端 service.js 的 EDIT_WINDOW 对齐。
  // 前端这份只负责藏按钮，真正的判定在服务端——两边都拦才不会出现
  // 「按钮还在、点了报错」或者「按钮没了、其实还能改」。
  var EDIT_WINDOW = 60;
  // 停留在页面上时，每 10 秒扫一遍把过期的按钮撤掉
  var EDIT_SWEEP_MS = 10 * 1000;

  // 头像依次尝试，前一个拿不到才换下一个，全失败则用昵称首字
  var AVATARS = [
    'https://cravatar.cn/avatar/',
    'https://weavatar.com/avatar/',
    'https://gravatar.com/avatar/'
  ];

  // 常用表情：笑脸 → 情绪 → 搞怪 → 手势 → 氛围 → 天气动物 → 物件
  // 只留日常够用的：笑脸两组、几个鬼脸、手势一排、少量符号与天气。
  // 表情一多面板就要占两三行，反而不好挑。
  var EMOJIS = (
    '😀 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 ' +
    '😊 😍 🥰 😘 😜 🤪 🤔 🤨 😐 😴 ' +
    '🤡 👻 💀 🙄 😵 ' +
    '🤝 👏 👍 👎 🙏 💪 👋 ✌️ 🤞 👌 ' +
    '🎉 ✨ 🔥 💯 ❤️ 💔 ' +
    '🌙 ⛅ 🌧️ 🌈 ☀️ ❄️ 💡'
  ).split(' ');

  var EYE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M1.6 12S5.6 5.2 12 5.2 22.4 12 22.4 12 18.4 18.8 12 18.8 1.6 12 1.6 12z"></path>' +
    '<circle cx="12" cy="12" r="3.1"></circle></svg>';

  var HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M20.8 5.9a5.2 5.2 0 0 0-7.4 0L12 7.3l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.7l8.8-8.4a5.2 5.2 0 0 0 0-7.4z"></path></svg>';

  // 表单左侧的默认头像（Twikoo 那枚人形图标的位置）
  var USER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8.2" r="4.1"></circle>' +
    '<path d="M4.2 20.4a7.8 7.8 0 0 1 15.6 0"></path></svg>';

  /* ------------------------------- 工具函数 ------------------------------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 7 天内说「几分钟/几小时/几天前」，超过 7 天才写具体日期
  function timeAgo(seconds) {
    var ts = Number(seconds) * 1000;
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 0) diff = 0;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    var date = new Date(ts);
    var now = new Date();
    var md = (date.getMonth() + 1) + '月' + date.getDate() + '日';
    return date.getFullYear() === now.getFullYear() ? md : date.getFullYear() + '年' + md;
  }

  function fullTime(seconds) {
    var d = new Date(Number(seconds) * 1000);
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  var hashCache = {};
  function sha256Hex(text) {
    if (hashCache[text]) return Promise.resolve(hashCache[text]);
    if (!(window.crypto && window.crypto.subtle)) return Promise.resolve('');
    return window.crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(text))
      .then(function (buffer) {
        var hex = Array.prototype.map.call(new Uint8Array(buffer), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
        hashCache[text] = hex;
        return hex;
      })
      .catch(function () { return ''; });
  }

  // Gravatar / Cravatar 只认 md5，服务端的 email_hash 也是 md5，
  // 这里给表单里的头像预览算同一份哈希（邮箱很短，纯 JS 足够快）。
  var md5Cache = {};
  function md5Hex(text) {
    var str = String(text || '');
    if (md5Cache[str]) return md5Cache[str];
    var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var K = [];
    for (var n = 0; n < 64; n += 1) K[n] = (Math.floor(Math.abs(Math.sin(n + 1)) * 4294967296)) | 0;

    var bytes = new TextEncoder().encode(str);
    var len = bytes.length;
    var words = [];
    for (var i = 0; i < len; i += 1) words[i >> 2] = (words[i >> 2] | 0) | (bytes[i] << ((i % 4) * 8));
    words[len >> 2] = (words[len >> 2] | 0) | (0x80 << ((len % 4) * 8));
    var total = (((len + 8) >> 6) + 1) * 16;
    words[total - 2] = len * 8;

    var h0 = 1732584193, h1 = -271733879, h2 = -1732584194, h3 = 271733878;
    function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
    for (var block = 0; block < total; block += 16) {
      var a = h0, b = h1, c = h2, d = h3;
      for (var j = 0; j < 64; j += 1) {
        var f, g;
        if (j < 16) { f = (b & c) | (~b & d); g = j; }
        else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
        else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * j) % 16; }
        var tmp = d;
        d = c;
        c = b;
        b = (b + rotl((a + f + K[j] + (words[block + g] | 0)) | 0, S[j])) | 0;
        a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    }

    function le(x) {
      var out = '';
      for (var k = 0; k < 4; k += 1) out += ('0' + ((x >>> (k * 8)) & 0xff).toString(16)).slice(-2);
      return out;
    }
    var hex = le(h0) + le(h1) + le(h2) + le(h3);
    md5Cache[str] = hex;
    return hex;
  }

  // 字母头像配色：取中等深度，白字在浅色与深色主题下都读得清
  var FALLBACK_COLORS = [
    ['#5f7096', '#ffffff'], ['#5f7d6c', '#ffffff'], ['#9b6553', '#ffffff'],
    ['#6f5f92', '#ffffff'], ['#4f7684', '#ffffff'], ['#87703f', '#ffffff'],
    ['#8a5b70', '#ffffff'], ['#5f6f58', '#ffffff']
  ];

  function fallbackAvatar(nick) {
    var pair = FALLBACK_COLORS[hashString(nick || '?') % FALLBACK_COLORS.length];
    var letter = (nick || '?').trim().charAt(0);
    return '<span class="cm-avatar cm-avatar--letter" style="background:' + pair[0] +
      ';color:' + pair[1] + '" aria-hidden="true">' + escapeHtml(letter) + '</span>';
  }

  // 会话 / 访客标识：都用随机串，服务端只存加盐哈希
  function randomId(bytesLength) {
    var bytes = new Uint8Array(bytesLength || 16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  // 同一标签页内保持不变（刷新还在），关掉浏览器就换新的 → 「按会话去重」
  function sessionId() {
    try {
      var saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) return saved;
      var fresh = randomId(16);
      sessionStorage.setItem(SESSION_KEY, fresh);
      return fresh;
    } catch (error) {
      return '';
    }
  }

  // 点赞身份更长久一些，存在 localStorage
  function visitorId() {
    try {
      var saved = localStorage.getItem(VISITOR_KEY);
      if (saved) return saved;
      var fresh = randomId(16);
      localStorage.setItem(VISITOR_KEY, fresh);
      return fresh;
    } catch (error) {
      return '';
    }
  }

  /* ------------------------- 轻量 Markdown → 安全 HTML ------------------------ */

  /**
   * @param {string} text 正文
   * @param {string} prefix 可选的 HTML 前缀（回复时是 @昵称），会并进第一段里，
   *                        这样「@某人 内容」在同一行，不另起一段
   */
  function renderContent(text, prefix) {
    var raw = escapeHtml(text);
    var codes = [];

    raw = raw.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, function (match, body) {
      codes.push(body.replace(/\n$/, ''));
      return '\u0000CODE' + (codes.length - 1) + '\u0000';
    });

    raw = raw.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    raw = raw.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    raw = raw.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    raw = raw.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    raw = raw.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
      '<img src="$2" alt="$1" loading="lazy" referrerpolicy="no-referrer">');
    raw = raw.replace(/^&gt;\s?(.*)$/gm, '<span class="cm-quote">$1</span>');

    raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="nofollow noopener ugc">$1</a>');
    raw = raw.replace(/(^|[\s(（])(https?:\/\/[^\s<）)]+[^\s<）).,;:!?])/g,
      '$1<a href="$2" target="_blank" rel="nofollow noopener ugc">$2</a>');

    raw = raw.replace(/(^|[\s>])@([\w\u4e00-\u9fa5._-]{1,24})/g,
      '$1<span class="cm-at">@$2</span>');

    var pendingPrefix = prefix || '';
    var blocks = raw.split(/\n{2,}/);
    var html = blocks.map(function (block) {
      var trimmed = block.trim();
      if (!trimmed) return '';
      if (/\u0000CODE\d+\u0000/.test(trimmed) && trimmed.replace(/\u0000CODE\d+\u0000/g, '') === '') {
        return trimmed;
      }
      var lead = '';
      if (pendingPrefix) {
        lead = pendingPrefix;
        pendingPrefix = '';
      }
      return '<p>' + lead + trimmed.replace(/\n/g, '<br>') + '</p>';
    }).join('');

    // 整条都是代码块时，@ 单独成行，别把代码挤坏
    if (pendingPrefix) html = '<p>' + pendingPrefix + '</p>' + html;

    html = html.replace(/\u0000CODE(\d+)\u0000/g, function (match, index) {
      return '<pre><code>' + codes[Number(index)] + '</code></pre>';
    });

    return html;
  }

  var turnstileLoader = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = function () { resolve(window.turnstile); };
      script.onerror = function () { reject(new Error('人机验证组件加载失败')); };
      document.head.appendChild(script);
    });
    return turnstileLoader;
  }

  function attachTurnstile(container, siteKey) {
    if (!siteKey || !container) return;
    var target = container.querySelector('.cm-turnstile');
    if (!target || target.dataset.loading) return;
    target.dataset.loading = '1';
    loadTurnstile().then(function (api) {
      if (!api || target.dataset.widgetId) return;
      target.dataset.widgetId = String(api.render(target, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible'
      }));
    }).catch(function (error) {
      target.textContent = error.message || '人机验证加载失败';
      target.classList.add('is-error');
    });
  }

  function resetTurnstile(container) {
    var target = container && container.querySelector('.cm-turnstile');
    if (!target || !target.dataset.widgetId || !window.turnstile) return;
    try { window.turnstile.reset(target.dataset.widgetId); } catch (error) { /* ignore */ }
  }

  /* -------------------------------- 组件主体 ------------------------------- */

  function mount(target, options) {
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) {
      console.warn('[comments] 找不到挂载节点：', target);
      return null;
    }
    if (root.__comments) return root.__comments;

    var opts = Object.assign({
      threadKey: '',
      threadUrl: '',
      threadTitle: '',
      api: '/api/comments',
      avatar: '',
      adminHash: '',
      turnstileSiteKey: '',
      placeholder: '等风，也等你…',
      showHeader: true,
      showStats: true,
      pageSize: 10
    }, options || {});

    if (opts.avatar === 'letter') {
      // 只用昵称首字，不去外面取图
      AVATARS = [];
    } else if (opts.avatar) {
      AVATARS = [opts.avatar.replace(/\/?$/, '/')].concat(AVATARS.filter(function (item) {
        return item.indexOf(opts.avatar) !== 0;
      }));
    }

    var state = {
      comments: [],
      byId: {},
      loading: true,
      submitting: false,
      mountedAt: Date.now(),
      total: 0,
      topTotal: 0,
      adminToken: '',
      adminSaved: '',
      adminBusy: false,
      likeBusy: false,
      replyBox: null,
      // 分页：只切"楼"，楼中楼整串跟着走；收起状态按顶层 id 记
      page: 1,
      pageSize: Math.max(1, Number(opts.pageSize) || 10),
      expanded: {},
      tree: null,
      stats: { views: 0, likes: 0, liked: false, loaded: false }
    };

    /* --------------------------- 本地存储的几个小工具 -------------------------- */

    function identity() {
      try {
        return JSON.parse(localStorage.getItem(IDENTITY_KEY) || '{}') || {};
      } catch (error) {
        return {};
      }
    }

    function rememberIdentity(data) {
      try {
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(data));
      } catch (error) {
        /* 隐私模式下忽略 */
      }
    }

    // 管理口令只在当前标签页保留
    function readAdminToken() {
      try {
        return sessionStorage.getItem(ADMIN_KEY) || '';
      } catch (error) {
        return '';
      }
    }

    function saveAdminToken(token) {
      try {
        sessionStorage.setItem(ADMIN_KEY, token);
      } catch (error) {
        /* 存不下就算了，本次会话内 state 里还有 */
      }
    }

    function clearAdminToken() {
      try {
        sessionStorage.removeItem(ADMIN_KEY);
        // 清掉旧版本曾写入的 30 天口令。
        localStorage.removeItem(ADMIN_KEY);
      } catch (error) {
        /* ignore */
      }
    }

    // 管理模式开关（不动口令本身）
    function readAdminActive() {
      try {
        return sessionStorage.getItem(ADMIN_ACTIVE_KEY) === '1';
      } catch (error) {
        return false;
      }
    }

    function writeAdminActive(on) {
      try {
        if (on) sessionStorage.setItem(ADMIN_ACTIVE_KEY, '1');
        else sessionStorage.removeItem(ADMIN_ACTIVE_KEY);
      } catch (error) {
        /* ignore */
      }
    }

    state.adminSaved = readAdminToken();
    // 口令记着，但只有当前标签页里主动进过管理模式才算"在管理中"
    state.adminToken = readAdminActive() ? state.adminSaved : '';

    /* --------------------------- 改稿凭据（本地留一把） -------------------------- */

    function readEditAll() {
      try {
        return JSON.parse(localStorage.getItem(EDIT_KEY) || '{}') || {};
      } catch (error) {
        return {};
      }
    }

    function rememberEdit(id, token) {
      if (!id || !token) return;
      var all = readEditAll();
      all[id] = token;
      // 只留最近 50 条，别把 localStorage 撑爆
      var keys = Object.keys(all);
      if (keys.length > 50) {
        keys.slice(0, keys.length - 50).forEach(function (key) { delete all[key]; });
      }
      try {
        localStorage.setItem(EDIT_KEY, JSON.stringify(all));
      } catch (error) {
        /* 存不下就算了，这次会话里还能改 */
      }
    }

    function editTokenOf(id) {
      var all = readEditAll();
      return all[String(id)] || '';
    }

    /* ------------------------------ DOM 构建 ------------------------------ */

    root.classList.add('cm-app');
    root.innerHTML = '';

    var head = null;
    if (opts.showHeader) {
      head = document.createElement('div');
      head.className = 'cm-head';
      head.innerHTML =
        '<div class="cm-head-title">' +
          '<h3>欢迎评论</h3>' +
          '<span class="cm-total">加载中…</span>' +
        '</div>';
      root.appendChild(head);
    }

    // 头部右侧：阅读/点赞 + 管理入口
    // 没有头部（哔哔列表就地展开）时整块挪到表单底栏
    var tools = document.createElement('div');
    tools.className = 'cm-head-tools';
    tools.innerHTML =
      '<span class="cm-stats" hidden>' +
        '<span class="cm-views">' +
          EYE_ICON + '<b>0</b></span>' +
        '<button type="button" class="cm-like" aria-pressed="false" data-tip="今日欢喜">' +
          HEART_ICON + '<b>0</b></button>' +
      '</span>' +
      '<button type="button" class="cm-entry" hidden>管理</button>' +
      '<span class="cm-admin-flag" hidden>管理中 <button type="button" class="cm-logout">退出</button>' +
        '<button type="button" class="cm-forget" data-tip="连记着的口令一起忘掉">忘掉</button></span>';
    if (head) head.appendChild(tools);

    var saved = identity();

    var form = document.createElement('form');
    form.className = 'cm-form';
    form.setAttribute('novalidate', 'novalidate');

    // 三格输入：格子左边是标签（昵称 / 邮箱 / 网址），右边才是输入框本身，
    // 视觉上参考 Twikoo 那套，但用博客自己的主题变量上色。
    function field(name, label, hint, value, type, autocomplete) {
      var max = name === 'nick' ? 40 : name === 'email' ? 120 : 200;
      return '<label class="cm-field">' +
        '<span class="cm-field-label">' + label + '</span>' +
        '<input class="cm-input" name="' + name + '"' + (type ? ' type="' + type + '"' : '') +
          ' maxlength="' + max + '" placeholder="' + escapeHtml(hint) + '"' +
          ' autocomplete="' + autocomplete + '" value="' + escapeHtml(value || '') + '"' +
          (name === 'website' ? '' : ' aria-required="true"') + '>' +
      '</label>';
    }

    form.innerHTML =
      '<span class="cm-form-avatar" aria-hidden="true">' + USER_ICON + '</span>' +
      '<div class="cm-form-body">' +
        '<div class="cm-form-row">' +
          field('nick', '昵称', '必填', saved.nick, '', 'nickname') +
          field('email', '邮箱', '必填，不公开', saved.email, 'email', 'email') +
          field('website', '网址', '选填', saved.website, '', 'url') +
        '</div>' +
        '<div class="cm-editor">' +
          '<textarea class="cm-textarea" name="content" maxlength="500" aria-required="true" placeholder="' +
            escapeHtml(opts.placeholder) + '"></textarea>' +
          '<span class="cm-counter"><b>0</b>/500</span>' +
        '</div>' +
        emojiPanel() +
        '<div class="cm-hp"><input name="hp" tabindex="-1" autocomplete="off" aria-hidden="true"></div>' +
        '<div class="cm-form-foot">' +
          emojiButton() +
          '<label class="cm-notify"><input type="checkbox" name="notify" checked> 有人回复时邮件通知我</label>' +
          '<button type="submit" class="cm-submit">发表评论</button>' +
        '</div>' +
        (opts.turnstileSiteKey ? '<div class="cm-turnstile"></div>' : '') +
        '<div class="cm-message" role="status" aria-live="polite"></div>' +
      '</div>';
    root.appendChild(form);
    attachTurnstile(form, opts.turnstileSiteKey);
    if (!head) {
      var foot = form.querySelector('.cm-form-foot');
      if (foot) foot.appendChild(tools);
    }

    var login = document.createElement('div');
    login.className = 'cm-login';
    login.hidden = true;
    login.innerHTML =
      '<span class="cm-login-label">管理口令</span>' +
      '<input type="password" class="cm-input cm-login-input" placeholder="输入口令" autocomplete="current-password">' +
      '<button type="button" class="cm-submit cm-login-btn">进入</button>' +
      '<button type="button" class="cm-cancel cm-login-cancel">取消</button>';
    root.appendChild(login);

    var list = document.createElement('ol');
    list.className = 'cm-list';
    root.appendChild(list);

    // 分页条：只在超过一页时出现
    var pager = document.createElement('nav');
    pager.className = 'cm-pager';
    pager.hidden = true;
    pager.setAttribute('aria-label', '评论分页');
    root.appendChild(pager);

    var msg = form.querySelector('.cm-message');
    var submitBtn = form.querySelector('.cm-submit');
    // 显式取字段，不依赖表单的命名属性（老浏览器/无头环境更稳）
    var nickInput = form.querySelector('[name=nick]');
    var emailInput = form.querySelector('[name=email]');
    var websiteInput = form.querySelector('[name=website]');
    var contentInput = form.querySelector('[name=content]');
    var honeyInput = form.querySelector('[name=hp]');
    var notifyInput = form.querySelector('[name=notify]');
    var counterNum = form.querySelector('.cm-counter b');
    var formAvatar = form.querySelector('.cm-form-avatar');
    var avatarTimer = null;

    // 字数提示跟着输入走，上限与 textarea 的 maxlength 保持一致
    function syncCounter() {
      // maxlength 只管键盘输入，粘贴/脚本赋值可能越界，这里再兜一道
      if (contentInput.value.length > 500) contentInput.value = contentInput.value.slice(0, 500);
      if (counterNum) counterNum.textContent = String(contentInput.value.length);
    }
    contentInput.addEventListener('input', syncCounter);
    syncCounter();

    // 表单头像：空 → 灰色人形；有昵称 → 首字母；邮箱合法 → 再盖上 Gravatar
    function renderFormAvatar() {
      if (!formAvatar) return;
      var nick = nickInput.value.trim();
      var email = emailInput.value.trim().toLowerCase();
      formAvatar.innerHTML = nick ? fallbackAvatar(nick) : USER_ICON;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !AVATARS.length) return;

      var hash = md5Hex(email);
      var step = 0;
      // 与评论列表同一套来源，只取前两家（cravatar / weavatar，都在国内可达；
      // gravatar 主站在这里连不上，轮过去只会白等）。取不到就把图片摘掉，
      // 露出底下的首字母/人形。
      var chain = AVATARS.slice(0, 2);
      var img = document.createElement('img');
      img.className = 'cm-form-avatar-img';
      img.alt = '';
      img.addEventListener('error', function () {
        step += 1;
        if (step < chain.length) img.src = chain[step] + hash + '?s=96&d=404';
        else img.remove();
      });
      img.src = chain[0] + hash + '?s=96&d=404';
      formAvatar.appendChild(img);
    }

    function queueAvatar() {
      clearTimeout(avatarTimer);
      avatarTimer = setTimeout(renderFormAvatar, 320);
    }

    nickInput.addEventListener('input', queueAvatar);
    emailInput.addEventListener('input', queueAvatar);
    renderFormAvatar();
    var entryBtn = tools.querySelector('.cm-entry');
    var adminFlag = tools.querySelector('.cm-admin-flag');
    var statsBar = tools.querySelector('.cm-stats');
    var likeBtn = tools.querySelector('.cm-like');
    var loginInput = login.querySelector('.cm-login-input');
    var loginBtn = login.querySelector('.cm-login-btn');

    function emojiButton() {
      return '<button type="button" class="cm-emoji-btn" aria-label="插入表情" data-tip="插入表情">🙂</button>';
    }

    // 面板单独占一块，插在输入框正下方，展开时把底部工具条往下推
    function emojiPanel() {
      return '<div class="cm-emoji-panel" hidden>' +
        EMOJIS.map(function (emoji) {
          return '<button type="button" class="cm-emoji-item" data-emoji="' + emoji + '">' +
            emoji + '</button>';
        }).join('') +
      '</div>';
    }

    function setMessage(text, tone) {
      msg.textContent = text || '';
      msg.className = 'cm-message' + (tone ? ' is-' + tone : '');
    }

    function updateHead() {
      if (!head) return;
      var total = head.querySelector('.cm-total');
      var text;
      if (state.total > 0) {
        text = state.total + ' 条评论';
        total.setAttribute('data-tip', '含 ' + state.topTotal + ' 个话题、' +
          (state.total - state.topTotal) + ' 条回复');
      } else {
        text = '此时无声胜有声';
        total.removeAttribute('data-tip');
      }
      total.textContent = text;
    }

    // 正文里的阅读量占位：<span data-cm-page-views>0</span>
    // 页面任意位置放一个就能显示本页阅读量，和评论区工具条共用同一份统计
    function syncPageViews() {
      if (!state.stats.loaded) return;
      var nodes = document.querySelectorAll('[data-cm-page-views]');
      for (var i = 0; i < nodes.length; i += 1) {
        nodes[i].textContent = String(state.stats.views);
      }
    }

    function renderStats() {
      syncPageViews();
      if (!statsBar) return;
      statsBar.hidden = !state.stats.loaded;
      if (!state.stats.loaded) return;
      statsBar.querySelector('.cm-views b').textContent = state.stats.views;
      var label = likeBtn.querySelector('b');
      label.textContent = state.stats.likes;
      likeBtn.classList.toggle('is-on', state.stats.liked);
      likeBtn.setAttribute('aria-pressed', state.stats.liked ? 'true' : 'false');
      likeBtn.setAttribute('data-tip', state.stats.liked ? '取消点赞' : '今日欢喜');
    }

    function renderAdminState() {
      var on = Boolean(state.adminToken);
      if (adminFlag) adminFlag.hidden = !on;
      if (entryBtn) entryBtn.hidden = on || !entryBtn.dataset.show;
      if (on) login.hidden = true;
    }

    /* ------------------------------ 渲染列表 ------------------------------ */

    function avatarHtml(comment) {
      // 字母头像永远垫在底层：CDN 慢或取不到时不会出现空圈
      var base = fallbackAvatar(comment.nick);
      if (!comment.hasEmail || !comment.emailHash || !AVATARS.length) {
        return '<span class="cm-avatar-wrap">' + base + '</span>';
      }
      return '<span class="cm-avatar-wrap">' + base +
        '<img class="cm-avatar" src="' + AVATARS[0] + comment.emailHash + '?s=96&d=404" alt=""' +
        ' loading="lazy" width="40" height="40"' +
        ' data-hash="' + escapeHtml(comment.emailHash) + '" data-step="0">' +
      '</span>';
    }

    // 只显示一种：博主。评论没有审核环节，写上来就是公开的。
    // 2026-10 改成「花边印章 + 白色对勾」（参考 Twikoo 那款）：外圈是 8 瓣花边，
    // 每瓣用一段半径 4.07 的圆弧，弧与弧在「凹口」处相切于半径 9.8 的圆，
    // 所以既有圆润的凸起又有收进去的腰；纯 SVG 路径，不依赖图片；
    // 颜色走 --cm-accent / --cm-accent-contrast，四套配色和深色模式自动跟随。
    function badgeHtml(comment) {
      if (!comment.isAdmin) return '';
      return '<span class="cm-badge cm-badge--admin" data-tip="博主" aria-label="博主">' +
          '<svg class="cm-badge-seal" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path fill="currentColor" d="M21.03 15.74A4.07 4.07 0 0 0 21.03 8.26A4.07 4.07 0 0 0 15.74 2.97' +
              'A4.07 4.07 0 0 0 8.26 2.97A4.07 4.07 0 0 0 2.97 8.26A4.07 4.07 0 0 0 2.97 15.74' +
              'A4.07 4.07 0 0 0 8.26 21.03A4.07 4.07 0 0 0 15.74 21.03A4.07 4.07 0 0 0 21.03 15.74Z"/>' +
            '<path d="M6.9 12.7 10 14.8 16.1 8" fill="none" style="stroke:var(--cm-accent-contrast)"' +
              ' stroke-width="2.45" stroke-linecap="butt" stroke-linejoin="miter"/>' +
          '</svg>' +
        '</span>';
    }

    // 不再展示留言者的「地区 / 浏览器 / 系统」那一行信息（用户要求）。
    // region / browser / os 字段服务端仍在采集，只是前端不渲染了。
    function subLine(comment) {
      return '';
    }

    function replyPrefix(comment) {
      if (!comment.parentId) return '';
      var parent = state.byId[comment.parentId];
      if (!parent) return '';
      var at = '@' + parent.nick;
      if (String(comment.content || '').trim().indexOf(at) === 0) return '';
      return '<span class="cm-at">' + escapeHtml(at) + '</span>';
    }

    // 管理模式下每条后面挂「垃圾 / 删除」，事后清理用；没有「通过」了，因为没有待审
    function modHtml(comment) {
      if (!state.adminToken) return '';
      return '<span class="cm-mod">' +
        '<button type="button" data-mod="spam" data-id="' + comment.id + '">垃圾</button>' +
        '<button type="button" data-mod="delete" data-id="' + comment.id + '">删除</button>' +
      '</span>';
    }

    // 改稿窗还开着吗（秒级；和 service.js 的 EDIT_WINDOW 同一个口径）
    function withinEditWindow(comment) {
      return Date.now() / 1000 - Number(comment.createdAt || 0) <= EDIT_WINDOW;
    }

    // 还能改多少秒，用来做编辑器里的倒计时
    function editRemain(comment) {
      return Math.ceil(EDIT_WINDOW - (Date.now() / 1000 - Number(comment.createdAt || 0)));
    }

    // 谁能改这条：管理模式下一律能改；否则只有客人自己那条，且 1 分钟内。
    // 博主署名的评论不凭 edit_token 放行 —— 想改自己漏的字，必须先进管理模式。
    function canEdit(comment) {
      if (state.adminToken) return true;
      if (comment.isAdmin) return false;
      if (!editTokenOf(comment.id)) return false;
      return withinEditWindow(comment);
    }

    // 昵称链接：老数据里有一堆裸域名（hux.ink、www.hux.ink/xxx），
    // 直接写进 href 会被当成相对路径，点一下跳到 /about/hux.ink 去。这里补协议兜底。
    function linkHref(raw) {
      var value = String(raw || '').trim();
      if (!value) return '';
      if (/^https?:\/\//i.test(value)) return value;
      // 别的协议（javascript:、data:）一棵藤都不给，免得老数据里混进脏链接
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
      return 'https://' + value.replace(/^\/+/, '');
    }

    // 回复按钮：气泡图标（原来是「回复」两个字）。
    // 顶层楼右侧带这一楼下的回复条数，回复本身没有下级，永远是空气泡。
    // 数字按整楼总条数算（含被折叠起来的），所以「展开/收起」不会让它变来变去；
    // 新回复写进来后 renderList 重算 tree，数字自然跟着涨。
    function replyActionHtml(comment, replyCount) {
      var n = Number(replyCount) || 0;
      if (n < 0) n = 0;
      return '<button type="button" class="cm-reply-btn' + (n ? ' has-count' : '') +
          '" data-reply="' + comment.id + '" data-tip="回复"' +
          ' aria-label="回复' + (n ? '，这一楼已有 ' + n + ' 条回复' : '') + '">' +
          '<svg class="cm-reply-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
            '<path d="M10 3.6c4.05 0 7.3 2.66 7.3 5.94 0 3.28-3.25 5.94-7.3 5.94-.86 0-1.7-.12-2.48-.34l-3.7 1.44 1.02-3.06C3.4 12.4 2.7 11.16 2.7 9.54 2.7 6.26 5.95 3.6 10 3.6Z"' +
              ' fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>' +
          '</svg>' +
          (n ? '<span class="cm-reply-count">' + n + '</span>' : '') +
        '</button>';
    }

    function commentHtml(comment, floor, replyCount) {
      var isReply = Boolean(comment.parentId);
      return '<li class="cm-item" id="cm-c-' + comment.id +
          '" data-id="' + comment.id + '">' +
        avatarHtml(comment) +
        '<div class="cm-body">' +
          '<div class="cm-meta">' +
            (linkHref(comment.website)
              ? '<a class="cm-nick" href="' + escapeHtml(linkHref(comment.website)) + '" target="_blank" rel="nofollow noopener ugc">' + escapeHtml(comment.nick) + '</a>'
              : '<span class="cm-nick">' + escapeHtml(comment.nick) + '</span>') +
            badgeHtml(comment) +
            (floor ? '<span class="cm-floor">' + floor + ' 楼</span>' : '') +
            '<time class="cm-time" datetime="' + new Date(comment.createdAt * 1000).toISOString() +
              '" data-tip="' + fullTime(comment.createdAt) + '">' + timeAgo(comment.createdAt) + '</time>' +
            '<span class="cm-actions">' +
              replyActionHtml(comment, replyCount) +
              (canEdit(comment)
                ? '<button type="button" class="cm-reply-btn cm-edit-btn" data-edit="' + comment.id + '">编辑</button>'
                : '') +
              modHtml(comment) +
            '</span>' +
          '</div>' +
          subLine(comment) +
          '<div class="cm-content">' + renderContent(comment.content, replyPrefix(comment)) + '</div>' +
          (isReply ? '' : '<ul class="cm-children"></ul>') +
        '</div>' +
      '</li>';
    }

    function asc(a, b) {
      return a.createdAt - b.createdAt || a.id - b.id;
    }

    function desc(a, b) {
      return b.createdAt - a.createdAt || b.id - a.id;
    }

    function buildTree() {
      var byId = {};
      var tops = [];
      var children = {};

      state.comments.forEach(function (comment) {
        byId[comment.id] = comment;
      });
      state.byId = byId;

      state.comments.forEach(function (comment) {
        var parent = comment.parentId ? byId[comment.parentId] : null;
        if (!parent) {
          tops.push(comment);
          return;
        }
        // 二层拍平：回复的回复挂到顶层评论下
        var rootId = comment.rootId || parent.id;
        if (!children[rootId]) children[rootId] = [];
        children[rootId].push(comment);
      });

      // 顶层：最新的在最上面；楼中楼：顺着时间往下读
      tops.sort(desc);
      Object.keys(children).forEach(function (key) {
        children[key].sort(asc);
      });

      return { tops: tops, children: children };
    }

    // 计数口径：回复也算一条（详见 docs/comment-system.md）
    function recount() {
      var total = 0;
      var tops = 0;
      state.comments.forEach(function (c) {
        total += 1;
        if (!c.parentId) tops += 1;
      });
      state.total = total;
      state.topTotal = tops;
    }

    // 楼中楼超过这么多条就先折叠起来
    var REPLY_COLLAPSE_AT = 5;

    // 楼号按时间正序编，倒序展示时 1 楼在最下面
    function floorMap() {
      var floorOf = {};
      state.comments
        .filter(function (c) { return !c.parentId; })
        .sort(asc)
        .forEach(function (c, index) { floorOf[c.id] = index + 1; });
      return floorOf;
    }

    // 楼中楼内容：超过 REPLY_COLLAPSE_AT 条先截断，末尾挂一个「展开」按钮
    function childrenHtmlOf(rootId, kids, floorOf) {
      var expanded = Boolean(state.expanded[rootId]);
      var showAll = expanded || kids.length <= REPLY_COLLAPSE_AT;
      var shown = showAll ? kids : kids.slice(0, REPLY_COLLAPSE_AT);

      var html = shown.map(function (kid) {
        return commentHtml(kid, floorOf[kid.id] || 0, 0);
      }).join('');

      if (!showAll) {
        html += '<li class="cm-more"><button type="button" class="cm-more-btn" data-more="' + rootId +
          '">展开另外 ' + (kids.length - shown.length) + ' 条回复</button></li>';
      } else if (expanded && kids.length > REPLY_COLLAPSE_AT) {
        html += '<li class="cm-more"><button type="button" class="cm-more-btn" data-less="' + rootId +
          '">收起回复</button></li>';
      }
      return html;
    }

    function pageNumbers(current, total) {
      if (total <= 7) {
        var all = [];
        for (var i = 1; i <= total; i += 1) all.push(i);
        return all;
      }
      var out = [1];
      if (current > 3) out.push('…');
      for (var n = Math.max(2, current - 1); n <= Math.min(total - 1, current + 1); n += 1) out.push(n);
      if (current < total - 2) out.push('…');
      out.push(total);
      return out;
    }

    function renderPager(pages) {
      if (!pages || pages <= 1) {
        pager.hidden = true;
        pager.innerHTML = '';
        return;
      }
      var parts = [];
      parts.push('<button type="button" class="cm-page-btn" data-page="' + (state.page - 1) + '"' +
        (state.page <= 1 ? ' disabled' : '') + '>上一页</button>');

      pageNumbers(state.page, pages).forEach(function (n) {
        if (n === '…') {
          parts.push('<span class="cm-page-gap">…</span>');
          return;
        }
        var current = n === state.page;
        parts.push('<button type="button" class="cm-page-btn' + (current ? ' is-current' : '') +
          '" data-page="' + n + '"' + (current ? ' aria-current="page"' : '') + '>' + n + '</button>');
      });

      parts.push('<button type="button" class="cm-page-btn" data-page="' + (state.page + 1) + '"' +
        (state.page >= pages ? ' disabled' : '') + '>下一页</button>');
      parts.push('<span class="cm-page-info">第 ' + state.page + ' / ' + pages + ' 页</span>');

      pager.innerHTML = parts.join('');
      pager.hidden = false;
    }

    function renderList() {
      var tree = buildTree();
      state.tree = tree;
      recount();
      updateHead();

      if (!state.comments.length) {
        list.innerHTML = '<li class="cm-empty">安静得像一张白纸，第一句留给你。</li>';
        renderPager(0);
        return;
      }

      var floorOf = floorMap();

      // 分页只切顶层（"楼"），楼中楼整串跟着它走，不会被页码拆散
      var pages = Math.max(1, Math.ceil(tree.tops.length / state.pageSize));
      if (state.page > pages) state.page = pages;
      if (state.page < 1) state.page = 1;
      var start = (state.page - 1) * state.pageSize;

      var html = tree.tops.slice(start, start + state.pageSize).map(function (comment) {
        var kids = tree.children[comment.id] || [];
        var item = commentHtml(comment, floorOf[comment.id] || 0, kids.length);
        if (!kids.length) return item;
        return item.replace('<ul class="cm-children"></ul>',
          '<ul class="cm-children">' + childrenHtmlOf(comment.id, kids, floorOf) + '</ul>');
      }).join('');

      list.innerHTML = html;
      bindAvatarFallback();
      renderPager(pages);

      list.querySelectorAll('.cm-time').forEach(function (node) {
        var iso = node.getAttribute('datetime');
        if (iso) node.textContent = timeAgo(Date.parse(iso) / 1000);
      });
    }

    // 就地展开/收起某一楼，只重画那一小段，避免整页高度跳动
    function toggleReplies(btn) {
      var more = btn.hasAttribute('data-more');
      var id = Number(more ? btn.getAttribute('data-more') : btn.getAttribute('data-less'));
      if (!id) return;

      state.expanded[id] = more;

      var tree = state.tree || buildTree();
      var kids = tree.children[id] || [];
      var holder = document.querySelector('#cm-c-' + id + ' > .cm-body > .cm-children');
      if (!holder) { renderList(); return; }

      holder.innerHTML = childrenHtmlOf(id, kids, floorMap());
      bindAvatarFallback();
      holder.querySelectorAll('.cm-time').forEach(function (node) {
        var iso = node.getAttribute('datetime');
        if (iso) node.textContent = timeAgo(Date.parse(iso) / 1000);
      });

      if (!more) {
        // 收起后把这一楼顶回视野，别让人对着空出来的一片
        var anchor = document.getElementById('cm-c-' + id);
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    list.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-more],[data-less]') : null;
      if (!btn) return;
      event.preventDefault();
      toggleReplies(btn);
    });

    /* ------------------------------ 行内改稿 ------------------------------ */

    function openEditor(id) {
      var item = document.getElementById('cm-c-' + id);
      var comment = state.byId[id];
      if (!item || !comment) return;
      // 页面停留久了才点「编辑」：按钮可能已经过期，这里再挡一次
      if (!canEdit(comment)) {
        setMessage('超过 1 分钟就不能自己改了，想改可以请博主帮忙', 'warn');
        renderList();
        return;
      }
      var holder = item.querySelector('.cm-content');
      if (!holder || holder.__editing) return;

      var old = String(comment.content || '');
      holder.__editing = true;
      holder.classList.add('is-editing');
      holder.innerHTML =
        '<div class="cm-edit">' +
          '<textarea class="cm-textarea cm-edit-area" maxlength="500"></textarea>' +
          '<div class="cm-edit-foot">' +
            '<span class="cm-edit-counter"><b>0</b>/500</span>' +
            '<span class="cm-edit-timer" hidden></span>' +
            '<button type="button" class="cm-cancel" data-edit-cancel="' + id + '">取消</button>' +
            '<button type="button" class="cm-submit cm-edit-save" data-edit-save="' + id + '">保存</button>' +
          '</div>' +
        '</div>';

      var area = holder.querySelector('.cm-edit-area');
      var counter = holder.querySelector('.cm-edit-counter b');
      var timer = holder.querySelector('.cm-edit-timer');

      // 客人这边时间窗只有 1 分钟，把剩余秒数摆在明处；到点自动收起，别让人对着一个点不动的保存按钮发愣
      if (!state.adminToken) {
        var tickTimer = function () {
          if (!document.body.contains(area)) {
            clearInterval(timerId);
            return;
          }
          var left = editRemain(comment);
          if (left <= 0) {
            clearInterval(timerId);
            setMessage('超过 1 分钟就不能自己改了，想改可以请博主帮忙', 'warn');
            renderList();
            return;
          }
          timer.hidden = left > 20;
          timer.textContent = '还能改 ' + left + ' 秒';
          timer.classList.toggle('is-urgent', left <= 10);
        };
        var timerId = setInterval(tickTimer, 1000);
        tickTimer();
      }

      area.value = old;
      counter.textContent = String(old.length);
      area.addEventListener('input', function () {
        // maxlength 挡不住粘贴，这里再兜一道
        if (area.value.length > 500) area.value = area.value.slice(0, 500);
        counter.textContent = String(area.value.length);
      });
      area.addEventListener('keydown', function (event) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          saveEdit(id, holder.querySelector('.cm-edit-save'));
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          renderList();
        }
      });
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
      area.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function saveEdit(id, button) {
      var item = document.getElementById('cm-c-' + id);
      var area = item && item.querySelector('.cm-edit-area');
      if (!area) return;

      var text = area.value.trim();
      if (!text) {
        setMessage('内容不能为空', 'error');
        area.focus();
        return;
      }

      var payload = { id: Number(id), content: text };
      var token = editTokenOf(id);
      if (token) payload.token = token;

      var headers = { 'Content-Type': 'application/json' };
      if (state.adminToken) headers['x-admin-token'] = state.adminToken;

      if (button) {
        button.disabled = true;
        button.textContent = '保存中…';
      }

      fetch(opts.api + '/edit', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (body) { return { res: res, body: body }; });
        })
        .then(function (result) {
          var body = result.body || {};
          if (!result.res.ok || !body.ok) {
            var error = new Error((body.error && body.error.message) || '保存失败');
            error.code = body.error && body.error.code;
            throw error;
          }
          var target = state.byId[id];
          if (target) target.content = text;
          setMessage('改好了', 'ok');
          renderList();
        })
        .catch(function (error) {
          setMessage(error.message || '保存失败，稍后再试', 'error');
          // 窗关了 / 不是自己的：直接把编辑器和按钮一起收掉，别留个点不动的保存
          if (error.code === 'edit_window_closed' || error.code === 'admin_only' || error.code === 'forbidden') {
            renderList();
            return;
          }
          if (button) {
            button.disabled = false;
            button.textContent = '保存';
          }
        });
    }

    // 页面停着不动，1 分钟一过按钮也该消失，不然看着能点、点了一报错更迷惑
    function sweepEditButtons() {
      if (state.adminToken) return;
      var buttons = list.querySelectorAll('.cm-edit-btn');
      for (var i = buttons.length - 1; i >= 0; i -= 1) {
        var id = Number(buttons[i].getAttribute('data-edit'));
        var comment = state.byId[id];
        if (!comment || !canEdit(comment)) buttons[i].remove();
      }
    }
    setInterval(sweepEditButtons, EDIT_SWEEP_MS);

    list.addEventListener('click', function (event) {
      if (!event.target.closest) return;

      var editBtn = event.target.closest('[data-edit]');
      if (editBtn) {
        event.preventDefault();
        openEditor(Number(editBtn.getAttribute('data-edit')));
        return;
      }
      if (event.target.closest('[data-edit-cancel]')) {
        event.preventDefault();
        renderList();
        return;
      }
      var saveBtn = event.target.closest('[data-edit-save]');
      if (saveBtn) {
        event.preventDefault();
        saveEdit(Number(saveBtn.getAttribute('data-edit-save')), saveBtn);
      }
    });

    pager.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-page]') : null;
      if (!btn || btn.disabled) return;
      var page = Number(btn.getAttribute('data-page'));
      if (!page || page === state.page) return;
      state.page = page;
      renderList();
      var top = list.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: top > 0 ? top : 0, behavior: 'smooth' });
    });

    function bindAvatarFallback() {
      list.querySelectorAll('img.cm-avatar').forEach(function (img) {
        img.addEventListener('error', function () {
          var step = Number(img.getAttribute('data-step') || 0) + 1;
          var hash = img.getAttribute('data-hash');
          if (step < AVATARS.length && hash) {
            img.setAttribute('data-step', String(step));
            img.src = AVATARS[step] + hash + '?s=96&d=404';
            return;
          }
          // 三个源都取不到：直接去掉图片，露出底下的字母头像
          img.remove();
        });
      });
    }

    /* ------------------------------ 阅读量与点赞 ----------------------------- */

    function trackView() {
      if (!opts.showStats) return;
      fetch(opts.api + '/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadKey: opts.threadKey,
          session: sessionId(),
          visitor: visitorId()
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.ok) return;
          state.stats = {
            views: Number(data.views) || 0,
            likes: Number(data.likes) || 0,
            liked: Boolean(data.liked),
            loaded: true
          };
          renderStats();
        })
        .catch(function () { /* 统计失败不影响评论 */ });
    }

    if (likeBtn) {
      likeBtn.addEventListener('click', function () {
        if (state.likeBusy || !state.stats.loaded) return;
        state.likeBusy = true;
        var next = !state.stats.liked;
        // 先动 UI，再等服务端确认，点起来才不卡顿
        state.stats.liked = next;
        state.stats.likes = Math.max(0, state.stats.likes + (next ? 1 : -1));
        renderStats();
        fetch(opts.api + '/like', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadKey: opts.threadKey,
            visitor: visitorId(),
            action: next ? 'like' : 'unlike'
          })
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (!data || !data.ok) throw new Error('failed');
            state.stats.likes = Number(data.likes) || 0;
            state.stats.liked = Boolean(data.liked);
          })
          .catch(function () {
            state.stats.liked = !next;
            state.stats.likes = Math.max(0, state.stats.likes + (next ? -1 : 1));
          })
          .finally(function () {
            state.likeBusy = false;
            renderStats();
          });
      });
    }

    /* ------------------------------ 数据加载 ------------------------------ */

    function load() {
      state.loading = true;
      list.innerHTML = '<li class="cm-loading">正在加载评论…</li>';

      var headers = { Accept: 'application/json' };
      if (state.adminToken) headers['x-admin-token'] = state.adminToken;

      var collected = [];
      function fetchPage(offset) {
        var url = opts.api + '?thread=' + encodeURIComponent(opts.threadKey) +
          '&limit=200&offset=' + offset;
        return fetch(url, { headers: headers })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (!data || !data.ok) throw new Error((data && data.error && data.error.message) || '加载失败');
            collected = collected.concat(data.comments || []);
            if (data.hasMore) return fetchPage(offset + (data.comments || []).length);
            return collected;
          });
      }

      return fetchPage(0)
        .then(function (comments) {
          state.comments = comments;
          state.loading = false;
          renderList();
          root.dispatchEvent(new CustomEvent('comments:loaded', {
            bubbles: true,
            detail: { count: state.total, threadKey: opts.threadKey }
          }));
          focusFromHash();
        })
        .catch(function (error) {
          state.loading = false;
          list.innerHTML = '<li class="cm-empty">评论加载失败：' + escapeHtml(error.message) +
            ' <button type="button" class="cm-cancel" data-retry>重试</button></li>';
        });
    }

    function focusFromHash() {
      var hash = window.location.hash || '';
      var match = hash.match(/^#cm-c-(\d+)$/);
      if (!match) return;
      scrollToComment(match[1]);
    }

    // 页内改 hash（比如评论正文里链到另一条）也要能翻页定位，
    // 否则只有整页新开时才认锚点
    window.addEventListener('hashchange', function () {
      if (/^#cm-c-\d+$/.test(window.location.hash || '')) focusFromHash();
    });

    function scrollToComment(id, retried) {
      var node = document.getElementById('cm-c-' + id);

      if (!node && !retried) {
        // 锚点可能在别的页上：先算出它属于第几楼，翻过去再滚一次
        var target = state.byId[id];
        var rootId = target ? (target.rootId || target.parentId || target.id) : id;
        var tree = state.tree || buildTree();
        var index = -1;
        tree.tops.forEach(function (c, i) { if (String(c.id) === String(rootId)) index = i; });
        if (index < 0) return false;
        var page = Math.floor(index / state.pageSize) + 1;
        if (page !== state.page) {
          state.page = page;
          renderList();
          setTimeout(function () { scrollToComment(id, true); }, 60);
          return true;
        }
      }

      if (!node) return false;
      node.classList.add('is-target');
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { node.classList.remove('is-target'); }, 2400);
      return true;
    }

    /* ------------------------------ 表情面板 ------------------------------ */

    function insertAtCursor(textarea, text) {
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      if (start == null) start = textarea.value.length;
      if (end == null) end = start;
      var value = textarea.value;
      textarea.value = value.slice(0, start) + text + value.slice(end);
      var pos = start + text.length;
      textarea.focus();
      try { textarea.setSelectionRange(pos, pos); } catch (error) { /* ignore */ }
      // 手动派发 input，字数提示（以及任何监听）才能跟着动
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function attachEmoji(container) {
      var btn = container.querySelector('.cm-emoji-btn');
      var panel = container.querySelector('.cm-emoji-panel');
      var textarea = container.querySelector('textarea');
      if (!btn || !panel || !textarea || btn.dataset.bound) return;
      btn.dataset.bound = '1';

      btn.addEventListener('click', function (event) {
        event.preventDefault();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) textarea.focus();
      });

      panel.addEventListener('click', function (event) {
        var item = event.target.closest('[data-emoji]');
        if (!item) return;
        event.preventDefault();
        insertAtCursor(textarea, item.getAttribute('data-emoji'));
      });

      // 点别处收起面板（表单被移除后这个监听自然失效，不再干活）
      document.addEventListener('click', function (event) {
        if (!document.body.contains(container)) return;
        if (!container.contains(event.target)) panel.hidden = true;
      });
    }

    attachEmoji(form);

    /* --------------------------- 就近展开的回复框 --------------------------- */

    function replyFormHtml(comment) {
      var who = identity();
      return '<div class="cm-reply-head">' +
          '<span>回复 <strong>@' + escapeHtml(comment.nick) + '</strong></span>' +
          '<span class="cm-reply-tools">' +
            '<button type="button" class="cm-cancel" data-reply-cancel>取消</button>' +
          '</span>' +
        '</div>' +
        '<div class="cm-reply-id">' +
          '<input class="cm-input" name="nick" maxlength="40" placeholder="昵称 *" ' +
            'value="' + escapeHtml(who.nick || '') + '">' +
          '<input class="cm-input" name="email" type="email" maxlength="120" ' +
            'placeholder="邮箱 *（不会公开）" value="' + escapeHtml(who.email || '') + '">' +
          '<input class="cm-input" name="website" maxlength="200" placeholder="网址（可选）" ' +
            'value="' + escapeHtml(who.website || '') + '">' +
        '</div>' +
        '<textarea class="cm-textarea" name="content" maxlength="500" rows="3" ' +
          'placeholder="回复 @' + escapeHtml(comment.nick) + '…"></textarea>' +
        emojiPanel() +
        '<div class="cm-reply-foot">' +
          emojiButton() +
          '<label class="cm-notify"><input type="checkbox" name="notify" checked> 邮件提醒</label>' +
          '<span class="cm-reply-msg"></span>' +
          '<button type="button" class="cm-submit cm-reply-submit">发表</button>' +
        '</div>' +
        (opts.turnstileSiteKey ? '<div class="cm-turnstile"></div>' : '');
    }

    function closeReplyForm() {
      if (state.replyBox && state.replyBox.parentNode) {
        state.replyBox.parentNode.removeChild(state.replyBox);
      }
      state.replyBox = null;
    }

    function openReplyForm(comment) {
      var item = document.getElementById('cm-c-' + comment.id);
      if (!item) return;
      // 点自己身上的「回复」再点一次就收起来
      var current = state.replyBox;
      var wasSame = current && current.dataset.for === String(comment.id);
      closeReplyForm();
      if (wasSame) return;

      var body = item.querySelector('.cm-body');
      var anchor = item.querySelector('.cm-body > .cm-content') || body;
      if (!anchor) return;

      var box = document.createElement('div');
      box.className = 'cm-reply-box';
      box.dataset.for = String(comment.id);
      box.innerHTML = replyFormHtml(comment);
      anchor.insertAdjacentElement('afterend', box);
      state.replyBox = box;

      attachEmoji(box);
      attachTurnstile(box, opts.turnstileSiteKey);

      var textarea = box.querySelector('textarea');
      textarea.focus();

      box.querySelector('[data-reply-cancel]').addEventListener('click', closeReplyForm);

      var submit = box.querySelector('.cm-reply-submit');
      submit.addEventListener('click', function () {
        submitComment({
          nick: box.querySelector('[name=nick]').value.trim(),
          email: box.querySelector('[name=email]').value.trim(),
          website: box.querySelector('[name=website]').value.trim(),
          content: textarea.value.trim(),
          notify: Boolean(box.querySelector('[name=notify]') && box.querySelector('[name=notify]').checked),
          parentId: comment.id,
          container: box,
          button: submit,
          textarea: textarea,
          messageEl: box.querySelector('.cm-reply-msg'),
          nickEl: box.querySelector('[name=nick]'),
          emailEl: box.querySelector('[name=email]'),
          contentEl: textarea,
          onSuccess: closeReplyForm
        });
      });

      // Ctrl / ⌘ + Enter 快捷发送
      textarea.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit.click();
        }
      });

      setTimeout(function () {
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 30);
    }

    /* ------------------------------ 交互事件 ------------------------------ */

    list.addEventListener('click', function (event) {
      var replyBtn = event.target.closest('[data-reply]');
      if (replyBtn) {
        var comment = state.byId[Number(replyBtn.getAttribute('data-reply'))];
        if (comment) openReplyForm(comment);
        return;
      }

      var confirmBtn = event.target.closest('[data-confirm]');
      if (confirmBtn) {
        moderate(confirmBtn.getAttribute('data-confirm'), Number(confirmBtn.getAttribute('data-id')), confirmBtn);
        return;
      }

      var cancelBtn = event.target.closest('[data-confirm-cancel]');
      if (cancelBtn) {
        var box = cancelBtn.closest('.cm-mod');
        var target = state.byId[Number(cancelBtn.getAttribute('data-id'))];
        if (box && target) box.outerHTML = modHtml(target);
        return;
      }

      var modBtn = event.target.closest('[data-mod]');
      if (modBtn) {
        askModerate(modBtn.getAttribute('data-mod'), Number(modBtn.getAttribute('data-id')), modBtn);
        return;
      }

      if (event.target.closest('[data-retry]')) load();
    });

    // 垃圾 / 删除不复原，先问一句再动手
    function askModerate(action, id, button) {
      if (action === 'approve') {
        moderate(action, id, button);
        return;
      }
      var box = button.closest('.cm-mod');
      var comment = state.byId[id];
      if (!box || !comment) return;
      var isDelete = action === 'delete';
      box.innerHTML = '<span class="cm-confirm">' +
        (isDelete ? '删掉这条和它下面的一起隐藏？' : '标记为垃圾并隐藏？') +
        '<button type="button" class="cm-confirm-yes" data-confirm="' + action +
          '" data-id="' + id + '">确认</button>' +
        '<button type="button" class="cm-confirm-no" data-confirm-cancel data-id="' + id + '">取消</button>' +
      '</span>';
    }

    /* ------------------------------ 管理入口 ------------------------------ */

    function revealEntry(show) {
      if (!entryBtn) return;
      entryBtn.dataset.show = show ? '1' : '';
      entryBtn.hidden = !show || Boolean(state.adminToken);
    }

    var triggerTimer = null;
    function checkTrigger() {
      if (!opts.adminHash || state.adminToken) return;
      var value = (emailInput ? emailInput.value : '').trim().toLowerCase();
      clearTimeout(triggerTimer);
      if (!value) {
        revealEntry(false);
        return;
      }
      triggerTimer = setTimeout(function () {
        sha256Hex(value).then(function (hex) {
          revealEntry(hex === opts.adminHash);
        });
      }, 160);
    }

    // 管理入口改为「邮箱识别」：在邮箱框填入指定地址即露出「管理」按钮（大小写不敏感）
    //
    // 注意这里不能只监听 input：邮箱框的值有两个来源不经过键盘——
    //   1) 记住的身份直接写进 HTML 的 value 属性（元素一生成就有值）；
    //   2) 浏览器/密码管理器的自动填充（可能在脚本跑完之后才填）。
    // 两种情况都不会触发 input，所以绑定时先主动探一次，再补两记延迟兜底，
    // 否则带着已记住邮箱回来的人永远看不到「管理」按钮。
    if (emailInput) {
      ['input', 'change', 'blur', 'focus'].forEach(function (type) {
        emailInput.addEventListener(type, checkTrigger);
      });
      checkTrigger();
      window.setTimeout(checkTrigger, 800);
      window.setTimeout(checkTrigger, 2500);
    }

    if (entryBtn) {
      entryBtn.addEventListener('click', function () {
        // 口令还记着就直接进，弹框只在第一次或口令过期时出现
        if (state.adminSaved) {
          activateAdmin(state.adminSaved, { silent: true });
          return;
        }
        login.hidden = false;
        loginInput.value = '';
        loginInput.focus();
        login.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    // 进入管理模式：校验口令 → 记住 → 打开模式开关
    function activateAdmin(token, options) {
      var opts2 = options || {};
      loginBtn.disabled = true;
      loginBtn.textContent = '验证中…';
      return fetch(opts.api + '/admin?limit=1', { headers: { 'x-admin-token': token } })
        .then(function (res) { return res.ok; })
        .then(function (ok) {
          if (!ok) throw new Error(opts2.silent ? '记着的口令失效了，请重新输入' : '口令不对');
          state.adminToken = token;
          state.adminSaved = token;
          saveAdminToken(token);
          writeAdminActive(true);
          login.hidden = true;
          loginInput.value = '';
          revealEntry(false);
          renderAdminState();
          renderList();
          setMessage(opts2.silent ? '已在管理模式（口令还记着，退出后随时可以再进）' : '管理已登录，30 天内不用再输口令', 'ok');
          return load();
        })
        .catch(function (error) {
          if (opts2.silent) {
            // 缓存的口令已经不作数了：清掉，回到手输
            clearAdminToken();
            state.adminSaved = '';
            login.hidden = false;
            loginInput.value = '';
            loginInput.focus();
          } else {
            loginInput.select();
          }
          setMessage(error.message || '登录失败', 'error');
        })
        .finally(function () {
          loginBtn.disabled = false;
          loginBtn.textContent = '进入';
        });
    }

    login.querySelector('.cm-login-cancel').addEventListener('click', function () {
      login.hidden = true;
      loginInput.value = '';
    });

    loginInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitLogin();
      }
    });
    loginBtn.addEventListener('click', submitLogin);

    function submitLogin() {
      var token = loginInput.value.trim();
      if (!token) return;
      activateAdmin(token, { silent: false });
    }

    tools.querySelector('.cm-logout').addEventListener('click', function () {
      // 只关模式，不清口令：下次点「管理」还能直接进
      state.adminToken = '';
      writeAdminActive(false);
      renderAdminState();
      revealEntry(Boolean(entryBtn && entryBtn.dataset.show));
      renderList();
      setMessage('已退出管理模式（口令还记着，下次点「管理」直接进）', 'ok');
      load();
    });

    // 公共电脑上想连口令一起忘掉
    var forgetBtn = tools.querySelector('.cm-forget');
    if (forgetBtn) {
      forgetBtn.addEventListener('click', function () {
        state.adminToken = '';
        state.adminSaved = '';
        writeAdminActive(false);
        clearAdminToken();
        renderAdminState();
        revealEntry(false);
        renderList();
        setMessage('已退出，并忘掉了记着的口令', 'ok');
        load();
      });
    }

    function moderate(action, id, button) {
      if (!state.adminToken || state.adminBusy) return;
      state.adminBusy = true;
      if (button) button.disabled = true;
      fetch(opts.api + '/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': state.adminToken },
        body: JSON.stringify({ action: action, id: id })
      })
        .then(function (res) {
          if (res.status === 401) throw new Error('管理口令已失效，请重新登录');
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.ok) throw new Error((data && data.error && data.error.message) || '操作失败');
          setMessage(action === 'spam' ? '已标记为垃圾' : '已删除', 'ok');
          return load();
        })
        .catch(function (error) {
          // 口令换了/过期了，就退回未登录状态，别让「管理」按钮骗人
          if (/口令/.test(String(error.message || ''))) {
            state.adminToken = '';
            clearAdminToken();
            renderAdminState();
          }
          setMessage(error.message || '操作失败', 'error');
        })
        .finally(function () {
          state.adminBusy = false;
          if (button) button.disabled = false;
        });
    }

    /* ------------------------------ 提交评论 ------------------------------ */

    /**
     * 顶部表单与就近回复框共用一套提交逻辑。
     * @param {object} data
     * @param {string} data.nick
     * @param {string} data.email
     * @param {string} data.website
     * @param {string} data.content
     * @param {number|null} data.parentId
     * @param {HTMLElement} [data.button]
     * @param {HTMLElement} [data.messageEl]
     * @param {function} [data.onSuccess]
     */
    function submitComment(data) {
      if (state.submitting) return;

      var say = function (text, tone) {
        var el = data.messageEl || msg;
        el.textContent = text || '';
        el.classList.remove('is-error', 'is-ok', 'is-warn');
        if (tone) el.classList.add('is-' + tone);
      };

      if (!data.nick) { flashTip(data.nickEl, '请填写昵称'); return say('请填写昵称', 'error'); }
      if (!data.email) { flashTip(data.emailEl, '请填写邮箱'); return say('请填写邮箱，它只用来识别身份和接收回复提醒', 'error'); }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
        flashTip(data.emailEl, '邮箱格式不太对');
        return say('邮箱格式不太对', 'error');
      }
      if (!data.content) { flashTip(data.contentEl || data.textarea, '说点什么吧'); return say('说点什么吧', 'error'); }

      state.submitting = true;
      var button = data.button;
      var label = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = '发送中…';
      }

      var payload = {
        threadKey: opts.threadKey,
        threadUrl: opts.threadUrl || window.location.href,
        threadTitle: opts.threadTitle || document.title,
        nick: data.nick,
        email: data.email,
        website: data.website || '',
        content: data.content,
        notify: Boolean(data.notify),
        parentId: data.parentId || null,
        hp: honeyInput ? honeyInput.value : '',
        elapsed: Date.now() - state.mountedAt
      };
      var captchaInput = data.container && data.container.querySelector('[name="cf-turnstile-response"]');
      payload.turnstileToken = captchaInput ? captchaInput.value : '';
      if (opts.turnstileSiteKey && !payload.turnstileToken) {
        state.submitting = false;
        if (button) { button.disabled = false; button.textContent = label; }
        return say('请先完成人机验证', 'error');
      }

      var postHeaders = { 'Content-Type': 'application/json' };
      // 管理模式解锁后带上，用于管理模式操作（删除/标垃圾、改历史评论）；
      // 博主身份现在只认邮箱，带不带它都不影响挂「博主」标
      if (state.adminToken) postHeaders['x-admin-token'] = state.adminToken;

      fetch(opts.api, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          return res.json().then(function (body) { return { res: res, body: body }; });
        })
        .then(function (result) {
          var body = result.body || {};
          if (!result.res.ok || !body.ok) {
            throw new Error((body.error && body.error.message) || '提交失败');
          }

          rememberIdentity({ nick: payload.nick, email: payload.email, website: payload.website });
          resetTurnstile(data.container);

          // 在回复框里改过身份的话，主表单同步过来，下次不用再改
          if (!data.isMain) {
            if (nickInput) nickInput.value = payload.nick;
            if (emailInput) emailInput.value = payload.email;
            if (websiteInput) websiteInput.value = payload.website || '';
            // 赋值不触发 input，邮箱换了可能该冒出/收起「管理」按钮，手动探一次
            checkTrigger();
          }

          if (state.adminToken && body.comment && !body.comment.isAdmin) {
            // 在管理模式里但邮箱不是博主的：按普通访客存，不会有「博主」标
            say('发表成功。不过邮箱不是博主邮箱，这条按普通访客存的', 'warn');
          } else {
            say('发表成功，谢谢你的留言', 'ok');
          }

          if (data.onSuccess) data.onSuccess();
          if (data.textarea) data.textarea.value = '';
          if (data.isMain) contentInput.value = '';
          syncCounter();

          if (body.comment) {
            state.comments.push(body.comment);
            // 留一把改稿凭据：错别字可以自己改，不用等博主
            if (body.editToken) rememberEdit(body.comment.id, body.editToken);
            // 新评论在最前面：翻回第一页，否则用户发完看不见自己那条
            state.page = 1;
            renderList();
            root.dispatchEvent(new CustomEvent('comments:created', {
              bubbles: true,
              detail: {
                comment: body.comment,
                threadKey: opts.threadKey,
                count: state.total
              }
            }));
            setTimeout(function () {
              var node = document.getElementById('cm-c-' + body.comment.id);
              if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 40);
          } else {
            load();
          }
        })
        .catch(function (error) {
          say(error.message || '网络不太顺畅，稍后再试', 'error');
        })
        .finally(function () {
          state.submitting = false;
          if (button) {
            button.disabled = false;
            button.textContent = label;
          }
        });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      setMessage('');
      submitComment({
        nick: nickInput.value.trim(),
        email: emailInput.value.trim(),
        website: websiteInput.value.trim(),
        content: contentInput.value.trim(),
        notify: Boolean(notifyInput && notifyInput.checked),
        parentId: null,
        container: form,
        button: submitBtn,
        isMain: true,
        messageEl: msg,
        nickEl: nickInput,
        emailEl: emailInput,
        contentEl: contentInput
      });
    });

    // Ctrl / ⌘ + Enter 快捷发送
    contentInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitBtn.click();
      }
    });

    // 每 60 秒刷新一次相对时间
    var timer = setInterval(function () {
      if (document.hidden) return;
      list.querySelectorAll('.cm-time').forEach(function (node) {
        var iso = node.getAttribute('datetime');
        if (!iso) return;
        node.textContent = timeAgo(Date.parse(iso) / 1000);
      });
    }, 60000);

    var instance = {
      threadKey: opts.threadKey,
      reload: load,
      scrollToComment: scrollToComment,
      destroy: function () {
        clearInterval(timer);
        root.__comments = null;
        root.innerHTML = '';
      }
    };

    root.__comments = instance;
    renderAdminState();
    renderStats();
    load();
    trackView();
    return instance;
  }

  /* ------------------------------ 药丸提示气泡 ------------------------------ */
  // 用 data-tip 代替原生 title：原生 title 的方角系统气泡和博客风格不搭。
  // 全站共用一个节点，事件走委托，所以列表重绘后不需要重新绑定。

  var tipNode = null;
  var tipTarget = null;

  function ensureTipNode() {
    if (tipNode && tipNode.parentNode) return tipNode;
    tipNode = document.createElement('div');
    tipNode.className = 'cm-tip';
    tipNode.setAttribute('role', 'tooltip');
    document.body.appendChild(tipNode);
    return tipNode;
  }

  function placeTip(target) {
    var el = ensureTipNode();
    var rect = target.getBoundingClientRect();
    var width = el.offsetWidth;
    var height = el.offsetHeight;

    var left = rect.left + rect.width / 2 - width / 2;
    var maxLeft = window.innerWidth - width - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;

    var top = rect.top - height - 8;
    var place = 'top';
    if (top < 8) {
      top = rect.bottom + 8;
      place = 'bottom';
    }

    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.setAttribute('data-place', place);
  }

  function showTip(target) {
    var text = target.getAttribute('data-tip');
    if (!text) return;
    var el = ensureTipNode();
    tipTarget = target;
    el.textContent = text;
    // 先量尺寸再显形，避免从上一个位置滑过来
    el.style.visibility = 'hidden';
    placeTip(target);
    el.style.visibility = '';
    el.classList.add('is-visible');
  }

  function hideTip(target) {
    if (!tipNode) return;
    if (target && tipTarget && tipTarget !== target) return;
    tipTarget = null;
    tipNode.classList.remove('is-visible');
  }

  // 主动在输入控件上方弹出药丸提示（用于表单校验），替代浏览器原生方角校验气泡
  function flashTip(target, text) {
    if (!target) return;
    target.setAttribute('data-tip', text);
    try { target.focus(); } catch (e) {}
    showTip(target);
    var cleanup = function () {
      target.removeAttribute('data-tip');
      if (tipTarget === target) hideTip(target);
      target.removeEventListener('input', cleanup);
      target.removeEventListener('blur', cleanup);
    };
    target.addEventListener('input', cleanup);
    target.addEventListener('blur', cleanup);
  }

  function tipHostOf(node) {
    while (node && node !== document.body && node.parentNode) {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-tip')) return node;
      node = node.parentNode;
    }
    return null;
  }

  document.addEventListener('mouseover', function (event) {
    var host = tipHostOf(event.target);
    if (host) showTip(host);
  }, true);

  document.addEventListener('mouseout', function (event) {
    var host = tipHostOf(event.target);
    if (!host) return;
    // 在同一个元素内部移动（比如从 <b> 移到外面的圆角边）不算离开
    if (event.relatedTarget && host.contains(event.relatedTarget)) return;
    if (tipTarget === host) hideTip();
  }, true);

  document.addEventListener('focusin', function (event) {
    var host = tipHostOf(event.target);
    if (host) showTip(host);
  });

  document.addEventListener('focusout', function () {
    hideTip();
  });

  window.addEventListener('scroll', function () { hideTip(); }, true);
  window.addEventListener('resize', function () { hideTip(); });

  /* -------------------------------- 全局 API ------------------------------- */

  window.Comments = {
    mount: mount,
    timeAgo: timeAgo,
    tip: { show: showTip, hide: hideTip },
    version: '1.2.0'
  };

  // 自动挂载：<div id="comments" data-cm-thread="memo:1233" data-cm-url="...">
  function autoMount() {
    document.querySelectorAll('[data-cm-thread]').forEach(function (node) {
      if (node.__comments) return;
      mount(node, {
        threadKey: node.getAttribute('data-cm-thread'),
        threadUrl: node.getAttribute('data-cm-url') || window.location.href,
        threadTitle: node.getAttribute('data-cm-title') || document.title,
        api: node.getAttribute('data-cm-api') || '/api/comments',
        avatar: node.getAttribute('data-cm-avatar') || '',
        adminHash: node.getAttribute('data-cm-admin-hash') || '',
        turnstileSiteKey: node.getAttribute('data-cm-turnstile') || '',
        pageSize: node.getAttribute('data-cm-page-size') || 10,
        showHeader: node.getAttribute('data-cm-header') !== 'false'
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
