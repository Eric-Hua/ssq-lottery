/* 双色球选号助手 — Service Worker
 * 策略:
 *   - 页面导航(HTML): 网络优先,离线时回退缓存(有新版本立即生效)
 *   - 其它同源资源: 缓存优先 + 后台更新(stale-while-revalidate)
 * 更新内容后建议把 CACHE 版本号 +1,以清理旧缓存。
 */
const CACHE = "ssq-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./data.js",
  "./backtest.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 页面导航 + 开奖数据:网络优先(保证更新后立即生效,离线时回退缓存)
  const isData = url.pathname.endsWith("/data.js");
  if (req.mode === "navigate" || isData) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(req, copy))
            .catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("./index.html")),
        ),
    );
    return;
  }

  // 静态资源:缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
