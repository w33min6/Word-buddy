/* Word Buddy — English vocabulary helper for primary-school children.
   No accounts, no AI service.
   Meanings: Free Dictionary API (dictionaryapi.dev, from Wiktionary)
   "Everyday words" list: SUBTLEX-US top 8,000 words (common-words.txt)
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
const loadCommon = once(async () => {
  const m = new Map(); (await getText("common-words.txt")).split("\n").forEach((w, i) => m.set(w, i)); return m;
});
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

/* ---------------- choosing a child-friendly meaning ---------------- */
// senses we never show to a child, by label or content
const SKIP_LABEL = /\b(obsolete|archaic|dated|rare|slang|vulgar|offensive|derogatory|pejorative|historical|dialect(al)?|regional|nonstandard|informal|colloquial|euphemistic|jargon|law|legal|nautical|military|medicine|medical|anatomy|biology|chemistry|physics|mathematics|computing|finance|botany|zoology|heraldry|music theory|linguistics|grammar|philosophy|theology|uk|us|australia|scotland|ireland|canada|india|new zealand|south africa)\b/i;
const UNSAFE = /\b(sex|sexual|sexually|erotic|penis|vagina|genital|breast|naked|nude|drug|drugs|cocaine|heroin|alcohol|drunk|kill|killing|murder|suicide|corpse|prostitut\w*|rape|whore|bitch|damn|hell|fuck\w*|shit\w*|crap|bastard|weapon|gun|blood)\b/i;
const FORM_OF = /^(plural of|present participle of|past tense of|past participle of|simple past|third-person|alternative (form|spelling) of|obsolete (form|spelling) of|misspelling of|initialism of|abbreviation of|acronym of|comparative form of|superlative form of)\b/i;

function cleanDef(d) {
  let s = d.trim();
  // drop leading labels like "(transitive)" or "(figuratively, informal)"
  while (/^\([^)]*\)\s*/.test(s)) s = s.replace(/^\([^)]*\)\s*/, "");
  s = s.replace(/\s*\([^)]*\)/g, "");                 // other bracketed notes
  s = s.replace(/\s*;\s*[^;]*$/, m => (s.length > 90 ? "" : m)); // trim a long tail after a semicolon
  s = s.replace(/\bsomething\b/gi, "something").replace(/\bsomeone\b/gi, "someone");
  s = s.replace(/^Of,? relating to,? or (pertaining to|characteristic of) /i, "About ");
  s = s.replace(/^Of or (relating|pertaining) to /i, "About ");
  s = s.replace(/^(Relating|Pertaining) to /i, "About ");
  s = s.replace(/^Having the quality of being /i, "Being ");
  s = s.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  if (!s) return "";
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}
function easeScore(def, word, common) {
  // lower is easier: average "rarity" of the words used, plus a little for length
  const toks = def.toLowerCase().match(/[a-z']+/g) || [];
  if (!toks.length) return 1e9;
  const root = word.toLowerCase().slice(0, Math.max(4, word.length - 3));
  let rare = 0, n = 0;
  for (const t of toks) {
    if (t.length <= 2) continue;
    n++;
    if (t.startsWith(root)) { rare += 5; continue; }       // defining a word with itself doesn't help
    const r = common.has(t) ? common.get(t) : 12000;
    rare += Math.log10(r + 10);                             // 1 = very common ... 4 = rare
  }
  const avg = rare / Math.max(1, n);
  const len = toks.length;
  return avg + (len > 14 ? (len - 14) * 0.08 : 0);
}
function childSenses(entries, word, common) {
  const out = [];
  entries.forEach(e => (e.meanings || []).forEach((m, mi) => (m.definitions || []).forEach((d, di) => {
    const raw = d.definition || "";
    const labels = (raw.match(/^\(([^)]*)\)/) || [])[1] || "";
    if (SKIP_LABEL.test(labels) || UNSAFE.test(raw) || FORM_OF.test(raw.replace(/^\([^)]*\)\s*/, ""))) return;
    const text = cleanDef(raw);
    if (!text || text.split(" ").length > 28) return;
    // earlier senses are usually the main ones, so they get a small head start
    const score = easeScore(text, word, common) + mi * 1.2 + di * 0.4;
    out.push({ text, pos: m.partOfSpeech, score, example: d.example });
  })));
  out.sort((a, b) => a.score - b.score);
  const seen = new Set();
  return out.filter(s => { const k = s.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
}

/* ---------------- step 3: the word panel ---------------- */
let current = null, token = 0;
function note(t) { $("pNote").textContent = t; show($("pNote"), !!t); }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function renderMeaning() {
  const s = current.senses[current.senseIdx];
  $("pMean").textContent = s ? s.text : "";
  $("pPos").textContent = s ? s.pos : "";
  $("nextMean").hidden = current.senses.length < 2;
  $("sayMean").disabled = !s;
}
function renderExample() {
  const e = current, p = $("pEx"); p.textContent = "";
  const ex = e.examples;
  $("nextEx").disabled = ex.length < 2; $("sayEx").disabled = !ex.length;
  if (!ex.length) { p.textContent = e.loadingEx ? "Finding an example…" : "No example sentence found for this word."; return; }
  const s = ex[e.exIdx % ex.length];
  const parts = s.split(new RegExp("(" + escapeRe(e.matchWord) + "[a-z'-]*)", "i"));
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
  current = { word, senses: [], senseIdx: 0, examples: [], exIdx: 0, loadingEx: true, matchWord: stemRoot(word) };
  $("pWord").textContent = word; $("pSay").textContent = ""; $("pPos").textContent = "";
  $("pMean").textContent = "Finding the meaning…"; $("nextMean").hidden = true; $("sayMean").disabled = true;
  renderExample();
  speak(word, $("sayWord"));
  try {
    const [found, common] = await Promise.all([dictLookup(word), loadCommon()]);
    if (my !== token) return;
    if (!found) {
      $("pMean").textContent = "";
      note("This word or phrase isn't in the dictionary. Check the photo read it correctly, or look it up.");
    } else {
      const entries = found.data;
      const phon = entries.map(e => e.phonetic || (e.phonetics || []).map(p => p.text).find(Boolean)).find(Boolean);
      $("pSay").textContent = phon ? "(" + phon.replace(/^\/|\/$/g, "") + ")" : "";
      current.senses = childSenses(entries, found.base, common);
      if (!current.senses.length) note("The dictionary only has grown-up meanings for this word. Try “Look it up”.");
      if (found.base.toLowerCase() !== word.toLowerCase()) note("This is the meaning of “" + found.base + "”, the base word.");
      if (found.base.length < word.length) current.matchWord = stemRoot(found.base);
      renderMeaning();
      // dictionary examples that use everyday words come first
      current.examples = current.senses.map(s => s.example).filter(x => x && x.split(" ").length <= 16 && !UNSAFE.test(x)).map(cap);
    }
  } catch (err) {
    if (my !== token) return;
    $("pMean").textContent = "";
    note(navigator.onLine === false ? "You're offline. Meanings need the internet. You can still hear the word." : "Couldn't find the meaning just now. Tap the word to try again.");
  }
  try {
    const sents = await loadSentences();
    if (my !== token) return;
    const re = new RegExp("\\b" + escapeRe(current.matchWord) + "[a-z'-]*\\b", "i");
    const bank = pickExamples(sents.filter(s => re.test(s) && s.split(" ").length >= 5));
    current.examples = [...current.examples, ...bank.filter(b => !current.examples.includes(b))].slice(0, 6);
  } catch (e) {}
  if (my !== token) return;
  current.loadingEx = false;
  renderExample();
}

const enCache = new Map();
function stems(w) {
  const s = new Set([w]);
  const l = w.toLowerCase(); s.add(l);
  if (l.includes(" ")) { s.add(l.replace(/ /g, "-")); return [...s]; }
  const add = x => x.length > 2 && s.add(x);
  if (/ies$/.test(l)) add(l.slice(0, -3) + "y");
  if (/(ches|shes|sses|xes|zes)$/.test(l)) add(l.slice(0, -2));
  if (/s$/.test(l) && !/ss$/.test(l)) add(l.slice(0, -1));
  if (/ied$/.test(l)) add(l.slice(0, -3) + "y");
  if (/ed$/.test(l)) { add(l.slice(0, -2)); add(l.slice(0, -1)); if (/(.)\1ed$/.test(l)) add(l.slice(0, -3)); }
  if (/ing$/.test(l)) { add(l.slice(0, -3)); add(l.slice(0, -3) + "e"); if (/(.)\1ing$/.test(l)) add(l.slice(0, -4)); }
  if (/ly$/.test(l)) add(l.slice(0, -2));
  return [...s];
}
async function dictLookup(w) {
  const key = w.toLowerCase();
  if (enCache.has(key)) return enCache.get(key);
  for (const cand of stems(w)) {
    const res = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(cand));
    if (res.status === 404) continue;
    if (!res.ok) throw new Error("dict " + res.status);
    const out = { data: await res.json(), base: cand };
    enCache.set(key, out); return out;
  }
  enCache.set(key, null); return null;
}
function stemRoot(w) {
  const l = w.toLowerCase();
  if (l.includes(" ")) return l;
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
$("sayMean").addEventListener("click", () => { const s = current && current.senses[current.senseIdx]; if (s) speak(s.text, $("sayMean")); });
$("nextMean").addEventListener("click", () => { if (!current) return; current.senseIdx = (current.senseIdx + 1) % current.senses.length; stopSpeech(); renderMeaning(); });
$("sayEx").addEventListener("click", () => { if (current && current.examples.length) speak(current.examples[current.exIdx % current.examples.length], $("sayEx")); });
$("nextEx").addEventListener("click", () => { if (!current) return; current.exIdx = (current.exIdx + 1) % Math.max(1, current.examples.length); stopSpeech(); renderExample(); });

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
loadWords().catch(() => {}); loadCommon().catch(() => {});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
