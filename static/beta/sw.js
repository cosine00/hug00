/**
 * 撰写页的 Service Worker。
 *
 * 只做两件事：
 *   1. 壳缓存 —— 从主屏冷启动时先甩出上一次的壳，不再干等一个网络往返；
 *   2. 静态资源缓存优先，后台悄悄换新。
 *
 * 壳走「网络最多等 500ms，回不来就先给缓存」：网好的时候照样拿到当天的新版，
 * 网差或刚被系统杀掉进程时立刻有画面。缓存永远在后台更新，不会一直停在旧版。
 * 注意 iOS 没有 Background Sync，发布失败只能靠前台重试 —— 页面里没做队列，
 * 因为草稿永远在 localStorage，重新点一次发布就够了。
 */
const CACHE = 'hux-beta-v2';
const SHELL = ['/beta/', '/beta/manifest.webmanifest', '/beta/icon.svg', '/beta/icon-180.png'];
const SHELL_WAIT = 500;

// 预览借用博客自己的样式表，顺手存一份：断网也能看到真正的排版。
// 版本号跟着 layouts/partials/header.html 走，改了主题记得一起换。
const BLOG_CSS = [
  '/css/style.css?v=20261111-01',
  '/css/fonts.css',
  '/css/palettes.css?v=20260924-2',
  '/css/custom.css?v=20261111-1'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 单个文件失败不能连累整个安装，CSS 少一份只是预览掉点样式
      .then((cache) => Promise.allSettled(SHELL.concat(BLOG_CSS).map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.indexOf('hux-') === 0).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

/** 取一次网络，成功就顺手写进缓存；失败返回 null，不往外抛。 */
function refresh(request, key) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(key || request, copy));
      }
      return response;
    })
    .catch(() => null);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isShell = url.pathname === '/beta/' || url.pathname === '/beta/index.html';
  if (isShell) {
    const network = refresh(request, '/beta/');
    // 后台那次无论成不成都要跑完，不然冷启动刚出的壳会是旧的
    event.waitUntil(network.then(() => {}));
    event.respondWith(
      (async () => {
        const cached = await caches.match('/beta/');
        if (!cached) return (await network) || Response.error();
        // 有壳就先给壳，但最多等网络 SHELL_WAIT 毫秒：网好时仍然拿到新版
        return Promise.race([
          network.then((response) => response || cached),
          new Promise((resolve) => setTimeout(() => resolve(cached), SHELL_WAIT))
        ]);
      })()
    );
    return;
  }

  // sw.js 交给浏览器自己管，别用缓存把它钉住
  if (url.pathname === '/beta/sw.js') return;

  // 图标、清单、按天切好的小 JSON：缓存先给，后台换新
  if (url.pathname.startsWith('/beta/') || url.pathname.startsWith('/bb-ondate/')) {
    const network = refresh(request);
    event.waitUntil(network.then(() => {}));
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return network.then((response) => response || Response.error());
      })
    );
    return;
  }

  // 博客样式表与工作台数据：先问网络（主题改了要能立刻看到），断网才回缓存
  const isShared = url.pathname.startsWith('/css/') || url.pathname === '/desk-index.json';
  if (isShared) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
  }
});
