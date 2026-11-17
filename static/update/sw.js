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
const CACHE = 'hux-update-v10';
const SHELL = ['/update/', '/update/manifest.webmanifest', '/update/icon.svg', '/update/icon-180.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
  }
});
