/* Word Buddy — pure helpers shared by the app (and testable in Node).
   - cleanImage: evens out shadows and removes table borders before OCR
   - wordsFromOcr: turns Tesseract lines into the list of words/phrases to show
   - segmentChinese: splits a run of Chinese text into dictionary words */
(function (root) {
  "use strict";

  /* ---------- image clean-up ---------- */
  // gray: Uint8ClampedArray/Uint8Array of length w*h (0..255). Returns Uint8Array 0 (ink) / 255 (paper).
  function cleanImage(gray, w, h) {
    const n = w * h;
    // integral image for a local mean (adaptive threshold handles shadows)
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(15, Math.floor(Math.min(w, h) / 16));
    const dark = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const s = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
        const mean = s / ((y1 - y0) * (x1 - x0));
        dark[y * w + x] = gray[y * w + x] < mean * 0.85 ? 1 : 0;
      }
    }
    // table borders: long thin runs (allow slight tilt by thickening first)
    const lines = new Uint8Array(n);
    const hv = dilate(dark, w, h, 0, 2);           // thicken vertically, find long horizontal runs
    markRuns(hv, w, h, true, Math.floor(w * 0.08), lines);
    const vh = dilate(dark, w, h, 2, 0);           // thicken horizontally, find long vertical runs
    const vlines = new Uint8Array(n);
    markRuns(vh, w, h, false, Math.floor(h * 0.25), vlines);
    const hl = dilate(lines, w, h, 0, 2), vl = dilate(vlines, w, h, 2, 0);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = dark[i] && !hl[i] && !vl[i] ? 0 : 255;
    return out;
  }
  function dilate(m, w, h, rx, ry) {
    let a = m;
    if (rx) {
      const b = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!a[y * w + x]) continue;
        for (let k = Math.max(0, x - rx); k <= Math.min(w - 1, x + rx); k++) b[y * w + k] = 1;
      }
      a = b;
    }
    if (ry) {
      const b = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!a[y * w + x]) continue;
        for (let k = Math.max(0, y - ry); k <= Math.min(h - 1, y + ry); k++) b[k * w + x] = 1;
      }
      a = b;
    }
    return a;
  }
  function markRuns(m, w, h, horizontal, L, out) {
    const outer = horizontal ? h : w, inner = horizontal ? w : h;
    for (let o = 0; o < outer; o++) {
      let start = -1;
      for (let i = 0; i <= inner; i++) {
        const v = i < inner ? (horizontal ? m[o * w + i] : m[i * w + o]) : 0;
        if (v && start < 0) start = i;
        if (!v && start >= 0) {
          if (i - start >= L) for (let k = start; k < i; k++) out[horizontal ? o * w + k : k * w + o] = 1;
          start = -1;
        }
      }
    }
  }

  /* ---------- Chinese helpers ---------- */
  const CJK = /[㐀-鿿]/;
  const isCJK = s => CJK.test(s);
  const ZH_STOP = new Set("的了是在和也就都而及与着或个这那你我他她它们吗呢吧啊之其被把给从向对很".split(""));
  function segmentChinese(text, has) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      let len = Math.min(4, text.length - i), found = 1;
      for (; len > 1; len--) if (has(text.substr(i, len))) { found = len; break; }
      out.push(text.substr(i, found));
      i += found;
    }
    return out;
  }

  /* ---------- OCR result -> word list ---------- */
  const EN_STOP = new Set(("a an the and or but if of to in on at by for with from as is are was were be been am it its this that these those " +
    "i you he she we they me him her us them my your his our their do does did not no so up out then than too very can will just " +
    "there here what which who when where why how all any some each").split(" "));

  // lines: [{words:[{text, conf, x0, x1, y0, y1}]}]; lang: "en" | "zh"; has(word) for Chinese dictionary
  function wordsFromOcr(lines, lang, has) {
    const items = [], seen = new Set();
    const add = s => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return;
      seen.add(k); items.push(s);
    };
    for (const line of lines) {
      // Chinese: keep every Chinese character for now; the dictionary decides below
      const ws = lang === "zh"
        ? line.words.filter(wd => /[\u3400-\u9fff]/.test(wd.text || ""))
        : line.words.filter(wd => keepWord(wd, lang, has));
      if (!ws.length) continue;
      const hts = ws.map(wd => wd.y1 - wd.y0).sort((a, b) => a - b);
      const hMed = hts[Math.floor(hts.length / 2)] || 20;
      // group words that sit close together; a wide gap means a new table cell
      const groups = [];
      let g = [ws[0]];
      for (let i = 1; i < ws.length; i++) {
        const gap = ws[i].x0 - ws[i - 1].x1;
        if (gap > hMed * (lang === "zh" ? 0.6 : 0.9)) { groups.push(g); g = [ws[i]]; } else g.push(ws[i]);
      }
      groups.push(g);
      for (const grp of groups) {
        if (lang === "zh") {
          // one confidence per character
          const chars = [], conf = [];
          for (const wd of grp) for (const ch of wd.text) if (/[\u3400-\u9fff]/.test(ch)) { chars.push(ch); conf.push(wd.conf); }
          if (!chars.length) continue;
          const text = chars.join(""), minConf = Math.min(...conf);
          if (text.length <= 4 && (has(text) || minConf >= 60)) { add(text); continue; }
          // otherwise split into dictionary words; a lone character needs to be read clearly
          let i = 0;
          for (const part of segmentChinese(text, has)) {
            const c = conf.slice(i, i + part.length); i += part.length;
            if (part.length >= 2 && has(part)) add(part);
            else if (part.length === 1 && c[0] >= 60 && !ZH_STOP.has(part)) add(part);
          }
        } else {
          const toks = grp.map(wd => cleanEn(wd.text)).filter(Boolean);
          if (!toks.length) continue;
          if (toks.length <= 2 && !toks.every(t => EN_STOP.has(t.toLowerCase()))) { add(toks.join(" ")); continue; }
          for (const t of toks) if (!EN_STOP.has(t.toLowerCase()) && t.length > 1) add(t);
        }
      }
    }
    return items;
  }
  function cleanEn(t) {
    return t.replace(/[’]/g, "'").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  }
  // OCR confidence is unreliable on photos, so a known dictionary word is kept even when confidence is low
  function keepWord(wd, lang, has) {
    const t = (wd.text || "").trim();
    if (!t) return false;
    if (lang === "zh") {
      const c = t.replace(/[^\u3400-\u9fff]/g, "");
      if (!c) return false;
      return wd.conf >= 30 || (c.length >= 2 && has(c));
    }
    const c = cleanEn(t);
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(c)) return false;
    if (wd.conf >= 75) return c.length >= 2;
    return c.length >= 3 && has(c.toLowerCase());
  }

  /* ---------- typed input -> word list ---------- */
  function wordsFromTyped(text, has) {
    const out = [], seen = new Set();
    for (let part of text.split(/[\n,;，、；。]+/)) {
      part = part.trim();
      if (!part) continue;
      const items = isCJK(part) && part.replace(/[^㐀-鿿]/g, "").length > 4
        ? segmentChinese(part.replace(/[^㐀-鿿]/g, ""), has).filter(p => !(p.length === 1 && ZH_STOP.has(p)))
        : [part];
      for (const it of items) { const k = it.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } }
    }
    return out;
  }

  const api = { cleanImage, wordsFromOcr, wordsFromTyped, segmentChinese, isCJK };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WB = api;
})(typeof self !== "undefined" ? self : this);
