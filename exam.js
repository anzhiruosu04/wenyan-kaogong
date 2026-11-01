/* 文渊刷题 · 整卷模考 */
(function () {
  const P = new URLSearchParams(location.search);
  const stage = document.getElementById("stage");
  const mtitle = document.getElementById("mtitle");
  const msub = document.getElementById("msub");

  let INDEX = null, PAPERS = [];
  const CATMAP = new Map();      // cid -> cat
  const METAMAP = new Map();     // cid -> Promise<meta>
  const QMAP = new Map();        // "cid:gi" -> Promise<q>

  let st = null;                 // 当前模考：{pid,name,items,answers,pos,endAt,dur,qids,submitted}
  let tickId = null;

  /* ---------------- 启动 ---------------- */
  (async function init() {
    INDEX = await loadJSON(DATA + "index.json");
    PAPERS = (await loadJSON(DATA + "papers.json")).papers;

    const pid = P.get("p");
    const saved = store.get("exam", null);

    if (pid) {
      const p = PAPERS.find((x) => x.id === pid);
      if (!p) return fail("找不到这份试卷");
      if (saved && !saved.submitted && saved.pid === pid) { resume(saved); return; }
      return startPanel(p);
    }
    renderList("");
  })().catch(function (e) {
    fail("加载失败：" + ((e && e.message) || e));
    if (window.console) console.error(e);
  });

  function fail(msg) { stage.innerHTML = '<div class="loading">' + esc(msg) + "</div>"; }

  function catOf(cid) {
    if (!CATMAP.has(cid)) {
      const f = findCat(INDEX, cid);
      if (f) CATMAP.set(cid, f.cat);
    }
    return CATMAP.get(cid);
  }

  function metaOf(cid) {
    if (!METAMAP.has(cid)) METAMAP.set(cid, loadJSON(DATA + catOf(cid).meta));
    return METAMAP.get(cid);
  }

  function questionOf(cid, gi) {
    const k = cid + ":" + gi;
    if (!QMAP.has(k)) QMAP.set(k, getQuestion(catOf(cid), gi));
    return QMAP.get(k);
  }

  function fmtClock(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ":" : "") + (m < 10 && h ? "0" : "") + m + ":" + (ss < 10 ? "0" : "") + ss;
  }

  function fmtDur(ms) {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h) return h + " 小时 " + m + " 分";
    if (m) return m + " 分 " + ss + " 秒";
    return ss + " 秒";
  }

  function defaultMin(n) { return n >= 100 ? 120 : (n >= 60 ? 90 : 50); }

  /* ---------------- 列表 ---------------- */
  function renderList(kw) {
    mtitle.textContent = "模考";
    msub.textContent = "按整卷计时做，交卷后再看分数与解析";

    const saved = store.get("exam", null);
    const resumeBar = (saved && !saved.submitted)
      ? '<div class="resbar"><div><b>上次没做完</b><span>' + esc(saved.name) +
        " · 已答 " + Object.keys(saved.answers || {}).length + "/" + saved.items.length +
        "</span></div><button class=\"btn solid\" id=\"resume\">继续</button></div>"
      : "";

    const list = PAPERS.filter(function (p) {
      if (!kw) return true;
      return (p.name || "").indexOf(kw) >= 0 ||
        (p.years || []).join(" ").indexOf(kw) >= 0 ||
        (p.regions || []).join(" ").indexOf(kw) >= 0;
    });

    const rows = list.slice(0, 120).map(function (p) {
      const meta = [p.years.join("/"), p.regions.join("/"), p.count + " 题",
        p.cats.length + " 个部分"].filter(Boolean).join(" · ");
      return '<a class="prow" href="exam.html?p=' + p.id + '">' +
        '<span class="pn">' + esc(p.name) + "</span>" +
        '<span class="pm">' + esc(meta) + "</span></a>";
    }).join("");

    stage.innerHTML =
      resumeBar +
      '<div class="searchbar"><input id="kw" type="search" placeholder="搜试卷名、年份或地区，例如「2021 国考」" value="' + esc(kw || "") + '"></div>' +
      '<div class="pcount">共 ' + list.length + " 套可做（题量 ≥ 5）" + (list.length > 120 ? "，显示前 120 套" : "") + "</div>" +
      '<div class="plist">' + (rows || '<div class="empty">没找到这份试卷</div>') + "</div>";

    const inp = document.getElementById("kw");
    let t = null;
    inp.addEventListener("input", function () {
      clearTimeout(t);
      const v = inp.value.trim();
      t = setTimeout(function () { renderList(v); const i = document.getElementById("kw"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 200);
    });

    const rb = document.getElementById("resume");
    if (rb) rb.addEventListener("click", function () { resume(saved); });
  }

  /* ---------------- 开始前 ---------------- */
  function startPanel(p) {
    mtitle.textContent = "模考";
    msub.textContent = "选一个时长，时间到会自动交卷";
    const d = defaultMin(p.count);
    const parts = p.cats.map(function (c) {
      const cat = catOf(c.cid);
      return (cat ? cat.name : c.cid) + " " + c.n;
    }).join(" · ");

    stage.innerHTML =
      '<div class="panel">' +
        '<div class="pname">' + esc(p.name) + "</div>" +
        '<div class="pinfo">' + esc([p.years.join("/"), p.regions.join("/")].filter(Boolean).join(" · ")) + "</div>" +
        '<div class="pinfo">共 ' + p.count + " 题 · " + p.cats.length + " 个部分</div>" +
        '<div class="pparts">' + esc(parts) + "</div>" +
        '<div class="pacts">' +
          '<button class="btn solid" data-min="' + d + '">开始 · ' + d + " 分钟</button>" +
          '<button class="btn" data-min="' + Math.round(d * 1.5) + '">宽松 · ' + Math.round(d * 1.5) + " 分钟</button>" +
          '<button class="btn" data-min="0">不计时</button>' +
        "</div>" +
        '<a class="backlink" href="exam.html">← 换一套</a>' +
      "</div>";

    stage.querySelectorAll("[data-min]").forEach(function (b) {
      b.addEventListener("click", function () { begin(p, parseInt(b.dataset.min, 10)); });
    });
  }

  function begin(p, min) {
    st = {
      pid: p.id, name: p.name, items: p.items, answers: {}, pos: 0,
      dur: min, endAt: min ? Date.now() + min * 60000 : 0,
      startedAt: Date.now(), qids: {}, submitted: false
    };
    save();
    run();
  }

  function resume(s) {
    st = s;
    st.qids = st.qids || {};
    st.answers = st.answers || {};
    run();
  }

  function save() { if (st) store.set("exam", st); }

  /* ---------------- 作答 ---------------- */
  function run() {
    mtitle.textContent = "模考";
    msub.textContent = st.name;
    renderQ();
    if (tickId) clearInterval(tickId);
    tickId = setInterval(function () {
      const c = document.getElementById("clock");
      if (!c) return;
      if (!st.dur) { c.textContent = "不限时"; return; }
      const left = st.endAt - Date.now();
      c.textContent = "剩余 " + fmtClock(left);
      c.classList.toggle("urgent", left < 5 * 60000);
      if (left <= 0) { clearInterval(tickId); submitExam(true); }
    }, 1000);
  }

  async function renderQ() {
    const item = st.items[st.pos];
    const cid = item[0], gi = item[1];
    const cat = catOf(cid);
    if (!cat) return fail("分类数据缺失 " + cid);
    let q, meta;
    try {
      q = await questionOf(cid, gi);
      meta = await metaOf(cid);
    } catch (e) { return fail("题目加载失败：" + e.message); }
    st.qids[st.pos] = q.qid;

    const sel = st.answers[st.pos] || null;
    const matHtml = q.material && meta.materials[q.material]
      ? '<div class="material">' + fixImg(meta.materials[q.material]) + "</div>" : "";

    const opts = q.options.map(function (o, i) {
      const k = o.k || String.fromCharCode(65 + i);
      const cls = "opt" + (k === sel ? " sel" : "");
      return '<li class="' + cls + '" data-k="' + esc(k) + '">' +
        '<span class="k">' + esc(k) + "</span>" +
        '<span class="v">' + fixImg(o.v || "") + "</span></li>";
    }).join("");

    const tags = [];
    if (q.year) tags.push('<span class="tag">' + esc(q.year) + "</span>");
    if (q.region) tags.push('<span class="tag">' + esc(q.region) + "</span>");
    if (cat.name) tags.push('<span class="tag hot">' + esc(cat.name) + "</span>");

    const head =
      '<div class="exbar">' +
        '<div id="clock">' + (st.dur ? "剩余 " + fmtClock(st.endAt - Date.now()) : "不限时") + "</div>" +
        '<div class="exprog">' + (st.pos + 1) + " / " + st.items.length + "</div>" +
      "</div>";

    const sheet = st.items.map(function (_, i) {
      const on = st.answers[i] ? " on" : "";
      const cur = i === st.pos ? " cur" : "";
      return '<button class="sq' + on + cur + '" data-i="' + i + '">' + (i + 1) + "</button>";
    }).join("");

    stage.innerHTML =
      head +
      '<div class="q">' +
        '<div class="tags">' + tags.join("") + "</div>" +
        matHtml +
        '<div class="stem">' + fixImg(q.stem) + "</div>" +
        (q.ask ? '<div class="ask">' + esc(q.ask) + "</div>" : "") +
        (q.options.length ? '<ul class="opts">' + opts + "</ul>" : "") +
        '<div class="actions">' +
          '<button class="btn" id="prev"' + (st.pos === 0 ? " disabled" : "") + ">上一题</button>" +
          '<button class="btn solid grow" id="next">' + (st.pos + 1 >= st.items.length ? "最后一题" : "下一题") + "</button>" +
          '<button class="btn" id="hand">交卷</button>' +
        "</div>" +
        '<div class="khint">A–H 选项 · Enter / → 下一题 · ← 上一题</div>' +
      "</div>" +
      '<div class="sheetwrap"><div class="sheettip">答题卡 · 点数字跳转</div><div class="sheet">' + sheet + "</div></div>";

    const meter = document.getElementById("meter");
    if (meter) meter.style.width = ((st.pos + 1) / st.items.length * 100).toFixed(1) + "%";

    const optsEl = stage.querySelector(".opts");
    if (optsEl) optsEl.addEventListener("click", function (e) {
      const li = e.target.closest(".opt");
      if (!li) return;
      st.answers[st.pos] = li.dataset.k;
      save();
      optsEl.querySelectorAll(".opt").forEach(function (x) { x.classList.remove("sel"); });
      li.classList.add("sel");
      const cur = stage.querySelector(".sq.cur");
      if (cur) cur.classList.add("on");
    });

    stage.querySelector(".sheet").addEventListener("click", function (e) {
      const b = e.target.closest(".sq");
      if (!b) return;
      st.pos = parseInt(b.dataset.i, 10);
      save();
      renderQ();
      window.scrollTo(0, 0);
    });

    const prev = document.getElementById("prev"), next = document.getElementById("next");
    if (prev) prev.onclick = function () { if (st.pos > 0) { st.pos--; save(); renderQ(); window.scrollTo(0, 0); } };
    if (next) next.onclick = function () {
      if (st.pos + 1 < st.items.length) { st.pos++; save(); renderQ(); window.scrollTo(0, 0); }
      else submitExam(false);
    };
    document.getElementById("hand").onclick = function () { submitExam(false); };
  }

  /* ---------------- 交卷 ---------------- */
  async function submitExam(auto) {
    if (tickId) { clearInterval(tickId); tickId = null; }
    const answered = Object.keys(st.answers).length;
    if (!auto) {
      const left = st.items.length - answered;
      const msg = left > 0 ? "还有 " + left + " 题没答，确定交卷？" : "确定交卷？";
      if (!confirm(msg)) return;
    }

    const rows = [];
    let right = 0, wrong = 0, blank = 0;
    const byCat = {};

    for (let i = 0; i < st.items.length; i++) {
      const item = st.items[i];
      const cat = catOf(item[0]);
      let q;
      try { q = await questionOf(item[0], item[1]); } catch (e) { continue; }
      const sel = st.answers[i] || null;
      const ok = sel === q.answer;
      if (!sel) blank++; else if (ok) right++; else wrong++;
      const name = cat ? cat.name : item[0];
      byCat[name] = byCat[name] || { n: 0, r: 0 };
      byCat[name].n++;
      if (ok) byCat[name].r++;

      rows.push([i + 1, ok, sel, q.answer, q.qid, name]);
      if (sel) prog.mark(q.qid, ok, item[0], q.title, q.year, q.region, sel, 0);
    }

    const used = st.dur ? Math.min(st.dur * 60000, Date.now() - st.startedAt) : Date.now() - st.startedAt;
    st.submitted = true;
    st.result = { right: right, wrong: wrong, blank: blank, used: used, total: st.items.length };
    save();

    renderResult(right, wrong, blank, used, byCat, rows, auto);
  }

  function renderResult(right, wrong, blank, used, byCat, rows, auto) {
    mtitle.textContent = "成绩单";
    msub.textContent = st.name;
    const total = st.items.length;
    const rate = total ? Math.round(right / total * 100) : 0;

    const catRows = Object.keys(byCat).sort(function (a, b) { return byCat[b].n - byCat[a].n; })
      .map(function (k) {
        const o = byCat[k];
        return '<div class="crow"><span class="cn">' + esc(k) + "</span>" +
          '<span class="cv">' + o.r + " / " + o.n + "</span></div>";
      }).join("");

    const qrows = rows.map(function (r) {
      const cls = !r[2] ? "blank" : (r[1] ? "ok" : "bad");
      const mark = !r[2] ? "未答" : (r[1] ? "✓" : "✗ " + esc(r[2]) + " → " + esc(r[3]));
      return '<a class="rrow ' + cls + '" href="practice.html?q=' + encodeURIComponent(r[4]) + '">' +
        '<span class="rn">' + r[0] + "</span>" +
        '<span class="rt">' + esc(r[5]) + "</span>" +
        '<span class="rm">' + mark + "</span></a>";
    }).join("");

    stage.innerHTML =
      (auto ? '<div class="autoTip">时间到，已自动交卷</div>' : "") +
      '<div class="score">' +
        '<div class="sbig">' + rate + '<i>%</i></div>' +
        '<div class="sline">答对 ' + right + " · 答错 " + wrong + " · 未答 " + blank + " · 共 " + total + " 题</div>" +
        '<div class="sline">用时 ' + fmtDur(used) + (st.dur ? "（限时 " + st.dur + " 分钟）" : "") + "</div>" +
      "</div>" +
      '<div class="cstats">' + catRows + "</div>" +
      '<div class="rlist">' + qrows + "</div>" +
      '<div class="pacts">' +
        '<a class="btn solid" href="exam.html?p=' + st.pid + '">再做一遍</a>' +
        '<a class="btn" href="exam.html">换一套</a>' +
        '<a class="btn" href="wrong.html">我的收藏</a>' +
        '<a class="btn" href="index.html">回目录</a>' +
      "</div>";

    st.result.rows = null;
    save();
  }

  /* ---------------- 键盘 ---------------- */
  document.addEventListener("keydown", function (e) {
    if (!st || st.submitted) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toUpperCase();
    if (/^[A-H]$/.test(k)) {
      const el = stage.querySelector('.opt[data-k="' + k + '"]');
      if (el) el.click();
      return;
    }
    if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      const b = document.getElementById("next");
      if (b) b.click();
      return;
    }
    if (e.key === "ArrowLeft") {
      const b = document.getElementById("prev");
      if (b && !b.disabled) b.click();
    }
  });
})();
