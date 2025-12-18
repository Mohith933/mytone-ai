// app.js — MyTone AI M0.7
// Full frontend logic: voices, analyzer v2, waveform v2, presets, templates, fake voice cards, history, UI glue.

// ---------- Safe DOM helper ----------
const $ = id => document.getElementById(id);

// ---------- Nodes (may be null on other pages) ----------
const hamburgerBtn = $('hamburgerBtn');
const navLinks = $('nav-links');
const modeToggle = $('modeToggle');

const userInput = $('userInput');
const speakButton = $('speakButton');
const stopButton = $('stopButton');
const preview3sBtn = $('preview3sBtn');
const aiResponse = $('aiResponse');
const analyzerSuggestion = $('analyzerSuggestion');
const detectedEmotionLabel = $('detectedEmotionLabel');
const textPreview = $('textPreview');

const toneSelect = $('toneSelect');
const emotionSelect = $('emotionSelect');
const languageSelect = $('languageSelect');
const rateRange = $('rateRange');
const rateValue = $('rateValue');

const savePresetBtn = $('savePresetBtn');
const resetSettingsBtn = $('resetSettingsBtn');
const presetList = $('presetList');

const presetButtons = document.querySelectorAll('.preset-btn');
const templateButtons = document.querySelectorAll('.template-btn');

const historyList = $('historyList');
const clearHistoryBtn = $('clearHistoryBtn');

const waveCanvas = $('waveCanvas');

// UI Elements
const emotionA = $('emotionA');
const emotionB = $('emotionB');
const blendRange = $('blendRange');
const blendValue = $('blendValue');
const warmthRange = $('warmthRange');
const warmthValue = $('warmthValue');
const clarityRange = $('clarityRange');
const clarityValue = $('clarityValue');

const auditionBlendBtn = $('auditionBlendBtn');
const saveBlendPresetBtn = $('saveBlendPresetBtn');

const similarityScoreEl = $('similarityScore');
const similarityTip = $('similarityTip');
const tunerGraph = $('tunerGraph');
const tunerDot = $('tunerDot');
const autoVoiceBtns = document.querySelectorAll('.auto-voice');
const voiceSampleUpload = $('voiceSampleUpload');
const sampleInfo = $('sampleInfo');
const exportVoiceProfile = $('exportVoiceProfile');

// ---------- Globals ----------
const PRESETS_KEY = 'mytone_presets_v0.7';
const HISTORY_KEY = 'mytone_history_v0.7';
let synth = window.speechSynthesis;
let voices = [];
let canvasCtx = null;
let animating = false;
let frame = 0;

// ---------- Utilities ----------
function safeText(v){ return (v||'').toString(); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

// ---------- THEME (persist) ----------
(function initTheme(){
  try {
    const t = localStorage.getItem('theme');
    if (t === 'dark') document.body.classList.add('dark-mode');
    if (modeToggle) modeToggle.textContent = document.body.classList.contains('dark-mode') ? '☀️ Light Mode' : '🌙 Dark Mode';
  } catch(e){}
})();
if (modeToggle) {
  modeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    try { localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); } catch(e){}
    modeToggle.textContent = document.body.classList.contains('dark-mode') ? '☀️ Light Mode' : '🌙 Dark Mode';
  });
}

// ---------- NAVBAR / HAMBURGER ----------
if (hamburgerBtn && navLinks) {
  hamburgerBtn.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    hamburgerBtn.classList.toggle('active');
  });

  // close when clicking a nav link
  navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    navLinks.classList.remove('open'); hamburgerBtn.classList.remove('active');
  }));

  // click outside closes
  document.addEventListener('click', (e) => {
    if (!navLinks.contains(e.target) && !hamburgerBtn.contains(e.target)) {
      navLinks.classList.remove('open'); hamburgerBtn.classList.remove('active');
    }
  });
}

// ---------- VOICE LOADING ----------
function loadVoices() {
  voices = synth.getVoices() || [];
  if (!languageSelect) return;

  // prefer en-IN, te-IN, hi-IN, ta-IN if present; otherwise fallback to en-US or first available
  const prefer = ['en-IN','te-IN','hi-IN','ta-IN','en-US'];
  let chosen = null;
  for (const p of prefer) {
    if (voices.find(v => v.lang && v.lang.toLowerCase() === p.toLowerCase())) { chosen = p; break; }
  }
  if (!chosen && voices.length) chosen = voices[0].lang || 'en-US';
  // Clear and add one selected option (M0.7 uses single default language selection for simplicity)
  languageSelect.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = chosen || 'en-US';
  opt.textContent = `${opt.value} — ${voices.find(v => v.lang === opt.value)?.name ?? 'Default'}`;
  languageSelect.appendChild(opt);
}
if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
setTimeout(loadVoices, 300);

// ---------- RATE SLIDER ----------
if (rateRange && rateValue) {
  rateRange.addEventListener('input', () => {
    const v = parseFloat(rateRange.value);
    rateValue.textContent = `${v.toFixed(2)}x`;
  });
  // initialize
  rateValue.textContent = `${parseFloat(rateRange.value||1).toFixed(2)}x`;
}

// ---------- ANALYZER V2 ----------
function analyzeTextForEmotionV2(text) {
  if (!text) return 'normal';
  const t = text.toLowerCase();

  // heuristics: keywords, punctuation, length
  const scores = { happy:0, sad:0, angry:0, professional:0, soft:0, storytelling:0, question:0 };
  const words = t.split(/\s+/);

  // keywords
  const map = {
    happy: ['happy','joy','awesome','great','love','yay','congrats','amazing','cheerful','smile','excited'],
    sad: ['sad','sorry','unhappy','depressed','miss','regret','lonely','tear','cry'],
    angry: ['angry','hate','annoyed','furious','mad','rage','insult'],
    professional: ['dear','regards','sincerely','please find','attached','proposal','meeting','agenda'],
    soft: ['soft','gentle','kindly','please','calm','soothing'],
    storytelling: ['once','long ago','chapter','story','characters','journey']
  };
  Object.entries(map).forEach(([k,arr]) => {
    arr.forEach(w => { if (t.includes(w)) scores[k] += 2; });
  });

  // punctuation & structure
  if (t.includes('!')) scores.happy += 1;
  if (t.includes('?')) scores.question += 1;
  if (words.length > 200) scores.storytelling += 1;
  if (words.length < 6) scores.professional += 0.8;

  // compute winner (simple)
  let winner = 'normal';
  let maxScore = 0;
  Object.entries(scores).forEach(([k,v]) => {
    if (v > maxScore) { maxScore = v; winner = k; }
  });

  // map some meta labels
  if (winner === 'question') winner = 'questioning';
  if (winner === 'storytelling') winner = 'storytelling';
  if (maxScore === 0) winner = 'normal';
  return winner;
}

function prettyLabelForEmotion(e) {
  switch(e){
    case 'happy': return '😊 Happy';
    case 'sad': return '😢 Sad';
    case 'angry': return '😠 Angry';
    case 'professional': return '💼 Professional';
    case 'soft': return '🌬️ Soft';
    case 'storytelling': return '📖 Storytelling';
    case 'questioning': return '❓ Questioning';
    default: return '—';
  }
}

function highlightTextEmotionV2(text, emotion) {
  if (!textPreview) return;
  textPreview.className = 'text-highlight';
  textPreview.classList.remove('hl-happy','hl-sad','hl-excited','hl-calm','hl-angry','hl-professional','hl-storytelling');
  if (emotion === 'happy') textPreview.classList.add('hl-happy');
  if (emotion === 'sad') textPreview.classList.add('hl-sad');
  if (emotion === 'energetic') textPreview.classList.add('hl-excited');
  if (emotion === 'calm') textPreview.classList.add('hl-calm');
  if (emotion === 'angry') textPreview.classList.add('hl-angry');
  if (emotion === 'professional') textPreview.classList.add('hl-professional');
  if (emotion === 'storytelling') textPreview.classList.add('hl-storytelling');

  textPreview.textContent = text || '';
  if (detectedEmotionLabel) detectedEmotionLabel.textContent = `Detected: ${prettyLabelForEmotion(emotion)}`;
  if (analyzerSuggestion) analyzerSuggestion.textContent = emotion === 'normal' ? 'No strong emotion' : emotion;
}

// ---------- CANVAS / WAVE V2 ----------
function setupCanvas() {
  if (!waveCanvas) return;
  if (!waveCanvas.getContext) return;
  canvasCtx = waveCanvas.getContext('2d');
  resizeCanvas();
  canvasCtx.setTransform(1,0,0,1,0,0);
}
function resizeCanvas() {
  if (!waveCanvas || !canvasCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(waveCanvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(waveCanvas.clientHeight * dpr));
  if (waveCanvas.width !== w || waveCanvas.height !== h) {
    waveCanvas.width = w; waveCanvas.height = h;
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
window.addEventListener('resize', () => { try { resizeCanvas(); } catch(e){} });

// multi-layer smooth waves
function drawWaveMulti(intensity = 1, emotion='normal') {
  if (!canvasCtx || !waveCanvas) return;
  const w = waveCanvas.clientWidth || (waveCanvas.width/(window.devicePixelRatio||1));
  const h = waveCanvas.clientHeight || (waveCanvas.height/(window.devicePixelRatio||1));
  canvasCtx.clearRect(0,0,waveCanvas.width,waveCanvas.height);

  // emotion color mapping
  let baseColor = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#3B82F6';
  if (emotion === 'happy') baseColor = '#ffd166';
  if (emotion === 'sad') baseColor = '#8aa0ff';
  if (emotion === 'angry') baseColor = '#ff7b7b';
  if (emotion === 'storytelling') baseColor = '#c084fc';

  // three layered sine waves
  const layers = [
    { amp: 0.22 * intensity, freq: 0.8, speed: 0.015, alpha: 0.18, offset: 0 },
    { amp: 0.14 * intensity, freq: 1.6, speed: 0.022, alpha: 0.28, offset: 30 },
    { amp: 0.08 * intensity, freq: 3.0, speed: 0.039, alpha: 0.42, offset: 60 }
  ];

  layers.forEach((L, idx) => {
    canvasCtx.beginPath();
    const phase = frame * L.speed + L.offset;
    for (let x = 0; x <= w; x += 4) {
      const normX = x / w;
      const y = h/2 + Math.sin(normX * Math.PI * L.freq + phase) * (h * L.amp);
      if (x === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
    }
    canvasCtx.lineWidth = 2 + idx;
    // apply color variant
    canvasCtx.strokeStyle = hexToRgba(baseColor, L.alpha);
    canvasCtx.stroke();
  });
}

// small helper to convert hex or rgb string to rgba
function hexToRgba(input, alpha=1){
  if (!input) return `rgba(59,130,246,${alpha})`;
  input = input.trim();
  // if already rgba or rgb
  if (input.startsWith('rgba') || input.startsWith('rgb')) {
    // replace alpha if present
    if (input.startsWith('rgba')) return input;
    // rgb(...) -> rgba(...)
    return input.replace('rgb','rgba').replace(')',`,${alpha})`);
  }
  // hex -> rgba
  const hex = input.replace('#','');
  const bigint = parseInt(hex.length === 3 ? hex.split('').map(s => s+s).join('') : hex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function animateWave(intensity=1, emotion='normal') {
  animating = true;
  function step(){
    if (!animating) return;
    frame++;
    drawWaveMulti(intensity, emotion);
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function stopWave() {
  animating = false;
  if (canvasCtx && waveCanvas) canvasCtx.clearRect(0,0,waveCanvas.width,waveCanvas.height);
}

// ---------- EMOTION SETTINGS (apply to utterance) ----------
function applyEmotionSettings(utter, emotion) {
  utter.pitch = utter.pitch || 1;
  utter.rate = utter.rate || 1;
  utter.volume = (typeof utter.volume === 'number') ? utter.volume : 1;

  switch (emotion) {
    case 'happy': utter.pitch *= 1.25; utter.rate *= 1.15; utter.volume = 1; break;
    case 'sad': utter.pitch *= 0.85; utter.rate *= 0.9; utter.volume = 0.9; break;
    case 'friendly': utter.pitch *= 1.12; utter.rate *= 1.03; utter.volume = 1; break;
    case 'soft': utter.pitch *= 0.95; utter.rate *= 0.9; utter.volume = 0.82; break;
    case 'energetic': utter.pitch *= 1.35; utter.rate *= 1.3; utter.volume = 1; break;
    case 'calm': utter.pitch *= 0.9; utter.rate *= 0.92; utter.volume = 0.95; break;
    case 'professional': utter.pitch *= 0.98; utter.rate *= 1; utter.volume = 1; break;
    case 'storytelling': utter.pitch *= 1.05; utter.rate *= 0.93; utter.volume = 0.98; break;
    default: break;
  }
}

// ---------- SPEAK LOGIC ----------
function speakNow(text, opts={}) {
  if (!text || !text.trim()) {
    if (aiResponse) aiResponse.textContent = 'Please enter text to speak.';
    return;
  }

  // compute params
  const selectedLang = languageSelect && languageSelect.value ? languageSelect.value : 'en-US';
  const basePitch = opts.tone ? parseFloat(opts.tone) : (toneSelect ? parseFloat(toneSelect.value||'1') : 1);
  const rate = opts.rate ? parseFloat(opts.rate) : (rateRange ? parseFloat(rateRange.value||1) : 1);
  const emotion = opts.emotion ? opts.emotion : (emotionSelect ? emotionSelect.value : 'normal');

  // voice pick
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = selectedLang;
  utter.pitch = clamp(basePitch, 0.1, 2.0);
  utter.rate = clamp(rate, 0.5, 2.0);

  // choose best matching voice if available
  if (voices && voices.length) {
    let match = voices.find(v => v.lang && v.lang.toLowerCase() === utter.lang.toLowerCase());
    if (!match) match = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(utter.lang.split('-')[0]));
    if (!match) match = voices.find(v => /en/.test(v.lang)) || voices[0];
    if (match) utter.voice = match;
  }

  // apply emotion modifiers
  applyEmotionSettings(utter, emotion);

  // speak
  try { speechSynthesis.cancel(); } catch(e){}
  try { speechSynthesis.speak(utter); } catch(e) {
    if (aiResponse) aiResponse.textContent = 'Speech failed in this browser.';
    return;
  }

  if (aiResponse) aiResponse.textContent = 'Speaking…';
  animateWave(1.0, emotion);

  // add to history
  addHistory({ text, tone: utter.pitch, rate: utter.rate, emotion, ts: Date.now() });

  utter.onend = () => {
    if (aiResponse) aiResponse.textContent = 'Finished';
    stopWave();
  };
  utter.onerror = () => {
    if (aiResponse) aiResponse.textContent = 'Speech error';
    stopWave();
  };
}

// wrapper from UI
function speakWrapper() {
  const text = userInput ? userInput.value : '';
  const auto = analyzeTextForEmotionV2(text);
  if (analyzerSuggestion) analyzerSuggestion.textContent = auto === 'normal' ? 'No strong emotion' : prettyLabelForEmotion(auto);
  highlightTextEmotionV2(text, auto);
  const tone = toneSelect ? toneSelect.value : '1';
  const emotion = emotionSelect ? emotionSelect.value : auto;
  const rate = rateRange ? rateRange.value : '1';
  speakNow(text, { tone, emotion, rate });
}

// 3s preview (first ~3 seconds)
if (preview3sBtn) preview3sBtn.addEventListener('click', () => {
  const text = userInput ? userInput.value : '';
  const preview = text && text.length > 120 ? text.slice(0, 120) : text;
  speakNow(preview, { tone: toneSelect ? toneSelect.value : '1', emotion: emotionSelect ? emotionSelect.value : 'normal', rate: rateRange ? rateRange.value : '1' });
});

if (speakButton) speakButton.addEventListener('click', speakWrapper);
if (stopButton) stopButton.addEventListener('click', ()=> { try { speechSynthesis.cancel(); } catch(e){} stopWave(); if (aiResponse) aiResponse.textContent='Stopped'; });

// ---------- PRESETS (localStorage) ----------
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch(e){ return []; }
}
function savePresets(arr) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(arr)); } catch(e){} }
function renderPresetList() {
  if (!presetList) return;
  const arr = loadPresets();
  presetList.innerHTML = '';
  if (!arr.length) { presetList.innerHTML = '<div class="small muted">No saved presets</div>'; return; }
  arr.forEach((p, idx) => {
    const el = document.createElement('div'); el.className='preset-item';
    el.innerHTML = `<div><strong>${escapeHtml(p.name)}</strong><div class="small muted">${p.toneLabel} · ${p.emotion} · ${p.rate}x</div></div>
      <div>
        <button data-load="${idx}" class="btn-secondary">Load</button>
        <button data-delete="${idx}" class="btn-secondary">Delete</button>
      </div>`;
    presetList.appendChild(el);
  });
  // attach events
  presetList.querySelectorAll('[data-load]').forEach(btn => btn.addEventListener('click', () => {
    const i = parseInt(btn.getAttribute('data-load'));
    const p = loadPresets()[i];
    if (!p) return;
    if (toneSelect) toneSelect.value = p.tone;
    if (emotionSelect) emotionSelect.value = p.emotion;
    if (rateRange) rateRange.value = p.rate;
    if (rateValue) rateValue.textContent = `${parseFloat(p.rate).toFixed(2)}x`;
    if (aiResponse) aiResponse.textContent = `Loaded preset: ${p.name}`;
  }));
  presetList.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => {
    const i = parseInt(btn.getAttribute('data-delete'));
    const arr = loadPresets(); const removed = arr.splice(i,1); savePresets(arr); renderPresetList();
    if (aiResponse) aiResponse.textContent = `Deleted preset: ${removed[0]?.name ?? 'preset'}`;
  }));
}
function escapeHtml(s) { return safeText(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

if (savePresetBtn) savePresetBtn.addEventListener('click', () => {
  const name = prompt('Preset name:','My Preset');
  if (!name) { if (aiResponse) aiResponse.textContent = 'Preset save cancelled'; return; }
  const tone = toneSelect ? toneSelect.value : '1';
  const toneLabel = toneSelect ? toneSelect.options[toneSelect.selectedIndex].text : 'Medium';
  const emotion = emotionSelect ? emotionSelect.value : 'normal';
  const rate = rateRange ? rateRange.value : '1';
  const arr = loadPresets();
  arr.push({ name, tone, toneLabel, emotion, rate, created: Date.now() });
  savePresets(arr); renderPresetList();
  if (aiResponse) aiResponse.textContent = `Saved preset: ${name}`;
});
if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', () => {
  if (toneSelect) toneSelect.value = '1';
  if (emotionSelect) emotionSelect.value = 'normal';
  if (rateRange) rateRange.value = '1';
  if (rateValue) rateValue.textContent = '1.00x';
  if (aiResponse) aiResponse.textContent = 'Settings reset';
});
renderPresetList();

// ---------- TEMPLATES ----------
const templates = {
  podcast: "Welcome back to the show. I'm your host — and today we have a fantastic topic. Let's dive in!",
  narration: "Once upon a time, in a quiet village, there lived a storyteller who could make the sun listen.",
  product: "Introducing our new product — engineered for speed, built for reliability, and designed for you.",
  presentation: "Good morning everyone. Thank you for joining. Today I'm excited to share our progress."
};
templateButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.getAttribute('data-template');
    if (!templates[key]) return;
    if (userInput) userInput.value = templates[key];
    if (aiResponse) aiResponse.textContent = `Template loaded: ${key}`;
    const auto = analyzeTextForEmotionV2(templates[key]);
    highlightTextEmotionV2(templates[key], auto);
    if (analyzerSuggestion) analyzerSuggestion.textContent = prettyLabelForEmotion(auto);
  });
});

// ---------- FAKE VOICE CARDS (preset buttons) ----------
presetButtons.forEach(b => {
  b.addEventListener('click', () => {
    const p = b.dataset.preset;

    const map = {
  'mytone-male': {
    tone: '0.8',
    emotion: 'normal',
    rate: 0.95
  },
  'mytone-female': {
    tone: '1.3',
    emotion: 'friendly',
    rate: 1.05
  },
  'mytone-neutral': {
    tone: '1',
    emotion: 'normal',
    rate: 1.0
  }
};


    const cfg = map[p];
    if (!cfg) return;

    toneSelect.value = cfg.tone;
    emotionSelect.value = cfg.emotion;

    rateRange.value = cfg.rate;
    rateValue.textContent = `${cfg.rate.toFixed(2)}x`;

    aiResponse.textContent = `Applied voice card: ${p.replace('mytone-', '')}`;
  });
});


// ---------- HISTORY ----------
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch(e){ return []; } }
function saveHistory(arr) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch(e){} }
function addHistory(item) {
  const h = loadHistory(); h.unshift(item); if (h.length > 40) h.pop(); saveHistory(h); renderHistory();
}
function renderHistory() {
  if (!historyList) return;
  const h = loadHistory();
  historyList.innerHTML = '';
  if (!h.length) { historyList.innerHTML = '<div class="small muted">No history yet</div>'; return; }
  h.forEach((it, idx) => {
    const row = document.createElement('div'); row.className = 'history-item';
    row.innerHTML = `<div style="flex:1"><div class="small muted">${new Date(it.ts).toLocaleString()}</div><div>${escapeHtml((it.text||'').slice(0,120))}</div></div>
      <div style="display:flex;gap:6px">
        <button class="btn-primary" data-replay="${idx}">Play</button>
        <button class="btn-secondary" data-copy="${idx}">Copy</button>
      </div>`;
    historyList.appendChild(row);
  });
  historyList.querySelectorAll('[data-replay]').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.getAttribute('data-replay')); const h = loadHistory(); if (!h[i]) return;
    if (userInput) userInput.value = h[i].text;
    speakNow(h[i].text, { tone: h[i].tone, emotion: h[i].emotion, rate: h[i].rate });
  }));
  historyList.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.getAttribute('data-copy')); const h = loadHistory(); if (!h[i]) return;
    try { navigator.clipboard.writeText(h[i].text); if (aiResponse) aiResponse.textContent = 'Copied to clipboard'; } catch(e){}
  }));
}
if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => { try { localStorage.removeItem(HISTORY_KEY); } catch(e){} renderHistory(); });
renderHistory();

// ---------- VOICE LISTEN (load voices repeatedly) ----------
function tryLoadVoices() {
  voices = speechSynthesis.getVoices() || [];
  if (!languageSelect) return;
  // try to keep existing selection if possible
  const current = languageSelect.value;
  languageSelect.innerHTML = '';
  const prefer = ['en-IN','te-IN','hi-IN','ta-IN','en-US'];
  let chosen = current || null;
  for (const p of prefer) {
    if (voices.find(v => v.lang && v.lang.toLowerCase() === p.toLowerCase())) { chosen = p; break; }
  }
  if (!chosen && voices.length) chosen = voices[0].lang || 'en-US';
  const opt = document.createElement('option'); opt.value = chosen; opt.textContent = `${opt.value} — ${voices.find(v=>v.lang===opt.value)?.name ?? 'Default'}`;
  languageSelect.appendChild(opt);
}
setTimeout(tryLoadVoices,300);
if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged = tryLoadVoices;

// ---------- STARTUP: canvas + event glue ----------
window.addEventListener('load', () => {
  try { setupCanvas(); } catch(e){}
  tryLoadVoices();
  if (userInput) {
    userInput.addEventListener('input', () => {
      const txt = userInput.value || '';
      const auto = analyzeTextForEmotionV2(txt);
      if (analyzerSuggestion) analyzerSuggestion.textContent = auto === 'normal' ? 'No strong emotion' : prettyLabelForEmotion(auto);
      highlightTextEmotionV2(txt, auto);
    });
  }
});

// ensure canvas setup even if script ran earlier
try { setupCanvas(); } catch(e){}

// ---------- small accessibility helpers ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { // Ctrl+Enter to speak
    speakWrapper();
  }
  });


// Storage Key for Blend Presets
const BLEND_PRESETS_KEY = "mytone_blends_v0.8";

// ------------------------------
// Update slider labels
// ------------------------------
if (blendRange && blendValue) {
  blendRange.addEventListener("input", () => {
    blendValue.textContent = `${blendRange.value}%`;
  });
}

if (warmthRange && warmthValue) {
  warmthRange.addEventListener("input", () => {
    warmthValue.textContent = parseFloat(warmthRange.value).toFixed(2);
  });
}

if (clarityRange && clarityValue) {
  clarityRange.addEventListener("input", () => {
    clarityValue.textContent = parseFloat(clarityRange.value).toFixed(2);
  });
}

// ------------------------------
// Emotion → numeric modifiers
// ------------------------------
function emotionToParams(emotion) {
  switch (emotion) {
    case "happy": return { pitch: 1.25, rate: 1.1 };
    case "sad": return { pitch: 0.85, rate: 0.9 };
    case "friendly": return { pitch: 1.15, rate: 1.0 };
    case "soft": return { pitch: 0.95, rate: 0.9 };
    case "energetic": return { pitch: 1.35, rate: 1.25 };
    case "calm": return { pitch: 0.9, rate: 0.92 };
    case "normal": default: return { pitch: 1, rate: 1 };
  }
}

// ------------------------------
// Blend Engine
// ------------------------------
function computeBlend() {
  const A = emotionToParams(emotionA.value);
  const B = emotionToParams(emotionB.value);
  const blend = blendRange ? parseInt(blendRange.value) / 100 : 0.5;

  // Linear interpolation
  const pitch = A.pitch * (1 - blend) + B.pitch * blend;
  const rate = A.rate * (1 - blend) + B.rate * blend;

  // Warmth = softer voice → reduce harshness
  const warmth = parseFloat(warmthRange?.value || 1);
  const clarity = parseFloat(clarityRange?.value || 1);

  return {
    pitch: pitch * warmth,
    rate: rate * clarity,
    emotion: `${emotionA.value}+${emotionB.value}@${blendRange.value}`
  };
}

// ------------------------------
// Audition Blend
// ------------------------------
if (auditionBlendBtn) {
  auditionBlendBtn.addEventListener("click", () => {
    const blend = computeBlend();
    const text = userInput ? userInput.value : "This is your blended voice preview.";

    speakNow(text, {
      tone: blend.pitch,
      rate: blend.rate,
      emotion: "normal"  // emotion handled by blend
    });

    if (aiResponse)
      aiResponse.textContent = `Auditioning blend: ${blend.emotion}`;
  });
}

// ------------------------------
// Save Blend Preset
// ------------------------------
function loadBlendPresets() {
  try { return JSON.parse(localStorage.getItem(BLEND_PRESETS_KEY) || "[]"); }
  catch (e) { return []; }
}

function saveBlendPresets(arr) {
  try { localStorage.setItem(BLEND_PRESETS_KEY, JSON.stringify(arr)); }
  catch (e) {}
}

if (saveBlendPresetBtn) {
  saveBlendPresetBtn.addEventListener("click", () => {
    const name = prompt("Blend Preset Name:", "My Blend");
    if (!name) return;

    const blend = computeBlend();
    const arr = loadBlendPresets();
    arr.push({
      name,
      pitch: blend.pitch,
      rate: blend.rate,
      emotion: blend.emotion,
      ts: Date.now()
    });
    saveBlendPresets(arr);

    if (aiResponse)
      aiResponse.textContent = `Saved blend preset: ${name}`;
  });
}

// fallback getters to use existing controls
function getTone() { return parseFloat(toneSelect?.value || 1); }
function getRate() { return parseFloat(rateRange?.value || 1); }
function getEmotion() { return emotionSelect?.value || 'normal'; }

// ============================================================
// 1) SIMILARITY SCORE — Fake ML Scoring
// ============================================================
function computeFakeSimilarity(text) {
  if (!text) return 0;

  let score = 50;

  // length = clarity score
  if (text.length > 150) score += 10;
  if (text.length < 40) score -= 10;

  // tone effect
  const t = getTone();
  if (t > 1.2) score += 8;
  if (t < 0.9) score -= 6;

  // emotion shine
  const em = getEmotion();
  if (['friendly', 'happy', 'energetic'].includes(em)) score += 5;
  if (['sad', 'soft'].includes(em)) score -= 2;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function updateSimilarity() {
  if (!similarityScoreEl) return;
  const text = userInput?.value || "";
  const score = computeFakeSimilarity(text);

  similarityScoreEl.textContent = score + "%";

  if (score > 80) similarityTip.textContent = "Great match — strong style!";
  else if (score > 60) similarityTip.textContent = "Good match — keep refining.";
  else similarityTip.textContent = "Weak match — adjust tone & speed.";
}

// update on text input
if (userInput) {
  userInput.addEventListener("input", updateSimilarity);
}

// ============================================================
// 2) TUNER GRAPH — Drag Dot (Tone → X, Speed → Y)
// ============================================================
let dragging = false;

if (tunerDot && tunerGraph) {
  tunerDot.addEventListener("mousedown", () => dragging = true);
  document.addEventListener("mouseup", () => dragging = false);

  tunerGraph.addEventListener("mousemove", (e) => {
    if (!dragging) return;

    const rect = tunerGraph.getBoundingClientRect();
    let x = e.clientX - rect.left;   // tone axis
    let y = e.clientY - rect.top;    // rate axis

    // clamp inside box
    x = Math.max(0, Math.min(rect.width, x));
    y = Math.max(0, Math.min(rect.height, y));

    // move dot
    tunerDot.style.left = x + "px";
    tunerDot.style.top = y + "px";

    // map X → tone (0.8 to 1.3)
    const toneMin = 0.8, toneMax = 1.3;
    const toneVal = toneMin + (x / rect.width) * (toneMax - toneMin);
    if (toneSelect) toneSelect.value = toneVal.toFixed(2);

    // map Y → rate (0.8 to 1.3)
    const rateMin = 0.8, rateMax = 1.3;
    const rateVal = rateMin + (1 - y / rect.height) * (rateMax - rateMin);
    if (rateRange) {
      rateRange.value = rateVal.toFixed(2);
      rateValue.textContent = rateVal.toFixed(2) + "x";
    }

    updateSimilarity();
  });
}

// ============================================================
// 3) AUTO VOICE GENERATOR (Fake Styles)
// ============================================================
const autoMap = {
  "deep-male":        { tone: 0.85, rate: 0.9,  emotion: "professional" },
  "clear-female":     { tone: 1.20, rate: 1.05, emotion: "friendly" },
  "energetic-host":   { tone: 1.30, rate: 1.2,  emotion: "energetic" },
  "narrator":         { tone: 1.05, rate: 0.95, emotion: "storytelling" },
  "calm-assistant":   { tone: 0.95, rate: 0.92, emotion: "calm" }
};

autoVoiceBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.v;
    const cfg = autoMap[key];
    if (!cfg) return;

    // apply tone
    if (toneSelect) toneSelect.value = cfg.tone;
    // apply rate
    if (rateRange) {
      rateRange.value = cfg.rate;
      rateValue.textContent = cfg.rate.toFixed(2) + "x";
    }
    // apply emotion
    if (emotionSelect) emotionSelect.value = cfg.emotion;

    updateSimilarity();

    if (aiResponse) aiResponse.textContent = `Applied auto-voice: ${key}`;
  });
});

// ============================================================
// 4) SAMPLE UPLOAD — Fake Reader + Size Info
// ============================================================
if (voiceSampleUpload) {
  voiceSampleUpload.addEventListener("change", () => {
    const f = voiceSampleUpload.files[0];
    if (!f) {
      sampleInfo.textContent = "No file uploaded.";
      return;
    }

    const sizeKB = (f.size / 1024).toFixed(1);
    sampleInfo.textContent = `Uploaded: ${f.name} (${sizeKB} KB)`;

    // no real audio ML here, only frontend
    similarityTip.textContent = "Sample loaded — ready for comparison.";
  });
}

// ============================================================
// 5) EXPORT VOICE PROFILE — JSON
// ============================================================
if (exportVoiceProfile) {
  exportVoiceProfile.addEventListener("click", () => {
    const profile = {
      version: "M0.9",
      tone: getTone(),
      rate: getRate(),
      emotion: getEmotion(),
      sampleUploaded: voiceSampleUpload?.files?.length ? true : false,
      created: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(profile, null, 2)], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mytone_voice_profile.json";
    a.click();
    URL.revokeObjectURL(url);

    if (aiResponse) aiResponse.textContent = "Voice profile exported.";
  });
}

// final trigger
updateSimilarity();


