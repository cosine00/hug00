/**
 * 撰写页的 Service Worker。
 *
 * 只做两件事：
 *   1. 壳缓存 —— 弱网（地铁、电梯里）打开也能立刻看到界面，草稿本来就在本地；
 *   2. 图标与静态资源走缓存优先。
 *
 * 页面本身用「网络优先、失败回缓存」，避免改了前端却一直吃旧壳。
 * 注意 iOS 没有 Background Sync，发布失败只能靠前台重试 —— 页面里没做队列，
 * 因为草稿永远在 localStorage，重新点一次发布就够了。
 */
const CACHE = 'hux-update-v13';
const SHELL = ['/update/', '/update/manifest.webmanifest', '/update/icon.svg', '/update/icon-180.png'];

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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isShell = url.pathname === '/update/' || url.pathname === '/update/index.html';
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/update/', copy));
          return response;
        })
        .catch(() => caches.match('/update/'))
    );
    return;
  }

  if (url.pathname.startsWith('/update/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
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
