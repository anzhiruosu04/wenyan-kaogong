/* 文渊刷题 · 公共工具 */
const $ = (s, r = document) => r.querySelector(s);
const DATA = "data/";
const _cache = new Map();

async function loadJSON(path) {
  if (_cache.has(path)) return _cache.get(path);
  const res = await fetch(path);
  if (!res.ok) throw new Error("加载失败 " + path + " (" + res.status + ")");
  const json = await res.json();
  _cache.set(path, json);
  return json;
}

const store = {
  get(k, def) {
    try {
      const v = localStorage.getItem("wy:" + k);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem("wy:" + k, JSON.stringify(v)); } catch (e) {}
  }
};

/* ---------------- 答题记录（localStorage） ---------------- */
/* 每题一条：[是否答对 1/0, 分类 id, 题目标题, 时间戳, 累计答错次数] */
const prog = {
  _d: null,
  _dirty: false,
  all() {
    if (!this._d) this._d = store.get("prog", {}) || {};
    return this._d;
  },
  get(qid) { return this.all()[qid] || null; },
  mark(qid, ok, cid, title, yr, rg, picked) {
    const d = this.all();
    const old = d[qid];
    const wc = (old ? old[4] || 0 : 0) + (ok ? 0 : 1);
    d[qid] = [ok ? 1 : 0, cid, (title || (old ? old[2] : "")) || "", Date.now(), wc, yr || "", rg || "", picked || ""];
    this._dirty = true;
    this.flush();
    return d[qid];
  },
  flush() {
    if (!this._dirty) return;
    try { store.set("prog", this._d); this._dirty = false; } catch (e) {}
  },
  /* 按分类汇总；同时给出全局已做 / 答对 */
  stats() {
    const d = this.all();
    const byCat = {};
    let done = 0, right = 0;
    for (const qid in d) {
      const r = d[qid];
      const c = r[1] || "?";
      if (!byCat[c]) byCat[c] = { done: 0, right: 0 };
      byCat[c].done++;
      done++;
      if (r[0]) { byCat[c].right++; right++; }
    }
    return { byCat: byCat, done: done, right: right };
  },
  /* 错题：答错且之后没做对的，按错得多的在前 */
  wrong() {
    const d = this.all();
    const list = [];
    for (const qid in d) {
      const r = d[qid];
      if (r[0]) continue;
      list.push({ qid: qid, cid: r[1], title: r[2], ts: r[3], wc: r[4] || 0, yr: r[5], rg: r[6], picked: r[7] || "" });
    }
    list.sort(function (a, b) { return (b.wc - a.wc) || (b.ts - a.ts); });
    return list;
  },
  clear() {
    this._d = {};
    this._dirty = true;
    this.flush();
  }
};

/* 找到某个分类 */
function findCat(index, cid) {
  for (const m of index.modules) {
    for (const c of m.cats) {
      if (c.id === cid) return { module: m.name, cat: c };
    }
  }
  return null;
}

/* 全局题序 -> 分片下标 */
function chunkOf(cat, i) {
  for (let n = 0; n < cat.chunks.length; n++) {
    const c = cat.chunks[n];
    if (i >= c.start && i < c.start + c.count) return n;
  }
  return cat.chunks.length - 1;
}

/* 按需加载分片 */
const _chunks = new Map();
async function loadChunk(cat, n) {
  const key = cat.id + ":" + n;
  if (_chunks.has(key)) return _chunks.get(key);
  const p = loadJSON(DATA + cat.chunks[n].f).then((d) => d.q);
  _chunks.set(key, p);
  return p;
}

async function getQuestion(cat, i) {
  const n = chunkOf(cat, i);
  const arr = await loadChunk(cat, n);
  return arr[i - cat.chunks[n].start];
}

/* 预取下一片，切题时无感 */
function prefetch(cat, i) {
  const n = chunkOf(cat, i);
  if (n + 1 < cat.chunks.length) loadChunk(cat, n + 1);
}

/* 图片懒加载 */
function fixImg(html) {
  if (!html) return "";
  return html.replace(/<img\b/gi, '<img loading="lazy" decoding="async"');
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 离线缓存：http(s) 下注册 Service Worker，file:// 跳过 */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}


/* 按 qid 跨分类取完整题目（导出用） */
let _qmapCache = null;
async function getQmap() {
  if (!_qmapCache) _qmapCache = await loadJSON(DATA + "qmap.json");
  return _qmapCache;
}

async function fetchQuestion(qid) {
  const map = await getQmap();
  const loc = map[qid];
  if (!loc) return null;
  const index = await loadJSON(DATA + "index.json");
  const found = findCat(index, loc[0]);
  if (!found) return null;
  const cat = found.cat;
  const chunk = cat.chunks[loc[1]];
  const arr = (await loadJSON(DATA + chunk.f)).q;
  const q = arr[loc[2]];
  if (!q) return null;
  let material = "";
  if (q.material && cat.meta) {
    const meta = await loadJSON(DATA + cat.meta);
    material = (meta.materials || {})[q.material] || "";
  }
  return Object.assign({}, q, { _cat: cat.name, _material: material });
}
