(function () {
  'use strict';

  function initFriendCircle() {
    const root = document.getElementById('friend-circle-lite-root');
    if (!root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';
    root.innerHTML = `
      <div class="articles-container" id="articles-container"></div>
      <button id="load-more-btn" type="button">显示更多</button>
      <div id="stats-container"></div>`;

    const config = window.UserConfig || {};
    const dataUrl = config.data_url || '/rss.json';
    const pageSize = Number(config.page_turning_number) || 20;
    const fallbackAvatar = config.error_img || '/favi.ico';
    const container = root.querySelector('#articles-container');
    const loadMoreButton = root.querySelector('#load-more-btn');
    const statsContainer = root.querySelector('#stats-container');
    let articles = [];
    let offset = 0;

    function safeExternalUrl(value, fallback) {
      try {
        const url = new URL(value, window.location.origin);
        return /^https?:$/.test(url.protocol) ? url.href : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function setAvatar(image, source) {
      image.src = safeExternalUrl(source, fallbackAvatar);
      image.onerror = function () {
        image.onerror = null;
        image.src = fallbackAvatar;
      };
    }

    function openAuthorModal(selected) {
      let modal = document.getElementById('friend-circle-author-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'friend-circle-author-modal';
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content"><img id="modal-author-avatar" alt=""><a id="modal-author-name-link" target="_blank" rel="noopener"></a><div id="modal-articles-container"></div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', function (event) {
          if (event.target === modal) closeAuthorModal(modal);
        });
      }

      const avatar = modal.querySelector('#modal-author-avatar');
      const authorLink = modal.querySelector('#modal-author-name-link');
      const articleList = modal.querySelector('#modal-articles-container');
      setAvatar(avatar, selected.avatar);
      authorLink.textContent = selected.author || '未知博客';
      authorLink.href = safeExternalUrl(selected.site_url || selected.link, '#');
      articleList.innerHTML = '';
      articles.filter(item => item.author === selected.author).slice(0, 5).forEach(function (item) {
        const row = document.createElement('div');
        row.className = 'modal-article';
        const link = document.createElement('a');
        link.className = 'modal-article-title';
        link.href = safeExternalUrl(item.link, '#');
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = item.title || '未命名文章';
        const date = document.createElement('div');
        date.className = 'modal-article-date';
        date.textContent = `📅 ${(item.created || '').slice(0, 10)}`;
        row.append(link, date);
        articleList.appendChild(row);
      });
      modal.style.display = 'block';
      requestAnimationFrame(() => modal.classList.add('modal-open'));
    }

    function closeAuthorModal(modal) {
      modal.classList.remove('modal-open');
      window.setTimeout(() => { modal.style.display = 'none'; }, 300);
    }

    function createCard(article) {
      const card = document.createElement('article');
      card.className = 'card';
      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = article.title || '未命名文章';
      title.addEventListener('click', () => window.open(safeExternalUrl(article.link, '#'), '_blank', 'noopener'));
      const author = document.createElement('div');
      author.className = 'card-author';
      const avatar = document.createElement('img');
      avatar.className = 'no-lightbox';
      avatar.alt = '';
      setAvatar(avatar, article.avatar);
      author.append(avatar, document.createTextNode(article.author || '未知博客'));
      author.addEventListener('click', () => openAuthorModal(article));
      const date = document.createElement('div');
      date.className = 'card-date';
      date.textContent = (article.updated || article.created || '').slice(0, 10);
      const sequence = document.createElement('span');
      sequence.className = 'card-sequence';
      sequence.setAttribute('aria-hidden', 'true');
      sequence.textContent = String(article.floor || '');
      card.append(title, author, date, sequence);
      return card;
    }

    function renderNextPage() {
      articles.slice(offset, offset + pageSize).forEach(article => container.appendChild(createCard(article)));
      offset += pageSize;
      loadMoreButton.style.display = offset >= articles.length ? 'none' : '';
    }

    function processData(data) {
      articles = Array.isArray(data.article_data) ? data.article_data : [];
      const stats = data.statistical_data || {};
      statsContainer.innerHTML = `<div>订阅：${Number(stats.friends_num) || 0}　活跃：${Number(stats.active_num) || 0}　总文章数：${Number(stats.article_num) || articles.length}<br></div><div>更新时间：${String(stats.last_updated_time || '未知')}</div>`;
      if (!articles.length) {
        container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:36px 12px;opacity:.7;">暂时没有可展示的订阅文章</div>';
        loadMoreButton.style.display = 'none';
        return;
      }
      renderNextPage();
    }

    const cacheKey = `friend-circle-local:${dataUrl}`;
    const cacheTimeKey = `${cacheKey}:time`;
    const cachedAt = Number(localStorage.getItem(cacheTimeKey) || 0);
    const cached = localStorage.getItem(cacheKey);
    if (cached && Date.now() - cachedAt < 10 * 60 * 1000) {
      try { processData(JSON.parse(cached)); } catch (_) { localStorage.removeItem(cacheKey); }
    }

    if (!articles.length) {
      fetch(dataUrl, { cache: 'no-cache' })
        .then(response => {
          if (!response.ok) throw new Error(`RSS JSON ${response.status}`);
          return response.json();
        })
        .then(data => {
          localStorage.setItem(cacheKey, JSON.stringify(data));
          localStorage.setItem(cacheTimeKey, String(Date.now()));
          processData(data);
        })
        .catch(() => {
          container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:36px 12px;opacity:.7;">订阅近况暂时加载失败</div>';
          loadMoreButton.style.display = 'none';
        });
    }
    loadMoreButton.addEventListener('click', renderNextPage);
  }

  document.addEventListener('DOMContentLoaded', initFriendCircle);
  document.addEventListener('pjax:complete', initFriendCircle);
  if (document.readyState !== 'loading') initFriendCircle();
})();
