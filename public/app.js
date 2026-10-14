// VideoStudio front-end (vanilla JS)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};
const clone = (o) => structuredClone(o);
const deepMerge = (base, over) => {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v;
  }
  return out;
};
const fmtTime = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
/** m:ss.d — precise time for the timeline / subtitle editor */
const fmtTimeP = (s) => {
  s = Math.max(0, Math.floor(s * 10) / 10);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const BASE_TITLE = document.title;
const SVG_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const SVG_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

const ICONS = {
  'tiktok-viral': '🔥', 'shorts-clean': '▶️', podcast: '🎙️', cinematic: '🎬', vintage: '📼', bw: '🖤',
  vlog: '☀️', 'dreamy-slowmo': '🌸', timelapse: '⏩', boomerang: '🔁', moody: '🌧️', 'insta-square': '📸', custom: '✨',
};
const COLOR_NAMES = {
  cinematic: 'Điện ảnh', vintage: 'Vintage', bw: 'Đen trắng', vivid: 'Rực rỡ', warm: 'Ấm áp', cool: 'Lạnh', moody: 'Moody', dreamy: 'Mơ màng',
};
const pct = (v) => Math.round(v * 100) + '%';

// CSS approximations of the FFmpeg colour presets (used for the live preview + user template thumbnails)
const LIVE_COLOR = {
  cinematic: [['contrast', 1.1], ['saturate', 0.85], ['sepia', 0.12], ['hue-rotate', -8]],
  vintage: [['sepia', 0.45], ['contrast', 1.05], ['saturate', 0.8], ['brightness', 1.03]],
  bw: [['grayscale', 1], ['contrast', 1.2], ['brightness', 0.98]],
  vivid: [['saturate', 1.45], ['contrast', 1.06]],
  warm: [['sepia', 0.16], ['saturate', 1.2], ['brightness', 1.04]],
  cool: [['hue-rotate', 10], ['saturate', 1.06], ['brightness', 1.02]],
  moody: [['brightness', 0.9], ['saturate', 0.7], ['contrast', 1.12], ['hue-rotate', -6]],
  dreamy: [['brightness', 1.08], ['saturate', 0.95], ['contrast', 0.92], ['blur', 0.4]],
};
const IDENT = { contrast: 1, saturate: 1, sepia: 0, 'hue-rotate': 0, grayscale: 0, brightness: 1, blur: 0 };
const UNIT = { 'hue-rotate': 'deg', blur: 'px' };
function liveFilter(color) {
  if (!color?.enabled) return '';
  const k = color.intensity ?? 1;
  return LIVE_COLOR[color.preset].map(([f, v]) => `${f}(${(IDENT[f] + (v - IDENT[f]) * k).toFixed(3)}${UNIT[f] || ''})`).join(' ');
}

// ---------- Section schema for the "Tinh chỉnh" panel ----------
const SECTIONS = [
  { key: 'format', icon: '📐', title: 'Khung hình', summary: (c) => `${c.ratio} · ${{ blur: 'nền mờ', crop: 'cắt đầy', fit: 'viền đen' }[c.mode]}`,
    fields: [
      { k: 'ratio', type: 'seg', label: 'Tỉ lệ', options: [['9:16', '9:16 Dọc'], ['1:1', '1:1 Vuông'], ['4:5', '4:5'], ['16:9', '16:9 Ngang']] },
      { k: 'mode', type: 'seg', label: 'Cách lấp khung', options: [['blur', 'Nền mờ'], ['crop', 'Cắt đầy khung'], ['fit', 'Viền đen']] },
    ] },
  { key: 'color', icon: '🎨', title: 'Màu sắc', summary: (c) => COLOR_NAMES[c.preset] + (c.intensity < 1 ? ` · ${pct(c.intensity)}` : ''),
    fields: [
      { k: 'preset', type: 'seg', label: 'Bộ lọc', options: Object.entries(COLOR_NAMES) },
      { k: 'intensity', type: 'range', label: 'Cường độ', min: 0.1, max: 1, step: 0.05, fmt: pct },
    ] },
  { key: 'film', icon: '🎞️', title: 'Hiệu ứng phim', summary: (c) => [c.grain ? `hạt ${c.grain}` : '', c.vignette ? 'vignette' : '', c.letterbox ? 'letterbox' : ''].filter(Boolean).join(' · ') || 'không',
    fields: [
      { k: 'grain', type: 'range', label: 'Hạt phim (grain)', min: 0, max: 30, step: 1 },
      { k: 'vignette', type: 'check', label: 'Tối 4 góc (vignette)' },
      { k: 'letterbox', type: 'check', label: 'Viền đen điện ảnh trên/dưới' },
    ] },
  { key: 'jumpcut', icon: '✂️', title: 'Cắt khoảng lặng', summary: (c) => `${c.threshold}dB · lặng > ${c.minSilence}s`,
    liveNote: 'Cắt lặng không mô phỏng trực tiếp được — bấm "Xem trước 8s" để nghe thử.',
    fields: [
      { k: 'threshold', type: 'range', label: 'Ngưỡng im lặng', hint: 'cao hơn = cắt nhiều hơn', min: -50, max: -20, step: 1, fmt: (v) => v + ' dB' },
      { k: 'minSilence', type: 'range', label: 'Chỉ cắt khi lặng lâu hơn', min: 0.2, max: 2, step: 0.1, fmt: (v) => v + 's' },
      { k: 'padding', type: 'range', label: 'Chừa lề mỗi đoạn', min: 0, max: 0.4, step: 0.05, fmt: (v) => v + 's' },
    ] },
  { key: 'subtitles', icon: '💬', title: 'Phụ đề AI', needsKey: true,
    summary: (c) => ({ tiktok: 'Nhảy chữ TikTok', classic: 'Nền đen', minimal: 'Tối giản' }[c.style]) +
      (c.position === 'auto' ? ' · 🤖 Né mặt' : ` · ${c.position}`) +
      (state.captions ? ` · đã chép ${state.captions.list.length} câu` : ''),
    fields: [
      { type: 'subsEditor' },
      { k: 'style', type: 'seg', label: 'Kiểu phụ đề', options: [['tiktok', 'Nhảy chữ TikTok'], ['classic', 'Nền đen'], ['minimal', 'Tối giản']] },
      { k: 'position', type: 'seg', label: 'Vị trí phụ đề', options: [['auto', '🤖 Tự động (AI né mặt)'], ['bottom', 'Dưới'], ['middle', 'Giữa'], ['top', 'Trên']] },
      { k: 'smartAnalysis', type: 'check', label: 'AI phân tích bố cục an toàn né mặt' },
      { k: 'highlightKeywords', type: 'check', label: 'Nổi bật từ khoá đắt giá (màu neon)' },
      { k: 'emojis', type: 'check', label: 'Tự động chèn emoji theo cảm xúc' },
      { k: 'uppercase', type: 'check', label: 'VIẾT HOA TOÀN BỘ' },
    ] },
  { key: 'speed', icon: '⚡', title: 'Tốc độ', summary: (c) => `${c.factor}x${c.mute ? ' · tắt tiếng' : ''}`,
    fields: [
      { k: 'factor', type: 'range', label: 'Tốc độ phát', min: 0.25, max: 4, step: 0.25, fmt: (v) => v + 'x' },
      { k: 'mute', type: 'check', label: 'Tắt tiếng gốc' },
    ] },
  { key: 'boomerang', icon: '🔁', title: 'Boomerang', summary: (c) => `${c.length}s đầu, tới-lui`,
    liveNote: 'Boomerang chỉ thấy khi "Xem trước 8s" hoặc xuất.',
    fields: [{ k: 'length', type: 'range', label: 'Độ dài đoạn lặp', min: 1, max: 5, step: 0.5, fmt: (v) => v + 's' }] },
  { key: 'title', icon: '🔤', title: 'Tiêu đề mở đầu', summary: (c) => `"${c.text}"`,
    fields: [
      { k: 'text', type: 'text', label: 'Nội dung', placeholder: 'Tiêu đề video' },
      { k: 'duration', type: 'range', label: 'Hiển thị', min: 1, max: 8, step: 0.5, fmt: (v) => v + 's' },
      { k: 'position', type: 'seg', label: 'Vị trí', options: [['top', 'Trên'], ['center', 'Giữa'], ['bottom', 'Dưới']] },
    ] },
  { key: 'watermark', icon: '©️', title: 'Watermark', summary: (c) => c.text,
    fields: [
      { k: 'text', type: 'text', label: 'Chữ ký / tên kênh', placeholder: '@ten_cua_ban' },
      { k: 'position', type: 'seg', label: 'Góc', options: [['top-left', '↖ Trên trái'], ['top-right', '↗ Trên phải'], ['bottom-left', '↙ Dưới trái'], ['bottom-right', '↘ Dưới phải']] },
    ] },
  { key: 'outro', icon: '🎬', title: 'Outro kết thúc', summary: (c) => `"${c.text}" · ${c.duration}s`,
    fields: [
      { k: 'text', type: 'text', label: 'Lời kết', placeholder: 'Cảm ơn đã xem!' },
      { k: 'duration', type: 'range', label: 'Thời lượng', min: 1, max: 8, step: 0.5, fmt: (v) => v + 's' },
    ] },
  { key: 'fade', icon: '🌗', title: 'Mờ dần đầu / cuối', summary: (c) => `${c.duration}s`,
    fields: [{ k: 'duration', type: 'range', label: 'Thời gian mờ', min: 0.2, max: 3, step: 0.1, fmt: (v) => v + 's' }] },
  { key: 'music', icon: '🎵', title: 'Nhạc nền', summary: (c) => c.fileName || 'chưa chọn nhạc',
    fields: [
      { type: 'music' },
      { k: 'volume', type: 'range', label: 'Âm lượng nhạc', min: 0, max: 1.5, step: 0.05, fmt: pct },
      { k: 'originalVolume', type: 'range', label: 'Âm lượng tiếng gốc', min: 0, max: 1.5, step: 0.05, fmt: pct },
      { k: 'ducking', type: 'check', label: 'Tự giảm nhạc khi có người nói' },
    ] },
  { key: 'loudnorm', icon: '🔊', title: 'Chuẩn hoá âm lượng', summary: (c) => `${c.target} LUFS`,
    liveNote: 'Cân bằng độ to cả video theo chuẩn nền tảng — áp dụng khi xem trước & xuất.',
    fields: [
      { k: 'target', type: 'seg', label: 'Mức chuẩn', options: [[-14, '-14 TikTok/YouTube'], [-16, '-16 Podcast'], [-23, '-23 Truyền hình']] },
    ] },
  { key: 'export', icon: '📦', title: 'Chất lượng xuất', noToggle: true,
    summary: (c) => `${c.resolution}p · ${{ high: 'chất lượng cao', balanced: 'cân bằng', small: 'dung lượng nhẹ' }[c.quality]}`,
    fields: [
      { k: 'resolution', type: 'seg', label: 'Độ phân giải', options: [[1080, '1080p Full HD'], [720, '720p']] },
      { k: 'quality', type: 'seg', label: 'Chất lượng', options: [['high', 'Cao'], ['balanced', 'Cân bằng'], ['small', 'Nhẹ']] },
    ] },
];

const FILTERS = [
  ['all', 'Tất cả', () => true],
  ['mine', '★ Của tôi', (t) => t.user],
  ['vertical', '📱 Khung dọc', (t, c) => c.format.enabled && c.format.ratio === '9:16'],
  ['subs', '💬 Phụ đề AI', (t, c) => c.subtitles.enabled],
  ['color', '🎨 Màu phim', (t, c) => c.color.enabled || c.film.enabled],
  ['speed', '⚡ Tốc độ', (t, c) => c.speed.enabled || c.boomerang.enabled],
];

// ---------- State ----------
const state = {
  templates: [],
  userTemplates: [],
  defaults: null,
  video: null,
  frame: null,
  templateId: null,
  config: null,
  dirty: false,
  hasKey: false,
  job: null,
  previewUrl: null,
  resultUrl: null,
  view: 'original',
  open: new Set(),
  filter: 'all',
  trim: { start: 0, end: 0 }, // seconds in the source; end 0 = until the end
  captions: null, // { key, sig, list:[{start,end,text,words}] } edited subtitles
  live: localStorage.getItem('vs.live') !== '0',
  userMuted: false,
  origTime: 0,
  subsJob: null,
};
const allTemplates = () => [...state.userTemplates, ...state.templates];
const findTpl = (id) => allTemplates().find((t) => t.id === id);
const V = () => $('#video');
const music = new Audio();
music.loop = true;
music.preload = 'auto';

// ---------- Toasts ----------
function toast(msg, type = '', ms = 4200) {
  const t = h('div', { class: `toast ${type}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ---------- Session (survives reloads) ----------
const SESSION_KEY = 'vs.session';
let saveTimer = 0;
function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!state.video) return localStorage.removeItem(SESSION_KEY);
    const data = { videoId: state.video.id, templateId: state.templateId, config: state.config, dirty: state.dirty, trim: state.trim, captions: state.captions };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {
      try { data.captions = null; localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* storage full */ }
    }
  }, 300);
}

async function restoreSession() {
  let s;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { s = null; }
  if (!s?.videoId) return;
  try {
    const rec = await api('/api/media/' + s.videoId);
    setVideo(rec);
    if (s.templateId && findTpl(s.templateId)) {
      selectTemplate(s.templateId, { silent: true });
      if (s.config) state.config = deepMerge(state.defaults, s.config);
      state.dirty = !!s.dirty;
      updateTemplateName();
      renderSections();
    }
    state.trim = { start: 0, end: 0, ...s.trim };
    state.captions = s.captions?.list ? s.captions : null;
    renderTimeline();
    renderSections();
    applyLive();
    toast('↺ Đã khôi phục phiên làm việc trước.', 'success', 3000);
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
}

// ---------- Steps ----------
function updateSteps() {
  const step = !state.video ? 1 : !state.templateId ? 2 : 3;
  $$('#steps li').forEach((li) => {
    const n = +li.dataset.step;
    li.classList.toggle('active', n === step && !(n === 3 && state.resultUrl));
    li.classList.toggle('done', n < step || (n === 3 && !!state.resultUrl));
  });
}

// ---------- Upload ----------
function uploadFile(file, kind, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?kind=${kind}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(data) : reject(new Error(data.error || 'Tải lên thất bại'));
    };
    xhr.onerror = () => reject(new Error('Mất kết nối tới server'));
    xhr.send(fd);
  });
}

async function handleVideoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|avi|m4v|3gp|flv|wmv)$/i.test(file.name)) {
    return toast('File này không phải video.', 'error');
  }
  const prog = $('#upload-progress');
  prog.hidden = false;
  $('#dropzone').hidden = false;
  $('#player-card').hidden = true;
  $('#action-bar').hidden = true;
  try {
    const rec = await uploadFile(file, 'video', (p) => {
      $('#upload-bar').style.width = pct(p * 0.95);
      $('#upload-text').textContent = p < 1 ? `Đang tải lên… ${pct(p)}` : 'Đang phân tích video…';
    });
    $('#upload-bar').style.width = '100%';
    setVideo(rec);
  } catch (e) {
    toast(e.message, 'error');
    if (state.video) { $('#dropzone').hidden = true; $('#player-card').hidden = false; $('#action-bar').hidden = false; }
  } finally {
    prog.hidden = true;
    $('#upload-bar').style.width = '0';
  }
}

function setVideo(rec) {
  state.video = rec;
  state.previewUrl = null;
  state.resultUrl = null;
  state.trim = { start: 0, end: 0 };
  state.captions = null;
  state.origTime = 0;
  $('#dropzone').hidden = true;
  $('#player-card').hidden = false;
  $('#action-bar').hidden = false;
  $('#result-panel').hidden = true;
  $('#file-name').textContent = rec.name;
  const m = rec.meta;
  $('#meta-chips').replaceChildren(...[
    h('span', { class: 'chip' }, '⏱ ' + fmtTime(m.duration)),
    h('span', { class: 'chip' }, `${m.width}×${m.height}`),
    h('span', { class: 'chip' }, `${Math.round(m.fps)} fps`),
    h('span', { class: 'chip' }, fmtSize(m.size)),
    !m.hasAudio && h('span', { class: 'chip' }, '🔇 không tiếng'),
  ].filter(Boolean));
  $$('#view-tabs .tab').forEach((t) => { t.disabled = t.dataset.view !== 'original'; t.classList.remove('fresh'); });
  V().removeAttribute('src');
  setView('original');
  captureFrame(rec.url);
  loadStrip(rec.id);
  renderTimeline();
  renderSections();
  updateButtons();
  updateSteps();
  saveSession();
}

function captureFrame(url) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(v.duration * 0.25, 3); }, { once: true });
  v.addEventListener('seeked', () => {
    try {
      const c = document.createElement('canvas');
      const k = 480 / Math.max(v.videoWidth, v.videoHeight);
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      state.frame = c.toDataURL('image/jpeg', 0.82);
      renderTemplates();
    } catch { /* codec not decodable in browser – keep gradients */ }
    v.removeAttribute('src');
    v.load();
  }, { once: true });
}

function loadStrip(id) {
  const strip = $('#tl-strip');
  strip.style.backgroundImage = '';
  strip.classList.add('loading');
  const img = new Image();
  img.onload = () => {
    if (state.video?.id !== id) return;
    strip.classList.remove('loading');
    strip.style.backgroundImage = `url(${img.src})`;
  };
  img.onerror = () => strip.classList.remove('loading');
  img.src = `/api/media/${id}/strip`;
}

// ---------- Viewer ----------
function setView(view) {
  const vid = V();
  if (state.view === 'original' && view !== 'original' && vid.getAttribute('src') === state.video?.url) state.origTime = vid.currentTime || 0;
  state.view = view;
  const native = view !== 'original';
  const src = { original: state.video?.url, preview: state.previewUrl, result: state.resultUrl }[view];
  $$('#view-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $(`#view-tabs .tab[data-view="${view}"]`)?.classList.remove('fresh');
  $('#viewer').classList.toggle('native', native);
  vid.controls = native;
  if (src && vid.getAttribute('src') !== src) {
    vid.src = src;
    vid.loop = view === 'preview';
    if (native) { vid.muted = false; vid.play().catch(() => {}); }
    else vid.addEventListener('loadedmetadata', () => { vid.currentTime = state.origTime || trimRange().start; }, { once: true });
  }
  const badge = $('#viewer-badge');
  badge.hidden = view === 'original';
  badge.textContent = view === 'preview' ? '👁 Bản xem trước 8s (độ phân giải thấp)' : '✓ Video đã xuất';
  applyLive();
}

function togglePlay() {
  const vid = V();
  if (!vid.getAttribute('src')) return;
  if (vid.paused) {
    if (state.view === 'original') {
      const { start, end } = trimRange();
      if (vid.currentTime < start - 0.05 || vid.currentTime >= end - 0.05) vid.currentTime = start;
    }
    vid.play().catch(() => {});
  } else vid.pause();
}

function seekBy(d) {
  const vid = V();
  if (!vid.getAttribute('src')) return;
  vid.currentTime = clamp(vid.currentTime + d, 0, vid.duration || 0);
}

// ---------- Trim timeline ----------
function trimRange() {
  const d = state.video?.meta.duration || 0;
  const start = clamp(state.trim.start, 0, Math.max(0, d - 0.5));
  const end = state.trim.end > 0 ? clamp(state.trim.end, start + 0.5, d) : d;
  return { start, end, d };
}

function setTrim(start, end, { save = true } = {}) {
  const d = state.video?.meta.duration || 0;
  start = clamp(start, 0, Math.max(0, d - 0.5));
  end = clamp(end, start + 0.5, d);
  state.trim = { start: Math.round(start * 100) / 100, end: end >= d - 0.05 ? 0 : Math.round(end * 100) / 100 };
  renderTimeline();
  if (save) { saveSession(); renderSubsStatus(); }
}

function renderTimeline() {
  if (!state.video) return;
  const { start, end, d } = trimRange();
  const p = (t) => (d ? (t / d) * 100 : 0) + '%';
  $('#tl-dim-l').style.width = p(start);
  $('#tl-dim-r').style.width = d ? (100 - (end / d) * 100) + '%' : '0';
  $('#tl-range').style.left = p(start);
  $('#tl-range').style.width = d ? ((end - start) / d) * 100 + '%' : '100%';
  $('#tl-h-start').style.left = p(start);
  $('#tl-h-end').style.left = p(end);
  const trimmed = start > 0.01 || end < d - 0.01;
  const info = $('#trim-info');
  info.classList.toggle('active', trimmed);
  info.textContent = trimmed
    ? `✂ Dùng đoạn ${fmtTimeP(start)} → ${fmtTimeP(end)} (${(end - start).toFixed(1)}s / ${fmtTime(d)})`
    : `✂ Dùng toàn bộ video (${fmtTimeP(d)}) — kéo 2 tay cầm để cắt bớt đầu/cuối`;
  $('#trim-reset').hidden = !trimmed;
  updateHead();
}

function updateHead() {
  const vid = V();
  const d = state.video?.meta.duration || 0;
  if (state.view !== 'original' || !d) return;
  const t = vid.currentTime || 0;
  $('#tl-head').style.left = (t / d) * 100 + '%';
  $('#t-time').textContent = `${fmtTimeP(t)} / ${fmtTimeP(d)}`;
}

function bindTimeline() {
  const tl = $('#timeline');
  const tAt = (e) => {
    const r = tl.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1) * (state.video?.meta.duration || 0);
  };
  let drag = null;
  tl.addEventListener('pointerdown', (e) => {
    if (!state.video || e.button !== 0) return;
    const handle = e.target.closest('.tl-handle');
    drag = handle ? (handle.classList.contains('start') ? 'start' : 'end') : 'seek';
    handle?.classList.add('drag');
    tl.setPointerCapture(e.pointerId);
    if (drag === 'seek') V().currentTime = tAt(e);
    e.preventDefault();
  });
  tl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = tAt(e);
    const { start, end } = trimRange();
    if (drag === 'seek') V().currentTime = t;
    else if (drag === 'start') { setTrim(Math.min(t, end - 0.5), end, { save: false }); V().currentTime = trimRange().start; }
    else { setTrim(start, Math.max(t, start + 0.5), { save: false }); V().currentTime = Math.max(0, trimRange().end - 0.05); }
  });
  const end = () => {
    if (!drag) return;
    if (drag !== 'seek') { saveSession(); renderSubsStatus(); }
    $$('.tl-handle.drag').forEach((x) => x.classList.remove('drag'));
    drag = null;
  };
  tl.addEventListener('pointerup', end);
  tl.addEventListener('pointercancel', end);
  // keyboard nudging on the handles
  for (const id of ['tl-h-start', 'tl-h-end']) {
    $('#' + id).addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
      const { start, end: en } = trimRange();
      id === 'tl-h-start' ? setTrim(start + step, en) : setTrim(start, en + step);
    });
  }
}

function markTrim(which) {
  if (!state.video || state.view !== 'original') return;
  const t = V().currentTime || 0;
  const { start, end, d } = trimRange();
  if (which === 'in') {
    if (t > end - 0.5) setTrim(t, d); else setTrim(t, end);
    toast(`Điểm đầu: ${fmtTimeP(trimRange().start)}`, '', 1600);
  } else {
    if (t < start + 0.5) return toast('Điểm cuối phải sau điểm đầu ít nhất 0.5s.', 'error', 2200);
    setTrim(start, t);
    toast(`Điểm cuối: ${fmtTimeP(trimRange().end)}`, '', 1600);
  }
}

// ---------- Live effects (CSS/canvas simulation on the original video) ----------
const hasTimelineFx = (c) => c.jumpcut.enabled || c.boomerang.enabled;
const speedOf = (c) => (c.speed.enabled ? c.speed.factor : 1);
const liveActive = () => state.live && state.view === 'original' && !!state.config && !!state.video;

function outAspect() {
  const c = state.config;
  if (c.format.enabled) { const [a, b] = c.format.ratio.split(':').map(Number); return a / b; }
  return state.video.meta.width / state.video.meta.height;
}

function layoutFrame() {
  const fr = $('#live-frame');
  if (!liveActive()) { fr.style.removeProperty('--fw'); fr.style.removeProperty('--fh'); return; }
  const r = $('#viewer').getBoundingClientRect();
  const W = r.width - 24, H = r.height - 24, a = outAspect();
  let w = W, hh = W / a;
  if (hh > H) { hh = H; w = H * a; }
  fr.style.setProperty('--fw', Math.round(w) + 'px');
  fr.style.setProperty('--fh', Math.round(hh) + 'px');
  const cv = $('#live-bg');
  const cw = 48, ch = Math.max(8, Math.round(48 / a));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
}

function applyLive() {
  const viewer = $('#viewer');
  const vid = V();
  const on = liveActive();
  const c = state.config;
  viewer.classList.toggle('live', on);
  for (const m of ['blur', 'crop', 'fit']) viewer.classList.toggle('fmt-' + m, on && c.format.enabled && c.format.mode === m);
  const badge = $('#live-badge');
  badge.hidden = !on;
  if (on) badge.title = hasTimelineFx(c) ? 'Cắt lặng / boomerang chỉ thấy khi Xem trước 8s' : 'Mô phỏng nhanh trên trình duyệt — bản xuất có thể khác chút ít';
  const filt = on ? liveFilter(c.color) : '';
  vid.style.filter = filt;
  $('#live-bg').style.filter = filt ? `blur(18px) brightness(.9) saturate(1.15) ${filt}` : '';

  if (on) {
    const ov = $('#live-ov');
    ov.classList.toggle('vignette', c.film.enabled && c.film.vignette);
    ov.classList.toggle('bars', c.film.enabled && c.film.letterbox);
    ov.style.setProperty('--grain', c.film.enabled ? Math.min(0.6, c.film.grain / 35) : 0);
    const title = $('#ov-title');
    title.className = 'ov-title pos-' + c.title.position;
    title.replaceChildren(h('span', {}, c.title.text));
    const wm = $('#ov-wm');
    wm.className = 'ov-wm ' + c.watermark.position;
    wm.textContent = c.watermark.enabled ? c.watermark.text : '';
    $('#ov-outro span').textContent = c.outro.text;
    const sub = $('#ov-sub');
    const effPos = c.subtitles.position === 'auto'
      ? (state.captions?.analysis?.safePosition || 'bottom')
      : c.subtitles.position;
    sub.className = `ov-sub st-${c.subtitles.style} pos-${effPos}${c.subtitles.uppercase ? ' upper' : ''}`;
    subKey = '';
  }
  // playback: speed / mute / music mirror the template
  if (state.view === 'original') {
    vid.playbackRate = on ? clamp(speedOf(c), 0.25, 4) : 1;
    vid.muted = state.userMuted || (on && c.speed.enabled && c.speed.mute);
    vid.volume = on && c.music.enabled ? clamp(c.music.originalVolume, 0, 1) : 1;
    $('#t-mute').classList.toggle('on', vid.muted);
  }
  layoutFrame();
  syncMusic();
  frameTick();
}

function syncMusic() {
  const vid = V();
  const c = state.config;
  if (!liveActive() || !c.music.enabled || !c.music.url || vid.paused) { music.pause(); return; }
  if (music.getAttribute('src') !== c.music.url) music.src = c.music.url;
  music.volume = clamp(c.music.volume, 0, 1);
  music.muted = state.userMuted;
  const rel = Math.max(0, (vid.currentTime - trimRange().start) / speedOf(c));
  const pos = music.duration ? rel % music.duration : rel;
  if (Math.abs(music.currentTime - pos) > 0.3) music.currentTime = pos;
  music.play().catch(() => {});
}

const SAMPLE_ITEMS = [
  { t: 'Đây' }, { t: 'là' }, { t: 'phụ' }, { t: 'đề' },
  { t: 'VideoStudio', isKey: true }, { t: 'thông' }, { t: 'minh', isKey: true },
  { t: 'bằng' }, { t: 'AI', isKey: true },
];
let subKey = '';
function renderLiveSub(rel, c) {
  const el = $('#ov-sub');
  if (!c.subtitles.enabled) { el.classList.remove('on'); return; }
  let words = null;
  let idx = -1;
  let curEmoji = '';
  const caps = state.captions && !hasTimelineFx(c) && state.captions.sig === captionSig() ? state.captions.list : null;
  if (caps) {
    idx = caps.findIndex((cp) => rel >= cp.start && rel < cp.end);
    if (idx >= 0) {
      const cp = caps[idx];
      curEmoji = c.subtitles.emojis !== false && cp.emoji ? cp.emoji : '';
      const toks = cp.text.split(/\s+/).filter(Boolean);
      const timed = Array.isArray(cp.words) && cp.words.length === toks.length;
      words = toks.map((t, i) => {
        const isKey = !!(c.subtitles.highlightKeywords !== false && timed && cp.words[i].isKeyword);
        return {
          t,
          on: timed ? rel >= cp.words[i].start : rel >= cp.start + ((cp.end - cp.start) * i) / toks.length,
          isKey,
        };
      });
    }
  } else {
    const n = c.subtitles.style === 'tiktok' ? 3 : SAMPLE_ITEMS.length;
    const per = 0.38;
    const k = Math.floor(Math.max(0, rel) / per);
    const chunk = Math.floor(k / n) % Math.ceil(SAMPLE_ITEMS.length / n);
    idx = chunk;
    words = SAMPLE_ITEMS.slice(chunk * n, chunk * n + n).map((item, i) => ({
      t: item.t,
      on: i <= k % n,
      isKey: c.subtitles.highlightKeywords !== false && item.isKey,
    }));
    if (c.subtitles.emojis !== false) curEmoji = '⚡';
  }
  if (!words) { el.classList.remove('on'); subKey = ''; return; }
  el.classList.add('on');
  const key = idx + '|' + words.map((w) => (w.on ? 1 : 0)).join('') + '|' + words.map((w) => w.t).join(' ') + '|' + curEmoji;
  if (key === subKey) return;
  const newChunk = !subKey.startsWith(idx + '|');
  subKey = key;
  const hlColor = c.subtitles.color || state.captions?.analysis?.highlightColor || 'var(--lime)';
  if (c.subtitles.style === 'tiktok') {
    const nodes = words.flatMap((w, i) => {
      const sp = i ? ' ' : '';
      let tag;
      if (w.on) {
        tag = h('b', { style: w.isKey ? { color: hlColor, textShadow: `0 0 10px ${hlColor}66` } : {} }, w.t);
      } else {
        tag = w.isKey ? h('span', { style: { color: hlColor, opacity: 0.95 } }, w.t) : w.t;
      }
      return [sp, tag];
    });
    if (curEmoji) nodes.push(h('span', { class: 'sub-emoji' }, ' ' + curEmoji));
    el.replaceChildren(...nodes);
  } else {
    const nodes = words.flatMap((w, i) => {
      const sp = i ? ' ' : '';
      const tag = w.isKey ? h('b', { style: { color: hlColor } }, w.t) : w.t;
      return [sp, tag];
    });
    if (curEmoji) nodes.push(h('span', { class: 'sub-emoji' }, ' ' + curEmoji));
    el.replaceChildren(h('span', {}, ...nodes));
  }
  if (newChunk) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
}

let rafId = 0;
let lastCapIdx = -2;
function frameTick() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  const vid = V();
  updateHead();
  if (state.view === 'original' && state.video && !vid.paused) {
    const { start, end } = trimRange();
    if (vid.currentTime >= end - 0.03) { vid.currentTime = start; syncMusic(); }
  }
  if (liveActive()) {
    const c = state.config;
    const { start, end } = trimRange();
    const sp = speedOf(c);
    const rel = (vid.currentTime - start) / sp;
    const outDur = (end - start) / sp;
    // title
    const tOn = c.title.enabled && c.title.text.trim() && rel >= 0 && rel < Math.min(c.title.duration, outDur);
    $('#ov-title').style.opacity = tOn ? Math.min(1, rel / 0.4, (c.title.duration - rel) / 0.4) : 0;
    // outro
    const oStart = outDur - c.outro.duration;
    $('#ov-outro').style.opacity = c.outro.enabled && c.outro.text.trim() && rel >= oStart ? Math.min(1, (rel - oStart) / 0.5) : 0;
    // fades
    let f = 0;
    if (c.fade.enabled) {
      const fd = Math.min(c.fade.duration, outDur / 3);
      if (rel < fd) f = 1 - Math.max(0, rel) / fd;
      else if (rel > outDur - fd) f = 1 - Math.max(0, outDur - rel) / fd;
    }
    $('#ov-fade').style.opacity = clamp(f, 0, 1);
    renderLiveSub(rel, c);
    // blurred background
    if (c.format.enabled && c.format.mode === 'blur' && vid.readyState >= 2) {
      const cv = $('#live-bg');
      const ctx = cv.getContext('2d');
      const vw = vid.videoWidth, vh = vid.videoHeight, a = cv.width / cv.height;
      let sw = vw, sh = vw / a;
      if (sh > vh) { sh = vh; sw = vh * a; }
      try { ctx.drawImage(vid, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cv.width, cv.height); } catch { /* not ready */ }
    }
    // highlight the current caption in the editor
    if ($('#subs-drawer').classList.contains('open') && state.captions) {
      const i = state.captions.list.findIndex((cp) => rel >= cp.start && rel < cp.end);
      if (i !== lastCapIdx) {
        $$('#subs-list .cap').forEach((r, j) => r.classList.toggle('now', j === i));
        lastCapIdx = i;
      }
    }
  }
  if (!vid.paused) rafId = requestAnimationFrame(frameTick);
}

function setLive(on) {
  state.live = on;
  $('#live-toggle').checked = on;
  localStorage.setItem('vs.live', on ? '1' : '0');
  applyLive();
}

// ---------- Templates ----------
function renderFilters() {
  const wrap = $('#filter-chips');
  const list = allTemplates().map((t) => [t, deepMerge(state.defaults, t.config)]);
  wrap.replaceChildren(...FILTERS
    .filter(([id]) => id !== 'mine' || state.userTemplates.length)
    .map(([id, label, fn]) => h('button', {
      type: 'button', role: 'tab', class: state.filter === id ? 'active' : '', 'aria-selected': String(state.filter === id),
      onclick: () => { state.filter = id; renderFilters(); renderTemplates(); },
    }, label, id !== 'all' && h('em', {}, String(list.filter(([t, c]) => fn(t, c)).length)))));
}

function renderTemplates() {
  const grid = $('#template-grid');
  if (!state.defaults) return;
  const fn = (FILTERS.find(([id]) => id === state.filter) || FILTERS[0])[2];
  const list = allTemplates().filter((t) => fn(t, deepMerge(state.defaults, t.config)));
  if (!list.length) {
    grid.replaceChildren(h('p', { class: 'empty grid-empty' }, 'Không có mẫu nào trong nhóm này.'));
    return;
  }
  grid.replaceChildren(...list.map((t, i) => {
    const cfg = deepMerge(state.defaults, t.config);
    const thumb = h('div', { class: 'tpl-thumb', style: { '--g': `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` } });
    if (state.frame) {
      thumb.append(h('div', { class: 'frame', style: { backgroundImage: `url(${state.frame})`, filter: t.user ? liveFilter(cfg.color) || 'none' : t.css } }));
      if (cfg.format.enabled) {
        const [a, b] = cfg.format.ratio.split(':');
        thumb.append(h('div', { class: 'shape' }, h('i', { style: { aspectRatio: `${a} / ${b}` } })));
      }
      if (cfg.film.enabled && cfg.film.letterbox) thumb.classList.add('bars');
    } else {
      thumb.append(h('div', { class: 'glyph' }, t.user ? '⭐' : ICONS[t.id] || '✨'));
    }
    thumb.append(h('span', { class: 'tpl-check', html: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>' }));
    if (t.user) {
      thumb.append(h('span', {
        class: 'tpl-del', role: 'button', tabindex: '0', title: 'Xoá mẫu này', html: SVG_X,
        onclick: (e) => { e.stopPropagation(); deleteUserTemplate(t); },
      }));
    }
    return h('button', {
      class: 'tpl' + (state.templateId === t.id ? ' selected' : '') + (t.user ? ' user' : ''),
      'data-id': t.id,
      style: { animationDelay: `${i * 30}ms` },
      title: t.desc,
      onclick: () => selectTemplate(t.id),
    },
    thumb,
    h('div', { class: 'tpl-body' },
      h('b', {}, `${t.user ? '' : (ICONS[t.id] || '') + ' '}${t.name}`),
      h('p', {}, t.desc),
      h('div', { class: 'tags' }, (t.user ? enabledTags(cfg) : t.tags).map((x) => h('span', {}, x)))));
  }));
}

function enabledTags(cfg) {
  return SECTIONS.filter((s) => !s.noToggle && cfg[s.key]?.enabled).slice(0, 4).map((s) => s.title);
}

async function loadTemplates() {
  const { templates, defaults, userTemplates } = await api('/api/templates');
  state.templates = templates;
  state.defaults = defaults;
  state.userTemplates = userTemplates || [];
  if (state.filter === 'mine' && !state.userTemplates.length) state.filter = 'all';
  renderFilters();
  renderTemplates();
}

async function deleteUserTemplate(t) {
  if (!confirm(`Xoá mẫu "${t.name}"?`)) return;
  try {
    await api('/api/user-templates/' + encodeURIComponent(t.id), { method: 'DELETE' });
    await loadTemplates();
    if (state.templateId === t.id) { state.templateId = t.baseId; updateTemplateName(); }
    toast('Đã xoá mẫu.', 'success', 2000);
  } catch (e) { toast(e.message, 'error'); }
}

function updateTemplateName() {
  const t = findTpl(state.templateId);
  if (!t) return;
  $('#st-name').textContent = t.name + (state.dirty ? ' (đã chỉnh)' : '');
  $('#st-swatch').style.background = `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})`;
}

function selectTemplate(id, { silent = false } = {}) {
  const t = findTpl(id);
  if (!t) return;
  const keepMusic = state.config?.music;
  state.templateId = id;
  state.config = deepMerge(state.defaults, t.config);
  // carry over things the user already typed / picked
  if (keepMusic?.fileId && !state.config.music.fileId) {
    Object.assign(state.config.music, { fileId: keepMusic.fileId, fileName: keepMusic.fileName, url: keepMusic.url });
  }
  const prevWm = localStorage.getItem('vs.watermark');
  if (prevWm && !t.user) state.config.watermark.text = prevWm;
  state.dirty = false;
  $$('.tpl').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  updateTemplateName();
  state.open = new Set(SECTIONS.filter((s) => state.config[s.key].enabled).slice(0, 1).map((s) => s.key));
  renderSections();
  updateButtons();
  updateSteps();
  applyLive();
  saveSession();
  if (silent) return;
  if (state.config.music.enabled && !state.config.music.fileId) toast('Mẫu này có nhạc nền — chọn file nhạc ở tab Tinh chỉnh → Nhạc nền 🎵');
  if (state.config.subtitles.enabled && !state.hasKey) toast('Phụ đề AI cần Gemini API key — bấm ⚙ để nhập.', '', 5000);
}

function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    updateTemplateName();
  }
}

/** Anything in the config changed → refresh the live preview & persist. */
function onConfigChange() {
  markDirty();
  applyLive();
  saveSession();
}

// ---------- Tune sections ----------
function renderSections() {
  const wrap = $('#sections');
  $('#btn-save-tpl').disabled = !state.config;
  if (!state.config) {
    wrap.replaceChildren(h('p', { class: 'empty' }, 'Chọn một mẫu trước để tinh chỉnh.'));
    $('#tune-count').textContent = '0';
    return;
  }
  wrap.replaceChildren(...SECTIONS.map(buildSection));
  updateTuneCount();
}

function updateTuneCount() {
  $('#tune-count').textContent = SECTIONS.filter((s) => !s.noToggle && state.config[s.key].enabled).length;
}

function buildSection(sec) {
  const c = state.config[sec.key];
  const el = h('div', { class: 'section' + (sec.noToggle || c.enabled ? ' on' : '') + (state.open.has(sec.key) ? ' open' : ''), 'data-key': sec.key });
  const summary = h('small', {}, sec.summary(c));
  const refresh = () => {
    summary.textContent = sec.summary(c);
    el.classList.toggle('on', !!(sec.noToggle || c.enabled));
    updateTuneCount();
    onConfigChange();
  };

  const head = h('div', { class: 'section-head', onclick: (e) => {
    if (e.target.closest('.switch')) return;
    el.classList.toggle('open');
    el.classList.contains('open') ? state.open.add(sec.key) : state.open.delete(sec.key);
  } },
  h('span', { class: 'section-icon' }, sec.icon),
  h('div', { class: 'section-title' }, h('b', {}, sec.title), summary));
  if (!sec.noToggle) {
    const sw = h('input', { type: 'checkbox', 'aria-label': sec.title });
    sw.checked = c.enabled;
    sw.addEventListener('change', () => {
      c.enabled = sw.checked;
      if (c.enabled && !el.classList.contains('open')) { el.classList.add('open'); state.open.add(sec.key); }
      if (sec.key === 'boomerang' && c.enabled) toast('Boomerang chỉ dùng vài giây đầu và bỏ âm thanh gốc.');
      refresh();
    });
    head.append(h('label', { class: 'switch' }, sw, h('span')));
  }
  head.append(h('span', { class: 'chev', html: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>' }));

  const body = h('div', { class: 'section-body' });
  if (sec.needsKey && !state.hasKey) {
    body.append(h('div', { class: 'note' }, 'Cần Gemini API key để AI nghe & tạo phụ đề. ', h('a', { onclick: openSettings }, 'Nhập key →')));
  }
  if (sec.liveNote) body.append(h('div', { class: 'note info' }, sec.liveNote));
  for (const f of sec.fields) body.append(buildField(f, c, refresh));
  el.append(head, body);
  return el;
}

function buildField(f, c, refresh) {
  if (f.type === 'range') {
    const out = h('output', {}, (f.fmt || String)(c[f.k]));
    const input = h('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: c[f.k] });
    const paint = () => input.style.setProperty('--p', ((input.value - f.min) / (f.max - f.min)) * 100 + '%');
    paint();
    input.addEventListener('input', () => {
      c[f.k] = Number(input.value);
      out.textContent = (f.fmt || String)(c[f.k]);
      paint();
      refresh();
    });
    return h('label', { class: 'field' }, h('span', {}, h('em', { style: { fontStyle: 'normal' } }, f.label, f.hint ? h('small', {}, ` — ${f.hint}`) : ''), out), input);
  }
  if (f.type === 'seg') {
    const seg = h('div', { class: 'segmented' });
    for (const [val, label] of f.options) {
      const b = h('button', { type: 'button', class: String(c[f.k]) === String(val) ? 'active' : '' }, label);
      b.addEventListener('click', () => {
        c[f.k] = val;
        $$('button', seg).forEach((x) => x.classList.toggle('active', x === b));
        refresh();
      });
      seg.append(b);
    }
    return h('div', { class: 'field' }, h('span', {}, f.label), seg);
  }
  if (f.type === 'text') {
    const input = h('input', { type: 'text', value: c[f.k] ?? '', placeholder: f.placeholder || '', maxlength: 100 });
    input.addEventListener('input', () => {
      c[f.k] = input.value;
      if (c === state.config.watermark) localStorage.setItem('vs.watermark', input.value);
      refresh();
    });
    return h('label', { class: 'field' }, h('span', {}, f.label), input);
  }
  if (f.type === 'check') {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!c[f.k];
    input.addEventListener('change', () => { c[f.k] = input.checked; refresh(); });
    return h('label', { class: 'check' }, input, f.label);
  }
  if (f.type === 'subsEditor') {
    const n = state.captions?.list.length;
    const stale = state.captions && state.captions.sig !== captionSig();
    return h('div', { class: 'subs-cta' },
      h('p', {},
        h('b', {}, n ? `✍️ Đã biên tập ${n} câu phụ đề` : '✍️ Sửa phụ đề trước khi xuất'),
        stale ? '⚠ Bạn đã đổi đoạn cắt / tốc độ — nên tạo lại.' : n ? 'Bản sửa sẽ được dùng khi xuất video.' : 'AI chép lời ngay bây giờ để bạn sửa chính tả, tên riêng…'),
      h('button', { type: 'button', class: 'btn secondary sm', onclick: openSubs, disabled: !state.video }, n ? 'Mở' : 'Tạo & sửa'));
  }
  if (f.type === 'music') {
    const name = h('span', { class: 'fp-name' + (c.fileName ? '' : ' empty') }, c.fileName || 'Chưa chọn file nhạc (mp3, m4a, wav…)');
    const file = h('input', { type: 'file', accept: 'audio/*,video/*', hidden: true });
    const btn = h('button', { type: 'button', class: 'btn secondary sm', onclick: () => file.click() }, c.fileName ? 'Đổi nhạc' : 'Chọn nhạc');
    file.addEventListener('change', async () => {
      const f0 = file.files[0];
      if (!f0) return;
      btn.disabled = true;
      name.textContent = 'Đang tải lên…';
      try {
        const rec = await uploadFile(f0, 'music', (p) => (name.textContent = `Đang tải lên… ${pct(p)}`));
        Object.assign(c, { fileId: rec.id, fileName: rec.name, url: rec.url, enabled: true });
        renderSections();
        onConfigChange();
        toast('Đã thêm nhạc nền: ' + rec.name, 'success');
      } catch (e) {
        toast(e.message, 'error');
        name.textContent = c.fileName || 'Chưa chọn file nhạc';
      } finally {
        btn.disabled = false;
      }
    });
    return h('div', { class: 'file-pick' }, h('span', {}, '🎵'), name, btn, file);
  }
  return h('div');
}

// ---------- Save as template ----------
function openSaveTemplate() {
  if (!state.config) return;
  const t = findTpl(state.templateId);
  $('#tpl-name').value = t?.user ? t.name : `${t?.name || 'Mẫu'} của tôi`;
  const on = SECTIONS.filter((s) => !s.noToggle && state.config[s.key].enabled).map((s) => `${s.icon} ${s.title}`);
  $('#tpl-summary').textContent = on.length ? 'Gồm: ' + on.join(' · ') : 'Mẫu chưa bật hiệu ứng nào.';
  $('#save-modal').showModal();
  setTimeout(() => $('#tpl-name').select(), 30);
}

async function saveTemplate() {
  const name = $('#tpl-name').value.trim();
  if (!name) return toast('Hãy đặt tên cho mẫu.', 'error');
  const t = findTpl(state.templateId);
  try {
    const tpl = await api('/api/user-templates', {
      method: 'POST',
      body: JSON.stringify({ name, baseId: t?.user ? t.baseId : t?.id, config: state.config }),
    });
    const cfg = state.config;
    await loadTemplates();
    state.templateId = tpl.id;
    state.config = cfg;
    state.dirty = false;
    renderTemplates();
    updateTemplateName();
    saveSession();
    toast(`Đã lưu mẫu "${tpl.name}" — xem ở nhóm ★ Của tôi.`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Subtitle editor ----------
/** Signature of everything that changes the audio timeline (mirrors the server's timelineKey inputs). */
function captionSig() {
  const c = state.config;
  if (!c) return '';
  const { start, end, d } = trimRange();
  return JSON.stringify([start.toFixed(2), end >= d - 0.05 ? 0 : end.toFixed(2), c.jumpcut, c.speed, c.boomerang]);
}

function renderConfig() {
  return { ...clone(state.config), trim: { ...state.trim } };
}

function openSubs() {
  if (!state.video) return;
  $('#subs-drawer').classList.add('open');
  $('#drawer-backdrop').hidden = false;
  lastCapIdx = -2;
  renderCaps();
  if (!state.captions && !state.subsJob) startTranscribe();
}
function closeSubs() {
  $('#subs-drawer').classList.remove('open');
  if (!$('#drawer').classList.contains('open')) $('#drawer-backdrop').hidden = true;
}

function renderSubsStatus() {
  const st = $('#subs-status');
  if (!st) return;
  const stale = state.captions && state.captions.sig !== captionSig();
  st.textContent = !state.captions
    ? 'AI nghe video và chép lời — bạn sửa chữ sai trước khi xuất.'
    : stale
      ? '⚠ Bạn đã đổi đoạn cắt / tốc độ sau khi tạo. Bấm "AI tạo lại" để khớp thời gian.'
      : `${state.captions.list.length} câu · bấm mốc thời gian để nghe lại · bản sửa được dùng khi xuất.`;
  st.style.color = stale ? 'var(--amber)' : '';
  const sec = $('.section[data-key="subtitles"]');
  if (sec) sec.replaceWith(buildSection(SECTIONS.find((s) => s.key === 'subtitles')));
}

function renderSubsAiCard() {
  const card = $('#subs-ai-card');
  if (!card) return;
  const a = state.captions?.analysis;
  if (!a) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }
  card.hidden = false;
  const posNames = { bottom: 'Dưới đáy (Bottom - né mặt)', middle: 'Giữa màn hình (Middle)', top: 'Trên đỉnh (Top)' };
  const posText = posNames[a.safePosition] || a.safePosition || 'Dưới đáy';
  const toneNames = {
    energetic: 'Sôi nổi, năng động ⚡',
    calm: 'Nhẹ nhàng, êm dịu 🍃',
    cinematic: 'Điện ảnh nghệ thuật 🎬',
    tech: 'Công nghệ, hiện đại 💻',
    story: 'Kể chuyện, sâu lắng 📖',
  };
  const toneText = toneNames[a.tone] || a.tone || 'Tự nhiên';
  const hl = a.highlightColor || '#c8ff3d';

  card.replaceChildren(
    h('div', { class: 'ai-badge-header' },
      h('span', { class: 'ai-badge-kicker' }, 'PHÂN TÍCH AI HOÀN TẤT'),
      h('span', { class: 'ai-badge-dot' })
    ),
    h('div', { class: 'ai-badge-grid' },
      h('div', { class: 'ai-badge-item' },
        h('small', {}, '🎯 Vị trí an toàn né mặt'),
        h('b', {}, posText)
      ),
      h('div', { class: 'ai-badge-item' },
        h('small', {}, '🎨 Tông điệu & Màu nhấn'),
        h('b', {},
          h('span', { class: 'swatch-dot', style: { background: hl, boxShadow: `0 0 6px ${hl}` } }),
          ` ${toneText}`
        )
      )
    )
  );
}

function renderCaps() {
  const list = $('#subs-list');
  renderSubsStatus();
  renderSubsAiCard();
  $('#subs-clear').disabled = !state.captions;
  if (!state.captions) {
    list.replaceChildren(h('p', { class: 'empty' }, state.subsJob ? '' : state.hasKey ? 'Chưa có phụ đề.' : 'Cần Gemini API key để tạo phụ đề.'));
    return;
  }
  if (!state.captions.list.length) return list.replaceChildren(h('p', { class: 'empty' }, 'AI không nghe thấy lời nói nào.'));
  list.replaceChildren(...state.captions.list.map((cp, i) => {
    const ta = h('textarea', { rows: 1, spellcheck: 'false', 'aria-label': `Câu ${i + 1}` });
    ta.value = cp.text;
    ta.addEventListener('input', () => { cp.text = ta.value; saveSession(); });

    const emojiInput = h('input', {
      type: 'text',
      class: 'cap-emoji',
      value: cp.emoji || '',
      placeholder: '😀',
      title: 'Emoji ngữ cảnh (AI gắn tự động, sửa tuỳ ý)',
      maxlength: 4,
    });
    emojiInput.addEventListener('input', () => {
      cp.emoji = emojiInput.value.trim();
      saveSession();
      applyLive();
    });

    const keywords = (cp.words || []).filter((w) => w.isKeyword).map((w) => w.text);
    const kwBadge = keywords.length
      ? h('div', { class: 'cap-kw', title: 'Từ khoá được AI đổi màu nhấn' }, '⚡ ' + [...new Set(keywords)].join(', '))
      : null;

    const bodyCol = h('div', { class: 'cap-body' },
      h('div', { class: 'cap-text-row' }, ta, emojiInput),
      kwBadge
    );

    return h('div', { class: 'cap' },
      h('button', { class: 'cap-time', type: 'button', title: 'Nghe đoạn này', onclick: () => seekToCaption(cp) },
        fmtTimeP(cp.start), h('br'), '→ ' + fmtTimeP(cp.end)),
      bodyCol,
      h('button', { class: 'cap-del', type: 'button', title: 'Xoá câu', html: SVG_TRASH, onclick: () => {
        state.captions.list.splice(i, 1);
        renderCaps();
        saveSession();
      } })
    );
  }));
}

function seekToCaption(cp) {
  if (hasTimelineFx(state.config)) return toast('Đang bật cắt lặng/boomerang nên mốc thời gian khác video gốc — xem bằng "Xem trước".', '', 3500);
  if (state.view !== 'original') setView('original');
  const vid = V();
  vid.currentTime = trimRange().start + cp.start * speedOf(state.config);
  vid.play().catch(() => {});
}

async function startTranscribe() {
  if (!state.video || !state.config) return;
  if (!state.hasKey) { openSettings(); return toast('Nhập Gemini API key để AI tạo phụ đề.', 'error'); }
  if (!state.video.meta.hasAudio) return toast('Video không có âm thanh để tạo phụ đề.', 'error');
  state.subsJob?.es.close();
  const sig = captionSig();
  $('#subs-progress').hidden = false;
  $('#subs-bar').style.width = '0';
  $('#subs-stage').textContent = 'Đang chuẩn bị…';
  $('#subs-regen').disabled = true;
  try {
    const { jobId } = await api('/api/transcribe', { method: 'POST', body: JSON.stringify({ videoId: state.video.id, config: renderConfig() }) });
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    state.subsJob = { id: jobId, es };
    renderCaps();
    es.onmessage = (ev) => {
      const s = JSON.parse(ev.data);
      $('#subs-bar').style.width = pct(s.progress || 0);
      $('#subs-stage').textContent = [s.stage, s.message].filter(Boolean).join(' — ');
      if (s.status === 'running') return;
      es.close();
      state.subsJob = null;
      $('#subs-progress').hidden = true;
      $('#subs-regen').disabled = false;
      if (s.status === 'done') {
        state.captions = {
          key: s.captionsKey, sig,
          analysis: s.analysis || null,
          list: s.captions.map((cp) => ({
            start: cp.start, end: cp.end, words: cp.words,
            emoji: cp.emoji || '',
            text: cp.words.map((w) => w.text).join(' '),
          })),
        };
        (s.warnings || []).forEach((w) => toast(w));
        saveSession();
        toast(`AI đã chép ${state.captions.list.length} câu & phân tích video!`, 'success');
      } else if (s.status === 'error') toast('Lỗi tạo phụ đề: ' + s.error, 'error', 9000);
      renderCaps();
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && state.subsJob?.es === es) {
        state.subsJob = null;
        $('#subs-progress').hidden = true;
        $('#subs-regen').disabled = false;
      }
    };
  } catch (e) {
    $('#subs-progress').hidden = true;
    $('#subs-regen').disabled = false;
    toast(e.message, 'error');
  }
}

// ---------- Render jobs ----------
function updateButtons() {
  const busy = state.job && !state.job.preview;
  const ready = state.video && state.templateId;
  $('#btn-preview').disabled = !ready || busy;
  $('#btn-export').disabled = !ready || !!state.job;
}

async function startRender(preview) {
  if (!state.video || !state.config) return;
  if (!preview && state.config.subtitles.enabled && !state.hasKey && !state.captions) {
    openSettings();
    return toast('Nhập Gemini API key để tạo phụ đề AI (hoặc tắt Phụ đề AI).', 'error');
  }
  if (state.job && !preview) return;
  if (state.job?.preview) state.job.es?.close();
  if (!preview && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  const vid = V();
  const previewStart = state.view === 'original' ? vid.currentTime || 0 : state.origTime || 0;
  const body = { videoId: state.video.id, config: renderConfig(), preview, previewStart, templateId: state.templateId };
  if (state.captions && state.config.subtitles.enabled) {
    Object.assign(body, {
      captions: state.captions.list,
      captionsKey: state.captions.key,
      analysis: state.captions.analysis,
    });
  }
  try {
    const { jobId } = await api('/api/render', { method: 'POST', body: JSON.stringify(body) });
    trackJob(jobId, preview);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function trackJob(id, preview) {
  const job = { id, preview, es: new EventSource(`/api/jobs/${id}/events`) };
  state.job = job;
  $('#result-panel').hidden = true;
  $('#progress-panel').hidden = false;
  $('#pp-bar').style.width = '0';
  $('#pp-percent').textContent = '0%';
  $('#pp-stage').textContent = preview ? 'Đang dựng bản xem trước…' : 'Đang chuẩn bị…';
  $('#pp-msg').textContent = '';
  updateButtons();

  job.es.onmessage = (ev) => {
    if (state.job !== job) return job.es.close();
    const s = JSON.parse(ev.data);
    $('#pp-bar').style.width = pct(s.progress || 0);
    $('#pp-percent').textContent = pct(s.progress || 0);
    $('#pp-stage').textContent = s.stage || '';
    const el = (Date.now() - s.startedAt) / 1000;
    const eta = s.progress > 0.05 ? (el / s.progress) * (1 - s.progress) : null;
    $('#pp-msg').textContent = [s.message, `Đã chạy ${fmtTime(el)}`, eta != null && !preview ? `còn ~${fmtTime(eta)}` : ''].filter(Boolean).join(' · ');
    if (!preview) document.title = `${pct(s.progress || 0)} · Đang xuất — VideoStudio`;
    if (s.status === 'running') return;

    job.es.close();
    state.job = null;
    document.title = BASE_TITLE;
    $('#progress-panel').hidden = true;
    updateButtons();

    if (s.status === 'done') onJobDone(s, preview);
    else if (s.status === 'error') toast('Lỗi xử lý: ' + s.error, 'error', 9000);
  };
  job.es.onerror = () => {
    if (state.job === job && job.es.readyState === EventSource.CLOSED) {
      state.job = null;
      document.title = BASE_TITLE;
      $('#progress-panel').hidden = true;
      updateButtons();
    }
  };
}

function onJobDone(s, preview) {
  const tab = $(`#view-tabs .tab[data-view="${preview ? 'preview' : 'result'}"]`);
  tab.disabled = false;
  if (state.view === 'original') state.origTime = V().currentTime || 0;
  V().pause();
  if (preview) {
    state.previewUrl = s.url;
    V().removeAttribute('src');
    setView('preview');
    (s.warnings || []).forEach((w) => toast(w));
    return;
  }
  state.resultUrl = s.url;
  setView('result');
  $('#result-panel').hidden = false;
  $('#rp-info').textContent = `${s.fileName} · ${s.width}×${s.height} · ${fmtTime(s.duration)} · xử lý trong ${fmtTime(s.elapsed / 1000)}`;
  $('#rp-download').href = s.url;
  $('#rp-download').setAttribute('download', s.fileName);
  $('#rp-srt').hidden = !s.srt;
  if (s.srt) $('#rp-srt').href = s.srt;
  $('#rp-warnings').replaceChildren(...(s.warnings || []).map((w) => h('li', {}, w)));
  toast('Xuất video thành công! 🎉', 'success');
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('VideoStudio — xuất video xong 🎉', { body: s.fileName });
    n.onclick = () => { window.focus(); n.close(); };
  }
  updateSteps();
}

// ---------- History ----------
async function openHistory() {
  $('#drawer').classList.add('open');
  $('#drawer-backdrop').hidden = false;
  const list = $('#history-list');
  list.replaceChildren(h('p', { class: 'empty' }, 'Đang tải…'));
  try {
    const items = await api('/api/outputs');
    if (!items.length) return list.replaceChildren(h('p', { class: 'empty' }, 'Chưa có video nào được xuất.'));
    list.replaceChildren(...items.map((it) => {
      const row = h('div', { class: 'h-item' },
        h('video', { src: it.url + '#t=1', preload: 'metadata', muted: true }),
        h('div', {},
          h('b', {}, it.name),
          h('small', {}, `${fmtSize(it.size)} · ${new Date(it.time).toLocaleString('vi-VN')}`),
          h('div', { class: 'h-actions' },
            h('a', { class: 'btn secondary', href: it.url, download: it.name }, 'Tải'),
            it.srt && h('a', { class: 'btn ghost', href: it.srt, download: '' }, 'SRT'),
            h('button', { class: 'btn ghost', onclick: async () => {
              if (!confirm('Xoá video này?')) return;
              await api('/api/outputs/' + encodeURIComponent(it.name), { method: 'DELETE' });
              row.remove();
            } }, 'Xoá'))));
      return row;
    }));
  } catch (e) {
    list.replaceChildren(h('p', { class: 'empty' }, e.message));
  }
}
function closeHistory() {
  $('#drawer').classList.remove('open');
  if (!$('#subs-drawer').classList.contains('open')) $('#drawer-backdrop').hidden = true;
}

// ---------- Settings ----------
async function refreshSettings() {
  const s = await api('/api/settings');
  state.hasKey = s.hasApiKey;
  $('#key-dot').classList.toggle('ok', s.hasApiKey);
  $('#key-status').textContent = s.fromEnv
    ? '✓ Đang dùng key từ biến môi trường GEMINI_API_KEY.'
    : s.hasApiKey ? '✓ Đã lưu key.' : 'Chưa có key — phụ đề AI sẽ không hoạt động.';
}
function openSettings() {
  $('#api-key').value = '';
  $('#settings-modal').showModal();
}

// ---------- Keyboard ----------
function onKey(e) {
  if (e.key === 'Escape') { closeHistory(); closeSubs(); return; }
  if (document.querySelector('dialog[open]')) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); startRender(false); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || !state.video) return;
  const native = state.view !== 'original';
  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'arrowleft': if (!native || e.target !== V()) { e.preventDefault(); seekBy(e.shiftKey ? -5 : -1); } break;
    case 'arrowright': if (!native || e.target !== V()) { e.preventDefault(); seekBy(e.shiftKey ? 5 : 1); } break;
    case 'i': markTrim('in'); break;
    case 'o': markTrim('out'); break;
    case 'p': if (state.templateId && !(state.job && !state.job.preview)) startRender(true); break;
    case 'l': setLive(!state.live); toast(state.live ? 'Bật hiệu ứng trực tiếp' : 'Tắt hiệu ứng trực tiếp', '', 1400); break;
    case 'm': state.userMuted = !state.userMuted; applyLive(); break;
    default:
  }
}

// ---------- Wire up ----------
function bind() {
  const dz = $('#dropzone');
  $('#file-input').addEventListener('change', (e) => handleVideoFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (!dz.hidden) dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f && (f.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name))) {
      if (state.job) return toast('Đang xử lý, đợi xong rồi đổi video nhé.', 'error');
      handleVideoFile(f);
    }
  });
  $('#btn-change').addEventListener('click', () => {
    if (state.job) return toast('Đang xử lý, đợi xong rồi đổi video nhé.', 'error');
    $('#file-input').value = '';
    $('#file-input').click();
  });

  // player
  const vid = V();
  const onPlayState = () => {
    const playing = !vid.paused;
    $('#viewer').classList.toggle('playing', playing);
    $('#t-play').classList.toggle('on', playing);
    $('#big-play').setAttribute('aria-label', playing ? 'Dừng' : 'Phát');
    syncMusic();
    frameTick();
  };
  vid.addEventListener('play', onPlayState);
  vid.addEventListener('pause', onPlayState);
  vid.addEventListener('seeked', () => { syncMusic(); frameTick(); });
  vid.addEventListener('timeupdate', () => { if (vid.paused) frameTick(); });
  vid.addEventListener('loadedmetadata', () => { layoutFrame(); frameTick(); });
  vid.addEventListener('ended', () => {
    if (state.view !== 'original') return;
    vid.currentTime = trimRange().start;
    vid.play().catch(() => {});
  });
  vid.addEventListener('click', () => { if (state.view === 'original') togglePlay(); });
  $('#big-play').addEventListener('click', togglePlay);
  $('#t-play').addEventListener('click', togglePlay);
  $('#t-mute').addEventListener('click', () => { state.userMuted = !state.userMuted; applyLive(); });
  $('#live-toggle').checked = state.live;
  $('#live-toggle').addEventListener('change', (e) => setLive(e.target.checked));
  new ResizeObserver(() => layoutFrame()).observe($('#viewer'));
  bindTimeline();
  $('#trim-in').addEventListener('click', () => markTrim('in'));
  $('#trim-out').addEventListener('click', () => markTrim('out'));
  $('#trim-reset').addEventListener('click', () => setTrim(0, Infinity));

  $$('#view-tabs .tab').forEach((t) => t.addEventListener('click', () => !t.disabled && setView(t.dataset.view)));
  $$('.side-tab').forEach((t) => t.addEventListener('click', () => {
    $$('.side-tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + t.dataset.panel));
  }));

  $('#btn-preview').addEventListener('click', () => startRender(true));
  $('#btn-export').addEventListener('click', () => startRender(false));
  $('#btn-cancel').addEventListener('click', () => state.job && fetch(`/api/jobs/${state.job.id}/cancel`, { method: 'POST' }));
  $('#rp-close').addEventListener('click', () => ($('#result-panel').hidden = true));
  $('#btn-reset').addEventListener('click', () => state.templateId && selectTemplate(state.templateId, { silent: true }));
  $('#btn-save-tpl').addEventListener('click', openSaveTemplate);
  $('#save-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    if (!$('#tpl-name').value.trim()) { e.preventDefault(); return toast('Hãy đặt tên cho mẫu.', 'error'); }
    saveTemplate();
  });

  $('#btn-history').addEventListener('click', openHistory);
  $('#drawer-close').addEventListener('click', closeHistory);
  $('#drawer-backdrop').addEventListener('click', () => { closeHistory(); closeSubs(); });
  $('#subs-close').addEventListener('click', closeSubs);
  $('#subs-regen').addEventListener('click', startTranscribe);
  $('#subs-clear').addEventListener('click', () => {
    if (!confirm('Bỏ bản phụ đề đã sửa? Khi xuất, AI sẽ tự tạo lại.')) return;
    state.captions = null;
    renderCaps();
    saveSession();
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    const key = $('#api-key').value.trim();
    if (!key) { e.preventDefault(); return toast('Dán API key vào ô trước đã.', 'error'); }
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ apiKey: key }) });
    await refreshSettings();
    renderSections();
    toast('Đã lưu Gemini API key.', 'success');
  });

  document.addEventListener('keydown', onKey);
  // stop Space from also "clicking" a focused button after we used it for play/pause
  document.addEventListener('keyup', (e) => { if (e.key === ' ' && e.target.tagName === 'BUTTON' && !document.querySelector('dialog[open]')) e.preventDefault(); });
}

async function init() {
  bind();
  try {
    await Promise.all([loadTemplates(), refreshSettings()]);
    renderSections();
    await restoreSession();
  } catch (e) {
    toast('Không kết nối được server: ' + e.message, 'error', 10000);
  }
  updateSteps();
}
init();
