/**
 * 这块 Service Worker 只剩一件事：把自己注销掉。
 *
 * 写作页从 /write/ 搬到了 /update/，但已经装到主屏的 App 还挂在这个 scope 上。
 * 只要它还被浏览器调起来，就会把缓存里的旧壳喂给用户，所以这里什么都不缓存，
 * 清掉旧缓存、注销自己，然后把还开着的页面转到新地址。
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('hux-write')).map((key) => caches.delete(key)));
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url.replace('/write/', '/update/')));
      await self.registration.unregister();
    })()
  );
});
