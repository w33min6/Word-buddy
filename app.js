/* Word Buddy — English vocabulary helper for primary-school children.
   No accounts, no AI service.
   Meanings: WordNet 3.1 (Princeton), built in as dict-a.json … dict-z.json, most-used meaning first
   Pronunciation guide: Free Dictionary API, when it answers
   Example sentences: dictionary first, then a filtered sentence bank (sentences-en.txt)
   Photo reading: Tesseract.js, on the device. Read aloud: the device's own voice. */
(() => {
"use strict";
const $ = id => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };

/* ---------------- example words shown before the first scan ---------------- */
const EXAMPLES = ["emcee", "screeching", "clammy", "antique", "incredulity", "cordial", "accomplished", "geared up", "backstage", "gusto"];
let words = EXAMPLES.slice(), isExample = true;

/* ---------------- data, loaded on first need ---------------- */
const once = fn => { let p; return () => (p = p || fn().catch(e => { p = null; throw e; })); };
const getText = async f => { const r = await fetch(f); if (!r.ok) throw new Error(f); return r.text(); };
const loadWords = once(async () => new Set((await getText("words-en.txt")).split("\n")));
const loadSentences = once(async () => (await getText("sentences-en.txt")).split("\n").filter(Boolean));

function status(t, busy) {
  if (!t) { show($("status"), false); return; }
  $("statusText").textContent = t; show($("spin"), !!busy); show($("status"), true);
}
function setBusy(b) { ["camBtn", "picBtn", "typeBtn", "useCrop", "rotBtn"].forEach(id => { $(id).disabled = b; }); }

/* ---------------- read aloud (device voice, works offline) ---------------- */
let voices = [];
function refreshVoices() { try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; } }
if ("speechSynthesis" in window) { refreshVoices(); speechSynthesis.addEventListener?.("voiceschanged", refreshVoices); }
function pickVoice() {
  if (!voices.length) refreshVoices();
  const en = voices.filter(v => /^en[-_]/i.test(v.lang));
  return en.find(v => /en[-_](GB|SG|AU)/i.test(v.lang) && /premium|enhanced|natural|google|serena|kate|daniel|karen/i.test(v.name))
    || en.find(v => /en[-_](GB|SG)/i.test(v.lang)) || en.find(v => /premium|enhanced|samantha/i.test(v.name)) || en[0] || null;
}
let speakingBtn = null;
function speak(text, btn) {
  stopSpeech();
  if (!text || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(); if (v) u.voice = v;
  u.lang = v ? v.lang : "en-GB";
  u.rate = $("slow").checked ? 0.75 : 0.95;
  if (btn) { speakingBtn = btn; btn.classList.add("on"); }
  u.onend = u.onerror = () => { if (btn && speakingBtn === btn) { btn.classList.remove("on"); speakingBtn = null; } };
  speechSynthesis.speak(u);
}
function stopSpeech() {
  try { speechSynthesis.cancel(); } catch (e) {}
  if (speakingBtn) { speakingBtn.classList.remove("on"); speakingBtn = null; }
}

/* ---------------- step 2: word chips ---------------- */
function renderChips() {
  const c = $("chips"); c.textContent = "";
  show($("exTag"), isExample);
  show($("fixNote"), !isExample && words.length > 0);
  if (!words.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "No words yet. Take a photo or type some words."; c.appendChild(p); return;
  }
  words.forEach(w => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = w;
    b.addEventListener("click", () => {
      document.querySelectorAll(".chip.on").forEach(x => x.classList.remove("on"));
      b.classList.add("on"); openWord(w);
    });
    c.appendChild(b);
  });
}

/* ---------------- meanings: WordNet, built in (dict-a.json … dict-z.json) ---------------- */
// Meanings are listed most-used first, so the first one is usually the one a child needs.
const shards = {};
function loadShard(ch) {
  if (!/^[a-z]$/.test(ch)) return Promise.resolve({});
  return shards[ch] = shards[ch] || fetch("dict-" + ch + ".json").then(r => { if (!r.ok) throw new Error("dict"); return r.json(); })
    .catch(e => { delete shards[ch]; throw e; });
}
function cleanDef(d) {
  let s = d.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/\bsomeone's\b/g, "someone's").replace(/\betc$/, "and so on");
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(s) ? s : s + ".";
}
async function lookup(word) {
  for (const cand of stems(word)) {
    const shard = await loadShard(cand.charAt(0));
    const senses = shard[cand];
    if (senses && senses.length) return { base: cand, senses: senses.map(([pos, def, ex]) => ({ pos, text: cleanDef(def), examples: (ex || []).map(cap) })) };
  }
  return null;
}
// pronunciation guide: optional, from the Free Dictionary API; skipped quietly if it doesn't answer
async function phonetic(word) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word), { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return "";
    const data = await res.json();
    return (data.map(e => e.phonetic || (e.phonetics || []).map(p => p.text).find(Boolean)).find(Boolean) || "").replace(/^\/|\/$/g, "");
  } catch (e) { return ""; }
}

/* ---------------- step 3: the word panel ---------------- */
let current = null, token = 0;
function note(t) { $("pNote").textContent = t; show($("pNote"), !!t); }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function sense() { return current && current.senses[current.senseIdx]; }
function examplesNow() {
  const s = sense();
  const own = s ? s.examples : [];
  return [...own, ...current.bank.filter(b => !own.includes(b))];
}
function renderMeaning() {
  const s = sense();
  $("pMean").textContent = s ? s.text : "";
  $("pPos").textContent = s ? s.pos : "";
  $("nextMean").hidden = current.senses.length < 2;
  $("sayMean").disabled = !s;
}
function renderExample() {
  const p = $("pEx"); p.textContent = "";
  const ex = examplesNow();
  $("nextEx").disabled = ex.length < 2; $("sayEx").disabled = !ex.length;
  if (!ex.length) { p.textContent = current.loadingEx ? "Finding an example…" : "No example sentence found for this word."; return; }
  const s = ex[current.exIdx % ex.length];
  const parts = s.split(wordRe("i"));
  if (parts.length >= 3) { p.append(parts[0]); const b = document.createElement("b"); b.textContent = parts[1]; p.append(b, parts.slice(2).join("")); }
  else p.textContent = s;
}

async function openWord(word) {
  const my = ++token;
  stopSpeech();
  show($("panelEmpty"), false); show($("panelBody"), true); note("");
  const sec = $("wordSec"), r = sec.getBoundingClientRect();
  if (r.top > window.innerHeight * 0.55 || r.top < 0) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  $("lookup").href = "https://www.google.com/search?q=" + encodeURIComponent("define " + word);
  current = { word, senses: [], senseIdx: 0, bank: [], exIdx: 0, loadingEx: true, matchWord: stemRoot(word) };
  $("pWord").textContent = word; $("pSay").textContent = ""; $("pPos").textContent = "";
  $("pMean").textContent = "Finding the meaning…"; $("nextMean").hidden = true; $("sayMean").disabled = true;
  renderExample();
  speak(word, $("sayWord"));
  phonetic(word).then(ph => { if (my === token && ph) $("pSay").textContent = "(" + ph + ")"; });
  try {
    const found = await lookup(word);
    if (my !== token) return;
    if (!found) {
      $("pMean").textContent = "";
      note("This word isn't in the dictionary. Check the photo read it correctly, or look it up.");
    } else {
      current.senses = found.senses;
      if (found.base !== word.toLowerCase()) {
        note("This is the meaning of “" + found.base + "”, the base word.");
        current.matchWord = stemRoot(found.base);
      }
      renderMeaning();
    }
  } catch (err) {
    if (my !== token) return;
    $("pMean").textContent = "";
    note(navigator.onLine === false ? "You're offline, and this letter of the dictionary hasn't been saved yet. Connect to the internet once and try again." : "Couldn't open the dictionary just now. Tap the word to try again.");
  }
  try {
    const sents = await loadSentences();
    if (my !== token) return;
    const re = wordRe("i");
    current.bank = pickExamples(sents.filter(s => re.test(s) && s.split(" ").length >= 5));
  } catch (e) {}
  if (my !== token) return;
  current.loadingEx = false;
  renderExample();
}

function stems(w) {
  const s = new Set();
  const l = w.toLowerCase().trim().replace(/[’]/g, "'"); s.add(l);
  const words = l.split(" ");
  if (words.length > 1) {
    // phrases: also try the base form of the first word ("geared up" -> "gear up")
    for (const f of stems(words[0])) s.add([f, ...words.slice(1)].join(" "));
    return [...s];
  }
  const add = x => x.length > 2 && s.add(x);
  if (/ies$/.test(l)) add(l.slice(0, -3) + "y");
  if (/(ches|shes|sses|xes|zes|oes)$/.test(l)) add(l.slice(0, -2));
  if (/s$/.test(l) && !/ss$/.test(l)) add(l.slice(0, -1));
  if (/ied$/.test(l)) add(l.slice(0, -3) + "y");
  if (/ed$/.test(l)) { add(l.slice(0, -2)); add(l.slice(0, -1)); if (/(.)\1ed$/.test(l)) add(l.slice(0, -3)); }
  if (/ing$/.test(l)) { add(l.slice(0, -3)); add(l.slice(0, -3) + "e"); if (/(.)\1ing$/.test(l)) add(l.slice(0, -4)); }
  if (/ier$/.test(l)) add(l.slice(0, -3) + "y");
  if (/iest$/.test(l)) add(l.slice(0, -4) + "y");
  if (/er$/.test(l)) { add(l.slice(0, -2)); add(l.slice(0, -1)); }
  if (/est$/.test(l)) { add(l.slice(0, -3)); add(l.slice(0, -2)); }
  if (/ily$/.test(l)) add(l.slice(0, -3) + "y");
  if (/ly$/.test(l)) add(l.slice(0, -2));
  return [...s];
}
// matches the word in its different forms; a phrase must appear as a whole ("geared up", "gears up")
function wordRe(flags) {
  const parts = current.matchWord.split(" ");
  const tail = parts.slice(1).map(escapeRe).join("\\s+");
  return new RegExp("(\\b" + escapeRe(parts[0]) + "[a-z'-]*" + (tail ? "\\s+" + tail : "") + "\\b)", flags);
}
function stemRoot(w) {
  const l = w.toLowerCase();
  if (l.includes(" ")) { const [f, ...rest] = l.split(" "); return [f.replace(/(ing|ed|es|s)$/, "").replace(/e$/, "") || f, ...rest].join(" "); }
  return l.replace(/(ies|ied)$/, "i").replace(/(ing|ed|es|s)$/, "").replace(/e$/, "") || l;
}
function pickExamples(list) {
  // medium-length sentences read best; shuffle a little so "Another" feels fresh
  const ideal = 45;
  const best = list.slice().sort((a, b) => Math.abs(a.length - ideal) - Math.abs(b.length - ideal)).slice(0, 12);
  for (let i = best.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [best[i], best[j]] = [best[j], best[i]]; }
  return best.slice(0, 5);
}

$("sayWord").addEventListener("click", () => current && speak(current.word, $("sayWord")));
$("sayMean").addEventListener("click", () => { const s = sense(); if (s) speak(s.text, $("sayMean")); });
$("nextMean").addEventListener("click", () => { if (!current) return; current.senseIdx = (current.senseIdx + 1) % current.senses.length; current.exIdx = 0; stopSpeech(); renderMeaning(); renderExample(); });
$("sayEx").addEventListener("click", () => { const ex = current ? examplesNow() : []; if (ex.length) speak(ex[current.exIdx % ex.length], $("sayEx")); });
$("nextEx").addEventListener("click", () => { if (!current) return; current.exIdx++; stopSpeech(); renderExample(); });

/* ---------------- step 1: photo, rotate, crop ---------------- */
$("camBtn").addEventListener("click", () => $("camInput").click());
$("picBtn").addEventListener("click", () => $("picInput").click());
$("camInput").addEventListener("change", e => loadPhoto(e.target));
$("picInput").addEventListener("change", e => loadPhoto(e.target));

let srcCanvas = null;
const crop = { x: .05, y: .05, w: .9, h: .9 };
async function fileToCanvas(f) {
  const MAX = 2600;
  let src, W, H;
  try { src = await createImageBitmap(f, { imageOrientation: "from-image" }); W = src.width; H = src.height; }
  catch (e) {
    const url = URL.createObjectURL(f); src = new Image(); src.src = url; await src.decode();
    W = src.naturalWidth; H = src.naturalHeight; setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const sc = Math.min(1, MAX / Math.max(W, H));
  const c = document.createElement("canvas"); c.width = Math.round(W * sc); c.height = Math.round(H * sc);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c;
}
async function loadPhoto(input) {
  const f = input.files && input.files[0]; input.value = ""; if (!f) return;
  show($("typeBox"), false); status("");
  try { srcCanvas = await fileToCanvas(f); }
  catch (e) { status("That photo couldn't be opened. Try another one."); return; }
  Object.assign(crop, { x: .05, y: .05, w: .9, h: .9 });
  $("cropImg").onload = () => { drawBox(); $("cropper").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("cropImg").src = srcCanvas.toDataURL("image/jpeg", .9);
  show($("cropper"), true);
  getWorker().catch(() => {});   // get the reader ready while the child crops
}
function drawBox() {
  const b = $("box");
  b.style.left = crop.x * 100 + "%"; b.style.top = crop.y * 100 + "%";
  b.style.width = crop.w * 100 + "%"; b.style.height = crop.h * 100 + "%";
}
$("rotBtn").addEventListener("click", () => {
  if (!srcCanvas) return;
  const c = document.createElement("canvas"); c.width = srcCanvas.height; c.height = srcCanvas.width;
  const g = c.getContext("2d"); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(srcCanvas, 0, 0);
  srcCanvas = c;
  Object.assign(crop, { x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w });
  $("cropImg").src = c.toDataURL("image/jpeg", .9);
});
$("cancelCrop").addEventListener("click", () => { show($("cropper"), false); srcCanvas = null; status(""); });

(function cropDrag() {
  const stage = $("stage"), box = $("box"); let drag = null; const MIN = .06;
  box.addEventListener("pointerdown", e => {
    e.preventDefault(); box.setPointerCapture(e.pointerId);
    const r = stage.getBoundingClientRect();
    drag = { h: e.target.dataset.h || "move", sx: e.clientX, sy: e.clientY, W: r.width, H: r.height, o: { ...crop } };
  });
  box.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.W, dy = (e.clientY - drag.sy) / drag.H, o = drag.o;
    let { x, y, w, h } = o;
    if (drag.h === "move") { x = Math.min(Math.max(0, o.x + dx), 1 - o.w); y = Math.min(Math.max(0, o.y + dy), 1 - o.h); }
    else {
      if (drag.h.includes("l")) { x = Math.min(Math.max(0, o.x + dx), o.x + o.w - MIN); w = o.x + o.w - x; }
      if (drag.h.includes("r")) w = Math.min(Math.max(MIN, o.w + dx), 1 - o.x);
      if (drag.h.includes("t")) { y = Math.min(Math.max(0, o.y + dy), o.y + o.h - MIN); h = o.y + o.h - y; }
      if (drag.h.includes("b")) h = Math.min(Math.max(MIN, o.h + dy), 1 - o.y);
    }
    Object.assign(crop, { x, y, w, h }); drawBox();
  });
  const end = () => { drag = null; };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
})();

function croppedClean() {
  const W = srcCanvas.width, H = srcCanvas.height;
  const sx = Math.round(crop.x * W), sy = Math.round(crop.y * H);
  const sw = Math.max(1, Math.round(crop.w * W)), sh = Math.max(1, Math.round(crop.h * H));
  const sc = Math.min(2200 / Math.max(sw, sh), Math.max(1, 1400 / Math.max(sw, sh)));
  const c = document.createElement("canvas"); c.width = Math.round(sw * sc); c.height = Math.round(sh * sc);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, n = c.width * c.height;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) gray[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  const out = WB.cleanImage(gray, c.width, c.height);
  for (let i = 0; i < n; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = out[i]; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

/* ---------------- Tesseract ---------------- */
let workerP = null, progressCb = null;
function getWorker() {
  if (!window.Tesseract) return Promise.reject(new Error("no-tesseract"));
  workerP = workerP || Tesseract.createWorker("eng", 1, { logger: m => progressCb && progressCb(m) })
    .catch(e => { workerP = null; throw e; });
  return workerP;
}

$("useCrop").addEventListener("click", async () => {
  if (!srcCanvas) return;
  setBusy(true); status("Getting ready…", true);
  progressCb = m => {
    const pct = m.progress ? Math.round(m.progress * 100) + "%" : "";
    if (/load|initializ/i.test(m.status)) status("Getting the reader ready (first time only) " + pct, true);
    else if (/recogniz/i.test(m.status)) status("Reading the words… " + pct, true);
  };
  try {
    const [worker, dict] = await Promise.all([getWorker(), loadWords()]);
    const { data } = await worker.recognize(croppedClean(), {}, { blocks: true, text: true });
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || [])
      lines.push({ words: (l.words || []).map(x => ({ text: x.text, conf: x.confidence, x0: x.bbox.x0, x1: x.bbox.x1, y0: x.bbox.y0, y1: x.bbox.y1 })) });
    const got = WB.wordsFromOcr(lines, "en", s => dict.has(s));
    if (!got.length) { status("No words found. Turn the photo the right way up, make the box fit the words, or take a clearer photo in good light."); return; }
    words = got; isExample = false;
    renderChips(); show($("cropper"), false); srcCanvas = null;
    show($("panelBody"), false); show($("panelEmpty"), true);
    status(`Found ${got.length} word${got.length > 1 ? "s" : ""}. Tap one to learn it.`);
    $("chipSec").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    status(navigator.onLine === false ? "The first photo needs the internet to set up the reader. Connect and try again."
      : "Something went wrong reading the photo. Please try again.");
  } finally { setBusy(false); progressCb = null; }
});

/* ---------------- typed words ---------------- */
$("typeBtn").addEventListener("click", () => {
  const on = $("typeBox").hidden; show($("typeBox"), on); show($("cropper"), false);
  if (on) $("typeArea").focus();
});
$("typeGo").addEventListener("click", () => {
  const list = WB.wordsFromTyped($("typeArea").value.trim(), () => false);
  if (!list.length) return;
  words = list; isExample = false;
  renderChips(); show($("typeBox"), false); show($("panelBody"), false); show($("panelEmpty"), true);
  status(`Added ${list.length} word${list.length > 1 ? "s" : ""}. Tap one to learn it.`);
  $("typeArea").value = "";
});

/* ---------------- start ---------------- */
renderChips();
loadWords().catch(() => {});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
