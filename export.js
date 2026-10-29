/* 错题导出：Word(.docx) / Markdown
   依赖 common.js 的 fetchQuestion() */
(function () {
  const SX = (window.WYExport = {});

  /* ---------- 收集 ---------- */
  SX.collect = async function (qids, onProgress) {
    const out = [];
    for (let i = 0; i < qids.length; i++) {
      if (onProgress) onProgress(i, qids.length);
      try {
        const q = await fetchQuestion(qids[i]);
        if (q) out.push(q);
      } catch (e) { /* 单题失败不影响整体 */ }
    }
    if (onProgress) onProgress(qids.length, qids.length);
    return out;
  };

  /* ---------- 把 HTML 拆成 文本 / 图片 片段 ---------- */
  function parts(html) {
    if (!html) return [];
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const root = doc.body.firstChild;
    const out = [];
    let buf = '';
    const flush = () => {
      const t = buf.replace(/\s+/g, ' ').trim();
      if (t) out.push({ t: 'text', s: t });
      buf = '';
    };
    (function walk(node) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) buf += n.textContent;
        else if (n.nodeName === 'IMG') {
          flush();
          out.push({ t: 'img', src: n.getAttribute('src') || '' });
        } else if (n.nodeName === 'BR') buf += ' ';
        else { walk(n); if (n.nodeName === 'P' || n.nodeName === 'DIV') buf += ' '; }
      }
    })(root);
    flush();
    return out;
  }

  /* ---------- 图片：webp → jpeg（Word 老版本不认 webp） ---------- */
  const imgCache = new Map();
  async function imgAsJpeg(src) {
    if (imgCache.has(src)) return imgCache.get(src);
    const abs = new URL(src, location.href).href;
    const p = (async () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = abs; });
      const maxW = 1200;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { data: u8, w, h };
    })();
    imgCache.set(src, p);
    return p;
  }

  /* ---------- Markdown ---------- */
  SX.markdown = async function (items) {
    const L = [];
    L.push('# 错题本\n');
    L.push('> 文渊 · ' + new Date().toLocaleDateString('zh-CN') + ' · 共 ' + items.length + ' 道\n');
    items.forEach((q, i) => {
      L.push('\n---\n\n## ' + (i + 1) + '. ' + [q._cat, q.year, q.region].filter(Boolean).join(' · ') + '\n');
      L.push('**qid** ' + q.qid + '\n');
      for (const p of parts(q._material)) {
        L.push(p.t === 'text' ? '> ' + p.s : '> ![](' + new URL(p.src, location.href).href + ')\n');
      }
      for (const p of parts(q.stem)) {
        L.push(p.t === 'text' ? p.s + '\n' : '![](' + new URL(p.src, location.href).href + ')\n');
      }
      L.push('');
      (q.options || []).forEach((o) => {
        const ps = parts(o.v).map((x) => x.t === 'text' ? x.s : '![](' + new URL(x.src, location.href).href + ')').join(' ');
        L.push('- **' + o.k + '**. ' + ps);
      });
      L.push('\n**答案**：' + (q.answer || '—'));
      L.push('\n**解析**\n');
      for (const p of parts(q.analysis)) {
        L.push(p.t === 'text' ? p.s + '\n' : '![](' + new URL(p.src, location.href).href + ')\n');
      }
    });
    return L.join('\n');
  };

  /* ---------- Word ---------- */
  function loadDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/docx.umd.js';
      s.onload = () => res(window.docx);
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  SX.docx = async function (items, opts, onProgress) {
    const D = await loadDocx();
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType,
      BorderStyle, PageBreak } = D;

    const FONT = '宋体';
    const txt = (s, o) => new TextRun(Object.assign({ text: s, font: FONT, size: 21 }, o || {}));
    const para = (children, o) => new Paragraph(Object.assign({ children, spacing: { after: 120 } }, o || {}));

    async function blocks(html, onImg) {
      const out = [];
      for (const p of parts(html)) {
        if (p.t === 'text') out.push(para([txt(p.s)]));
        else {
          try {
            const im = await imgAsJpeg(p.src);
            if (onImg) onImg();
            out.push(new Paragraph({
              children: [new ImageRun({ type: 'jpg', data: im.data,
                transformation: { width: im.w, height: im.h } })],
              spacing: { before: 80, after: 80 },
            }));
          } catch (e) { /* 图挂了就跳过 */ }
        }
      }
      return out;
    }

    const body = [];
    body.push(para([new TextRun({ text: '错题本', font: FONT, size: 36, bold: true })], { alignment: AlignmentType.CENTER }));
    body.push(para([new TextRun({ text: new Date().toLocaleDateString('zh-CN') + ' · 共 ' + items.length + ' 道', font: FONT, size: 18, color: '888888' })], { alignment: AlignmentType.CENTER }));

    /* 第一段：题目 */
    for (let i = 0; i < items.length; i++) {
      const q = items[i];
      if (onProgress) onProgress(i + 1, items.length);
      body.push(para([
        new TextRun({ text: (i + 1) + '. ', font: FONT, size: 24, bold: true }),
        new TextRun({ text: [q._cat, q.year, q.region].filter(Boolean).join(' · '), font: FONT, size: 16, color: '999999' }),
      ], { spacing: { before: 240, after: 80 } }));
      for (const p of await blocks(q._material)) body.push(p);
      for (const p of await blocks(q.stem)) body.push(p);
      for (const o of (q.options || [])) {
        body.push(new Paragraph({ children: [txt(o.k + '. ')], spacing: { after: 40 } }));
        body.push(...(await blocks(o.v)));
      }
    }

    /* 第二段：答案解析 */
    body.push(new Paragraph({ children: [new PageBreak()] }));
    body.push(para([new TextRun({ text: '答案与解析', font: FONT, size: 30, bold: true })], { alignment: AlignmentType.CENTER }));
    for (let i = 0; i < items.length; i++) {
      const q = items[i];
      const picked = q.picked ? '（你选了 ' + q.picked + '）' : '';
      body.push(para([
        new TextRun({ text: (i + 1) + '. 正确答案 ' + (q.answer || '—'), font: FONT, size: 22, bold: true }),
        new TextRun({ text: ' ' + picked, font: FONT, size: 18, color: 'B3482F' }),
      ], { spacing: { before: 200, after: 60 } }));
      for (const p of await blocks(q.analysis)) body.push(p);
    }

    const doc = new Document({ sections: [{ children: body }] });
    return Packer.toBlob(doc);
  };

  SX.save = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
})();
