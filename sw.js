/* 文渊刷题 · Service Worker
   目标：题库数据与已看过的图离线可用；页面走「网络优先，断网回缓存」。 */
const VERSION = "wy-v7";
const SHELL = VERSION + "-shell";
const DATA = VERSION + "-data";
const IMG = VERSION + "-img";

const PRECACHE = [
  "index.html",
  "practice.html",
  "wrong.html",
  "kp.html",
  "kplist.html",
  "style.css",
  "common.js",
  "practice.js",
  "export.js",
  "data/index.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function put(cacheName, req, res) {
  if (!res || !res.ok || res.type === "opaque") return res;
  const copy = res.clone();
  caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const p = url.pathname;

  /* 页面：网络优先，断网回缓存 */
  if (req.mode === "navigate" || /\.html$/.test(p)) {
    e.respondWith(
      fetch(req)
        .then((res) => put(SHELL, req, res))
        .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
    );
    return;
  }

  /* 图片：缓存优先（很少变） */
  if (/\/images\//.test(p)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => put(IMG, req, res)))
    );
    return;
  }

  /* 数据：网络优先（重建题库后能立刻看到新数据），断网回缓存 */
  if (/\/data\//.test(p)) {
    e.respondWith(
      fetch(req)
        .then((res) => put(DATA, req, res))
        .catch(() => caches.match(req))
    );
    return;
  }

  /* 静态资源：缓存优先 + 后台更新 */
  if (/\.(js|css|webmanifest)$/.test(p)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => put(DATA, req, res));
        return hit || net;
      })
    );
  }
});
