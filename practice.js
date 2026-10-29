/* 文渊刷题 · 答题页 */
(function () {
  const P = new URLSearchParams(location.search);
  const cid = P.get("c");
  const qid = P.get("q");
  const mode = P.get("mode") || "seq";
  const atParam = P.get("at");

  let INDEX, CAT, META, N, order = [], pos = 0;
  let QMAP = null, byQid = false;   // 单题 / 错题重刷模式下，order 里存的是 qid
  const METAcache = new Map(), KPmap = new Map(), KPloading = new Map();
  const done = new Map();          // qid -> 选中项（本轮已作答）

  const stage = $("#stage");

  /* ---------------- 启动 ---------------- */
  (async function init() {
    INDEX = await loadJSON(DATA + "index.json");

    if (mode === "queue") {
      /* 错题重刷：队列由错题本页写入 localStorage */
      byQid = true;
      order = (store.get("queue", []) || []).slice();
      if (!order.length) order = prog.wrong().map(function (w) { return w.qid; });
      if (!order.length) return fail("错题队列是空的，先去错题本挑几道");
      pos = Math.max(0, Math.min(order.length - 1, parseInt(P.get("at") || "0", 10) || 0));
      QMAP = await loadJSON(DATA + "qmap.json");
      const f0 = findCat(INDEX, (QMAP[order[pos]] || [])[0]);
      if (f0) CAT = f0.cat;
    } else if (qid) {
      byQid = true;
      order = [qid];
      pos = 0;
      QMAP = await loadJSON(DATA + "qmap.json");
      const loc = QMAP[qid];
      if (!loc) return fail("找不到题目 " + qid);
      const f2 = findCat(INDEX, loc[0]);
      if (!f2) return fail("找不到题目 " + qid);
      CAT = f2.cat;
    } else {
      const found = findCat(INDEX, cid);
      if (!found) return fail("未知分类 " + cid);
      CAT = found.cat;
      N = CAT.count;
      if (N === 0) return fail("该分类暂无题目");
      if (mode === "rand") {
        order = shuffle(Array.from({ length: N }, (_, i) => i)).slice(0, Math.min(20, N));
        pos = 0;
      } else {
        order = Array.from({ length: N }, (_, i) => i);
        const saved = store.get("last", null);
        let start = 0;
        if (atParam !== null && atParam !== "") start = parseInt(atParam, 10) || 0;
        else if (saved && saved.cid === CAT.id) start = saved.idx || 0;
        pos = Math.max(0, Math.min(order.length - 1, start));
      }
    }

    META = await getMeta(CAT);
    document.title = (CAT ? CAT.name : "错题重刷") + " · 文渊";
    await render();
  })();

  function fail(msg) {
    stage.innerHTML = '<div class="loading">' + esc(msg) + '</div>';
  }

  /* 分类元数据缓存 */
  function getMeta(cat) {
    if (!METAcache.has(cat.id)) METAcache.set(cat.id, loadJSON(DATA + cat.meta));
    return METAcache.get(cat.id);
  }

  /* 考点卡片：就绪返回数组，未就绪返回 null 并触发后台加载 */
  function kpFor(cat) {
    if (!cat.kp) return [];
    if (KPmap.has(cat.id)) return KPmap.get(cat.id);
    if (!KPloading.has(cat.id)) {
      KPloading.set(cat.id, loadJSON(DATA + cat.kp)
        .then(function (d) { KPmap.set(cat.id, d.kps); return d.kps; })
        .catch(function () { KPmap.set(cat.id, []); return []; }));
    }
    return null;
  }

  function kpReady(cat) {
    if (!cat.kp) return Promise.resolve([]);
    return KPloading.get(cat.id) || Promise.resolve([]);
  }

  function kpHTML(kp, fallbackName, cid) {
    if (!kp) {
      return '<div class="kpbox"><h4>' + esc(fallbackName || "未归类") + "</h4>" +
        '<div class="sub">该考点暂无聚合信息</div></div>';
    }
    return '<div class="kpbox">' +
      "<h4>" + esc(kp.name) + "</h4>" +
      (kp.core ? '<p class="core">' + fixImg(kp.core) + "</p>" : "") +
      '<div class="sub">该考点共 ' + kp.count + " 题" +
      (kp.years && kp.years.length ? " · 出现于 " + esc(kp.years.join(" / ")) : "") +
      (kp.regions && kp.regions.length ? "<br>地区：" + esc(kp.regions.join("、")) : "") +
      "</div>" +
      (cid != null
        ? '<a class="kplink" href="kp.html?c=' + cid + "&k=" + kp.id + '">该考点下 ' +
          kp.count + " 道真题 →</a>"
        : "") +
      "</div>";
  }

  /* ---------------- 渲染 ---------------- */
  async function render() {
    let gi;
    if (byQid) {
      const loc = QMAP[order[pos]];
      if (!loc) return fail("找不到题目 " + order[pos]);
      const f = findCat(INDEX, loc[0]);
      if (!f) return fail("找不到题目 " + order[pos]);
      CAT = f.cat;
      gi = CAT.chunks[loc[1]].start + loc[2];
    } else {
      gi = order[pos];
    }
    META = await getMeta(CAT);

    let q;
    try {
      q = await getQuestion(CAT, gi);
    } catch (e) {
      return fail("题目加载失败：" + e.message);
    }
    prefetch(CAT, Math.min(gi + 1, CAT.count - 1));

    /* 自检开关：?demo=1 自动按「答错」作答并记账，便于校对渲染 */
    if (P.get("demo") && q.options.length && !done.has(q.qid)) {
      const wrong = q.options.find((o) => o.k !== q.answer);
      const pick = wrong ? wrong.k : q.answer;
      done.set(q.qid, pick);
      prog.mark(q.qid, pick === q.answer, CAT.id, q.title, q.year, q.region, pick);
    }

    const revealed = done.has(q.qid);
    const picked = revealed ? done.get(q.qid) : null;
    const right = picked === q.answer;

    /* 顶栏 */
    $("#crumb").textContent = [CAT.name, q.year, q.region].filter(Boolean).join(" · ");
    $("#counter").textContent = (pos + 1) + " / " + order.length;
    $("#meter").style.width = ((pos + 1) / order.length * 100).toFixed(1) + "%";

    if (mode === "seq" && !byQid) store.set("last", { cid: CAT.id, name: CAT.name, idx: gi });

    /* 标签 */
    const tags = [];
    if (q.year) tags.push('<span class="tag">' + esc(q.year) + "</span>");
    if (q.region) tags.push('<span class="tag">' + esc(q.region) + "</span>");
    if (q.kp) tags.push('<span class="tag hot">' + esc(q.kp) + "</span>");
    if (q.paper) tags.push('<span class="tag">' + esc(q.paper) + "</span>");

    /* 以前做过的痕迹 */
    const prev = prog.get(q.qid);
    if (prev && !revealed) {
      tags.push('<span class="tag ' + (prev[0] ? "ok" : "bad") + '">上次' +
        (prev[0] ? "答对" : "答错") +
        (prev[4] > 1 ? " · 已错 " + prev[4] + " 次" : "") + "</span>");
    }

    /* 材料 */
    const matHtml = q.material && META.materials[q.material]
      ? '<div class="material">' + fixImg(META.materials[q.material]) + "</div>"
      : "";

    /* 选项 —— 图形推理的四个选项直接画在题干大图里，选项区只剩 A/B/C/D，
       这时用一排紧凑按钮，避免出现「A  A」这种重复 */
    const plainOpts = q.options.length > 0 && q.options.every(function (o) {
      const t = String(o.v || "")
        .replace(/<[^>]+>/g, "")
        .replace(/[\s。．.、*_`]/g, "");
      return t === "" || t === o.k;
    });

    const opts = q.options.map(function (o, i) {
      const k = o.k || String.fromCharCode(65 + i);
      let cls = plainOpts ? "opt slim" : "opt";
      let mark = "";
      if (revealed) {
        cls += " locked";
        if (k === q.answer) { cls += " right"; mark = plainOpts ? "✓" : "正确答案"; }
        if (k === picked && k !== q.answer) { cls += " wrong"; mark = plainOpts ? "✗" : "你的选择"; }
      } else if (k === picked) {
        cls += " sel";
      }
      return '<li class="' + cls + '" data-k="' + esc(k) + '">' +
        '<span class="k">' + esc(k) + "</span>" +
        (plainOpts ? "" : '<span class="v">' + fixImg(o.v || "") + "</span>") +
        (mark ? '<span class="mark">' + mark + "</span>" : "") +
        "</li>";
    }).join("");

    /* 判定 */
    let verdict = "";
    if (revealed) {
      verdict = right
        ? '<div class="verdict ok">✓ 答对了<b>&nbsp;' + esc(q.answer) + "</b></div>"
        : '<div class="verdict bad">✗ 答错了 · 正确答案 <b>' + esc(q.answer) +
          "</b>" + (picked ? " · 你选了 " + esc(picked) : "") + "</div>";
    }

    /* 解析区 */
    let detail = "";
    if (revealed) {
      const blocks = [];

      if (q.analysis) {
        blocks.push('<div class="block"><div class="h">官方解析</div><div class="analysis" style="margin-top:0;border-top:none;padding-top:0">' +
          fixImg(q.analysis) + "</div></div>");
      }
      if (q.fast) {
        blocks.push('<div class="block"><div class="h">最快解法</div><div class="fast">' +
          fixImg(q.fast) + "</div></div>");
      }
      if (q.chain && q.chain.length) {
        blocks.push('<div class="block"><div class="h">推理链</div><ol>' +
          q.chain.map((s) => "<li>" + fixImg(s) + "</li>").join("") + "</ol></div>");
      }
      if (q.traps && q.traps.length) {
        blocks.push('<div class="block"><div class="h">易错点</div><ul>' +
          q.traps.map((s) => "<li>" + fixImg(s) + "</li>").join("") + "</ul></div>");
      }
      if (q.abstract) {
        blocks.push('<div class="block"><div class="h">母题抽象</div><div class="abstract">' +
          fixImg(q.abstract) + "</div></div>");
      }
      if (q.features) {
        blocks.push('<div class="block"><div class="h">同类特征</div><p>' +
          fixImg(q.features) + "</p></div>");
      }

      const KPS = kpFor(CAT);
      if (CAT.kp && (q.kp || KPS)) {
        blocks.push('<div class="block"><div class="h">考点溯源</div><div id="kpbox">' +
          (KPS ? kpHTML(KPS[q.kpId], q.kp, CAT.id) : '<div style="color:var(--faint);font-size:13px;padding:6px 0">载入中…</div>') +
          "</div></div>");
      }

      detail = blocks.join("");
    }

    /* 操作区 */
    const canSubmit = revealed || q.options.length === 0 || picked;
    const atEnd = revealed && pos + 1 >= order.length;
    const submitLabel = revealed ? (atEnd ? "已完成" : "下一题 →") : (q.options.length === 0 ? "看答案" : "提交");

    /* 走完一组后的出口，避免卡在最后一题 */
    let doneBox = "";
    if (atEnd) {
      const st = (prog.stats().byCat || {})[CAT.id] || { done: 0, right: 0 };
      doneBox =
        '<div class="donebox">' +
          '<div class="dh">这一组走完了</div>' +
          '<div class="dp">' + esc(CAT.name) + " 已做 " + st.done + " 题" +
            (st.done ? " · 正确率 " + Math.round(st.right / st.done * 100) + "%" : "") +
            " · 本组 " + order.length + " 题</div>" +
          '<div class="dacts">' +
            '<a class="btn solid" href="practice.html?c=' + CAT.id + '&mode=rand">再来 20 题</a>' +
            '<a class="btn" href="index.html">回目录</a>' +
            '<a class="btn" href="wrong.html">看错题本</a>' +
            (pos > 0 ? '<button class="btn" id="prev">← 上一题</button>' : "") +
          "</div>" +
        "</div>";
    }

    stage.innerHTML =
      '<div class="q">' +
        (tags.length ? '<div class="tags">' + tags.join("") + "</div>" : "") +
        matHtml +
        '<div class="stem">' + fixImg(q.stem) + "</div>" +
        (q.ask ? '<div class="ask">' + esc(q.ask) + "</div>" : "") +
        (q.options.length ? '<ul class="opts' + (plainOpts ? " slim" : "") + '">' + opts + "</ul>" : "") +
        verdict +
        detail +
        (atEnd
          ? ""
          : '<div class="actions">' +
              '<button class="btn" id="prev"' + (pos === 0 ? " disabled" : "") + ">上一题</button>" +
              '<button class="btn solid grow" id="next"' + (!canSubmit ? " disabled" : "") + ">" +
                esc(submitLabel) + "</button>" +
            "</div>" +
            '<div class="khint">A–H 选项 · Enter 提交 / 下一题 · ← → 翻页</div>') +
        doneBox +
      "</div>";

    bind(q, revealed);

    if (revealed && !kpFor(CAT)) {
      const cid0 = CAT.id;
      kpReady(CAT).then(function (kps) {
        const box = document.getElementById("kpbox");
        if (box && CAT && CAT.id === cid0) box.innerHTML = kpHTML(kps[q.kpId], q.kp, cid0);
      });
    }
  }

  /* ---------------- 交互 ---------------- */
  function bind(q, revealed) {
    const optsEl = stage.querySelector(".opts");
    if (optsEl) {
      optsEl.addEventListener("click", function (e) {
        if (revealed) return;
        const li = e.target.closest(".opt");
        if (!li) return;
        optsEl.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel"));
        li.classList.add("sel");
        $("#next").disabled = false;
      });
    }

    const prevBtn = $("#prev"), nextBtn = $("#next");
    if (prevBtn) prevBtn.onclick = function () { if (pos > 0) { pos--; render(); window.scrollTo(0, 0); } };
    if (nextBtn) nextBtn.onclick = function () { next(q, revealed); };
  }

  async function next(q, revealed) {
    if (!revealed) {
      const sel = stage.querySelector(".opt.sel");
      const pick = sel ? sel.dataset.k : null;
      done.set(q.qid, pick);
      prog.mark(q.qid, pick === q.answer, CAT.id, q.title, q.year, q.region, pick);
      await render();
      const v = stage.querySelector(".verdict") || stage.querySelector(".block");
      if (v) v.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (pos + 1 < order.length) {
      pos++;
      await render();
      window.scrollTo(0, 0);
    }
  }

  /* 键盘：A–D / 1–4 选择，Enter 提交或下一题，← → 翻页 */
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toUpperCase();
    const revealed = stage.querySelector(".verdict") !== null;

    if (!revealed && /^[A-H]$/.test(k)) {
      const el = stage.querySelector('.opt[data-k="' + k + '"]');
      if (el) {
        stage.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel");
        $("#next").disabled = false;
      }
      return;
    }
    if (!revealed && /^[1-8]$/.test(e.key)) {
      const all = stage.querySelectorAll(".opt");
      const el = all[parseInt(e.key, 10) - 1];
      if (el) {
        all.forEach((x) => x.classList.remove("sel"));
        el.classList.add("sel");
        $("#next").disabled = false;
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const btn = $("#next");
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (e.key === "ArrowLeft" && pos > 0) { pos--; render(); window.scrollTo(0, 0); }
    if (e.key === "ArrowRight") { const b = $("#next"); if (b && !b.disabled) b.click(); }
  });
})();
