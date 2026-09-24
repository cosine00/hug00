(function () {
  'use strict';

  const config = Object.assign({
    dataUrl: '/memos.json',
    recentLimit: 60,
    pageSize: 12,
    randomBatchSize: 12,
    domId: '#bber',
    twiEnv: ''
  }, window.bbFocus || {});

  const css = `
    #bber{margin-top:1rem;width:auto!important;min-height:100vh}
    .bb-timeline ul{margin:0;padding:0}.bb-timeline ul li{margin-bottom:3rem;list-style-type:none}.bb-timeline ul li .bb-cont ul li{margin-bottom:0}
    .bb-timeline .bb-item,.bb-load button{border:1px solid var(--border,#dcdcdc);border-radius:8px;box-shadow:3px 3px 5px var(--shadow,rgba(0,0,0,.1))}
    .bb-timeline .bb-item{padding:.6rem 1rem .6rem;font-size:16px;background:var(--surface,transparent)}
    .bb-timeline .bb-info{position:relative;margin-top:.5rem;font-size:14px}.bb-timeline .bb-info a{text-decoration:none}.bb-timeline .datatime{font-size:15px}
    .bb-timeline .bb-cont{overflow-x:hidden;margin-top:.5rem}.bb-timeline .bb-cont img[src*=emotion]{display:inline-block;width:auto}
    .bb-timeline p{margin:0;min-height:18px;color:var(--text,#3b3d42);letter-spacing:1px;line-height:28px}.bb-timeline pre{color:#aaa}.bb-timeline pre p{display:inline-block}.bb-timeline pre p:empty{display:none}
    .bb-cont blockquote{position:relative;margin:0 0 0 1rem;padding:.25rem 2rem;border-left:0 none}.bb-cont blockquote::before{position:absolute;top:5px;left:10px;content:'“';font-weight:700;font-size:28px;line-height:2rem}
    .tag-span{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;box-sizing:border-box;border:1px solid color-mix(in srgb,var(--accent,#42b983) 40%,transparent);border-radius:9999px;background:transparent;color:var(--accent,#42b983);font-size:13px;font-weight:normal;margin-right:4px;transition:all .2s ease}
    .tag-span.tag-filter{cursor:pointer;text-decoration:none}.tag-span.tag-filter:hover{background:var(--accent-soft,rgba(66,185,131,.1));border-color:var(--accent,#42b983);color:var(--accent-hover,#42b983)}
    .bb-timeline .bb-cont ul{list-style-type:disc;margin:1em 0;padding-left:2em}.bb-timeline .bb-cont ol{list-style-type:decimal;margin:1em 0;padding-left:2em}.bb-timeline .bb-cont ul li,.bb-timeline .bb-cont ol li{list-style-type:inherit;margin-bottom:.5em}
    .emoji-reaction-bar{margin-bottom:.5em;display:flex;align-items:center;gap:8px}
    .bb-load{text-align:center;margin:2em 0 1em}.bb-load button{padding:8px 24px;border-radius:9999px;background:var(--surface-soft,transparent);color:var(--accent-hover,#42b983);font-size:1em;cursor:pointer;transition:all .2s ease}
    .bb-load button:hover{background:var(--accent,#42b983);border-color:var(--accent,#42b983);color:var(--accent-contrast,#fff);transform:translateY(-1px)}
    .bb-cont img{max-width:100%;max-height:320px;height:auto;width:auto;display:block;margin:.5em 0;object-fit:contain}
    .bb-cont:has(.bb-image-trigger){overflow:visible}.bb-image-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;margin:0;padding:0;border:0;background:transparent;color:var(--accent,#42b983);font:inherit;line-height:1;vertical-align:-.12em;cursor:zoom-in;isolation:isolate;opacity:.82;transition:color .18s ease,opacity .18s ease,transform .18s ease}
    .bb-image-trigger svg{display:block;width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.bb-image-trigger:hover,.bb-image-trigger:focus-visible{color:var(--accent-hover,var(--accent,#42b983));opacity:1;transform:translateY(-1px)}.bb-image-trigger:focus-visible{outline:1px solid currentColor;outline-offset:2px;border-radius:2px}
    .bb-image-count{position:absolute;left:.68em;top:-.52em;display:inline-flex;align-items:center;justify-content:center;min-width:1.25em;height:1.25em;padding:0 .22em;box-sizing:border-box;border:1px solid var(--surface,#fff);border-radius:999px;background:var(--accent,#42b983);color:var(--accent-contrast,#fff);font:600 .52em/1 system-ui,sans-serif;letter-spacing:-.02em;box-shadow:0 1px 3px rgba(0,0,0,.14);pointer-events:none}
    .bb-image-preview{position:absolute;left:0;bottom:calc(100% + 10px);z-index:30;width:min(320px,calc(100vw - 48px));padding:5px;border:1px solid var(--border,#dfe3e6);border-radius:10px;background:var(--surface,#fff);box-shadow:0 12px 32px rgba(0,0,0,.2);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(5px) scale(.985);transform-origin:left bottom;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}
    .bb-image-preview img{display:block;width:100%;height:auto;max-width:none;max-height:360px;margin:0;border-radius:6px;background:var(--surface-soft,var(--surface,#fff));object-fit:contain}
    @media (hover:hover) and (pointer:fine){.bb-image-trigger:hover .bb-image-preview,.bb-image-trigger:focus-visible .bb-image-preview{opacity:1;visibility:visible;transform:translateY(0) scale(1);transition-delay:.16s,.16s,0s}}
    @media (hover:none),(pointer:coarse){.bb-image-preview{display:none}}
    .bb-focus-empty{text-align:center;color:var(--muted,#777);padding:3rem 1rem}.bb-focus-loader{position:relative;width:56px;height:56px;margin:3rem auto;border:3px solid var(--accent-soft,rgba(66,185,131,.2));border-top-color:var(--accent,#42b983);border-radius:50%;animation:bb-focus-spin .8s linear infinite}@keyframes bb-focus-spin{to{transform:rotate(360deg)}}
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const state = {
    mode: 'recent',
    all: [],
    recent: [],
    dataPromise: null,
    recentVisible: config.pageSize,
    randomVisibleItems: [],
    requestId: 0
  };

  // 同一浏览器标签页刷新时仍停留在上次选择的页签；重新抽取随机条目。
  const selectedTabKey = 'bb-focus-selected-tab';

  function rememberedTab() {
    try {
      return window.sessionStorage.getItem(selectedTabKey) === 'random' ? 'random' : 'recent';
    } catch (_) {
      return 'recent';
    }
  }

  function rememberTab(mode) {
    try {
      window.sessionStorage.setItem(selectedTabKey, mode);
    } catch (_) {
      // 隐私模式或禁用存储时，页签切换仍可正常使用。
    }
  }

  // 全站只请求同一份完整 memos.json；不使用预生成的随机分组文件。
  async function ensureData() {
    if (!state.dataPromise) {
      state.dataPromise = (async () => {
        const response = await fetch(config.dataUrl, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`${config.dataUrl} ${response.status}`);
        const payload = await response.json();
        const all = extractItems(payload).filter(item => item && item.content && item.createdTs);
        all.sort((a, b) => Number(b.createdTs) - Number(a.createdTs));
        state.all = all;
        state.recent = all.slice(0, config.recentLimit);
      })().catch(error => {
        state.dataPromise = null; // 加载失败后，允许再次点击页签重试。
        throw error;
      });
    }
    return state.dataPromise;
  }

  // Older Memos attachments were stored by resource id instead of R2 externalLink.
  const legacyResourceCutoff = Date.parse('2024-08-03T00:00:00+08:00') / 1000;
  const legacyResourceBase = 'https://memos.hux.ink/o/r/';

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function extractItems(payload) {
    if (Array.isArray(payload)) return payload;
    return payload && Array.isArray(payload.items) ? payload.items : [];
  }

  function secureRandom() {
    if (window.crypto && window.crypto.getRandomValues) {
      const value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      return value[0] / 4294967296;
    }
    return Math.random();
  }

  function shuffle(items) {
    const output = items.slice();
    for (let index = output.length - 1; index > 0; index -= 1) {
      const target = Math.floor(secureRandom() * (index + 1));
      [output[index], output[target]] = [output[target], output[index]];
    }
    return output;
  }

  function imageUrls(item) {
    if (!item || !Array.isArray(item.resourceList)) return [];
    return item.resourceList.map(resource => {
      const timestamp = Number(item.createdTs);
      const isLegacy = Number.isFinite(timestamp) && timestamp < legacyResourceCutoff;
      const url = isLegacy && resource && resource.id != null
        ? legacyResourceBase + encodeURIComponent(resource.id)
        : resource && (resource.externalLink || resource.publicUrl || resource.filename || '');
      const type = String(resource && resource.type || '').toLowerCase();
      return url && (type.startsWith('image') || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) ? url : '';
    }).filter(Boolean);
  }

  function imageButton(item) {
    const images = imageUrls(item);
    if (!images.length) return '';
    const first = escapeAttr(images[0]);
    const count = images.length > 1 ? `<span class="bb-image-count">+${images.length - 1}</span>` : '';
    return `<button class="attach-btn bb-image-trigger" type="button" data-memo-id="${escapeAttr(item.id)}" aria-label="查看${images.length}张图片"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 17 4.5-4.5 3.5 3 2.5-2.5 5.5 5"></path></svg>${count}<span class="bb-image-preview" aria-hidden="true"><img class="bb-image-preview-image" src="${first}" alt="" loading="lazy" decoding="async"></span></button>`;
  }

  function appendImageButton(content, button) {
    if (!button) return content;
    const lastParagraph = content.lastIndexOf('</p>');
    if (lastParagraph < 0) return content + '&nbsp;&nbsp;' + button;
    return content.slice(0, lastParagraph) + '&nbsp;&nbsp;' + button + content.slice(lastParagraph);
  }

  function memoHtml(item) {
    if (!item || !item.content || !item.createdTs) return '';
    const date = new Date(Number(item.createdTs) * 1000);
    const dateText = date.toLocaleString();
    const plain = String(item.content).replace(/#[^\s#]+/g, '').trim();
    let content = window.marked ? window.marked.parse(plain.replace(/\n/g, '  \n')) : escapeAttr(plain).replace(/\n/g, '<br>');
    content = appendImageButton(content, imageButton(item));
    const tags = (item.tags || []).map(tag => `<span class="tag-span tag-filter">#${escapeAttr(tag)}</span>`).join(' ');
    return `<li><article class="bb-item"><div class="bb-cont">${content}</div><div class="bb-info" style="position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:8px"><span class="emoji-reaction-bar" style="display:inline-flex;vertical-align:middle"><emoji-reaction theme="system" endpoint="https://emaction-api.hux.ink" reacttargetid="memo-${escapeAttr(item.id)}" style="line-height:normal;display:inline-flex"></emoji-reaction></span><span class="datatime" title="${escapeAttr(dateText)}">${escapeAttr(dateText)}</span>${tags}</div></article></li>`;
  }

  // 每次均从全库独立洗牌，取前 12 条；不会先限定最近 60 条或任何批次。
  function chooseRandomMemos() {
    return shuffle(state.all).slice(0, config.randomBatchSize);
  }

  function setTabs() {
    document.querySelectorAll('[data-bibi-mode]').forEach(button => {
      const selected = button.dataset.bibiMode === state.mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }

  function attachImageEvents(renderedItems) {
    const lookup = new Map(renderedItems.map(item => [String(item.id), item]));
    document.querySelectorAll('.bb-image-trigger').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const item = lookup.get(button.dataset.memoId);
        const images = imageUrls(item);
        if (!images.length) return;
        document.querySelectorAll('.bb-focus-image-source').forEach(node => node.remove());
        const source = document.createElement('div');
        source.className = 'bb-focus-image-source';
        source.style.display = 'none';
        images.forEach(url => {
          const image = document.createElement('img');
          image.src = url;
          image.setAttribute('data-view-image', '');
          source.appendChild(image);
        });
        document.body.appendChild(source);
        if (window.ViewImage) {
          window.ViewImage.init('.bb-focus-image-source img');
          window.setTimeout(() => source.querySelector('img')?.click(), 50);
          window.setTimeout(() => source.remove(), 15000);
        } else {
          window.open(images[0], '_blank', 'noopener');
          source.remove();
        }
      });
    });
  }

  function render(items, buttonLabel) {
    const root = document.querySelector(config.domId);
    if (!root) return;
    const cards = items.map(memoHtml).join('');
    root.innerHTML = cards
      ? `<section class="bb-timeline"><ul>${cards}</ul></section><div class="bb-load"><button id="bb-focus-more" type="button">${buttonLabel}</button></div>`
      : '<p class="bb-focus-empty">暂时没有可展示的哔哔。</p>';
    attachImageEvents(items);
    if (window.Lately) window.Lately.init({ target: '.datatime' });
    if (window.emactionInit) window.emactionInit();
    document.getElementById('bb-focus-more')?.addEventListener('click', loadMore);
  }

  function renderMode() {
    setTabs();
    if (state.mode === 'recent') {
      const maximum = state.recent.length;
      const visible = Math.min(state.recentVisible, maximum);
      render(state.recent.slice(0, visible), visible >= maximum ? '碰个运气' : '哔个不停');
      return;
    }
    render(state.randomVisibleItems, '好运不停');
  }

  function refreshRandomMemos(scrollToTabs = false) {
    if (state.mode !== 'random') return;
    state.randomVisibleItems = chooseRandomMemos();
    render(state.randomVisibleItems, '好运不停');
    if (scrollToTabs) {
      document.querySelector('.bibi-switch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function loadMore() {
    if (state.mode === 'recent') {
      const maximum = state.recent.length;
      if (state.recentVisible < maximum) {
        state.recentVisible = Math.min(state.recentVisible + config.pageSize, maximum);
        renderMode();
      } else {
        switchMode('random', true);
      }
      return;
    }
    refreshRandomMemos(true);
  }

  async function switchMode(mode, scrollToTabs = false) {
    const requestId = ++state.requestId;
    state.mode = mode === 'random' ? 'random' : 'recent';
    rememberTab(state.mode);
    setTabs();
    const root = document.querySelector(config.domId);
    if (root) root.innerHTML = '<div class="bb-focus-loader" role="status" aria-label="正在加载"></div>';
    try {
      await ensureData();
      if (requestId !== state.requestId) return;
      if (state.mode === 'random') {
        refreshRandomMemos(Boolean(scrollToTabs));
      } else {
        renderMode();
        if (scrollToTabs) {
          document.querySelector('.bibi-switch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.error(error);
      if (root) root.innerHTML = '<p class="bb-focus-empty">哔哔加载失败，请检查 memos.json 是否可访问。</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-bibi-mode]').forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.bibiMode;
        if (mode === 'random' && state.mode === 'random' && state.dataPromise && state.all.length) {
          refreshRandomMemos(true);
          return;
        }
        switchMode(mode);
      });
    });
    switchMode(rememberedTab());
  });
})();
