// Edit config schema + built-in templates.
// A template is just a partial config merged on top of DEFAULT_CONFIG.

export const DEFAULT_CONFIG = {
  trim: { start: 0, end: 0 }, // seconds in source; end 0 = until the end
  jumpcut: { enabled: false, threshold: -32, minSilence: 0.6, padding: 0.15 },
  speed: { enabled: false, factor: 1, mute: false },
  boomerang: { enabled: false, length: 2.5 },
  format: { enabled: false, ratio: '9:16', mode: 'blur' },
  color: { enabled: false, preset: 'cinematic', intensity: 1 },
  film: { enabled: false, grain: 10, vignette: true, letterbox: false },
  subtitles: {
    enabled: false, style: 'tiktok', position: 'auto', uppercase: false,
    smartAnalysis: true, highlightKeywords: true, emojis: true, color: '#c8ff3d',
  },
  title: { enabled: false, text: 'Tiêu đề video', duration: 3, position: 'center' },
  watermark: { enabled: false, text: '@ten_cua_ban', position: 'bottom-right' },
  outro: { enabled: false, text: 'Cảm ơn đã xem!', duration: 3 },
  fade: { enabled: false, duration: 0.8 },
  music: { enabled: false, fileId: null, fileName: null, volume: 0.25, originalVolume: 1, ducking: true },
  loudnorm: { enabled: false, target: -14 },
  export: { quality: 'high', resolution: 1080 },
};

export const TEMPLATES = [
  {
    id: 'tiktok-viral',
    name: 'TikTok Viral',
    desc: 'Dọc 9:16 nền mờ, màu rực, cắt khoảng lặng, phụ đề nhảy chữ',
    tags: ['9:16', 'AI phụ đề', 'Jump cut'],
    gradient: ['#ff2d75', '#7a3cff'],
    css: 'saturate(1.45) contrast(1.06)',
    config: {
      format: { enabled: true, ratio: '9:16', mode: 'blur' },
      color: { enabled: true, preset: 'vivid' },
      jumpcut: { enabled: true },
      subtitles: { enabled: true, style: 'tiktok', uppercase: true },
      watermark: { enabled: true },
      loudnorm: { enabled: true, target: -14 },
    },
  },
  {
    id: 'shorts-clean',
    name: 'Shorts Gọn Gàng',
    desc: 'Crop đầy khung dọc, phụ đề nền đen dễ đọc, chuyển cảnh mượt',
    tags: ['9:16', 'AI phụ đề'],
    gradient: ['#ff4b2b', '#ff9a3c'],
    css: 'contrast(1.04) saturate(1.1)',
    config: {
      format: { enabled: true, ratio: '9:16', mode: 'crop' },
      subtitles: { enabled: true, style: 'classic' },
      fade: { enabled: true, duration: 0.5 },
      loudnorm: { enabled: true, target: -14 },
    },
  },
  {
    id: 'podcast',
    name: 'Podcast / Talking',
    desc: 'Cắt lặng gắt, phụ đề karaoke, tông ấm cho người nói',
    tags: ['Jump cut', 'AI phụ đề'],
    gradient: ['#f7971e', '#ffd200'],
    css: 'sepia(0.15) saturate(1.15) contrast(1.05)',
    config: {
      jumpcut: { enabled: true, threshold: -35, minSilence: 0.4, padding: 0.1 },
      color: { enabled: true, preset: 'warm', intensity: 0.8 },
      subtitles: { enabled: true, style: 'tiktok', uppercase: false },
      loudnorm: { enabled: true, target: -16 },
    },
  },
  {
    id: 'cinematic',
    name: 'Điện Ảnh',
    desc: 'Teal & orange, viền đen 2.39:1, hạt phim, mở/kết mờ dần',
    tags: ['Màu phim', 'Letterbox'],
    gradient: ['#0f4c5c', '#e36414'],
    css: 'contrast(1.12) saturate(0.85) sepia(0.12) hue-rotate(-8deg)',
    config: {
      color: { enabled: true, preset: 'cinematic' },
      film: { enabled: true, grain: 6, vignette: true, letterbox: true },
      fade: { enabled: true, duration: 1.2 },
      title: { enabled: true, text: 'Một câu chuyện', duration: 3.5, position: 'center' },
    },
  },
  {
    id: 'vintage',
    name: 'Phim Cũ Retro',
    desc: 'Màu film cổ điển, hạt dày, vignette, cảm giác hoài niệm',
    tags: ['Retro', 'Grain'],
    gradient: ['#8e5b3a', '#d9a066'],
    css: 'sepia(0.45) contrast(1.05) saturate(0.8) brightness(1.03)',
    config: {
      color: { enabled: true, preset: 'vintage' },
      film: { enabled: true, grain: 18, vignette: true, letterbox: false },
      fade: { enabled: true, duration: 1 },
    },
  },
  {
    id: 'bw',
    name: 'Đen Trắng Nghệ Thuật',
    desc: 'Đơn sắc tương phản cao, hạt nhẹ, rất "art"',
    tags: ['B&W'],
    gradient: ['#1c1c1c', '#9a9a9a'],
    css: 'grayscale(1) contrast(1.2)',
    config: {
      color: { enabled: true, preset: 'bw' },
      film: { enabled: true, grain: 10, vignette: true, letterbox: false },
      fade: { enabled: true, duration: 1 },
    },
  },
  {
    id: 'vlog',
    name: 'Vlog Tươi Sáng',
    desc: 'Màu ấm sáng, tiêu đề mở đầu, outro cảm ơn, ghép nhạc nền',
    tags: ['Nhạc nền', 'Intro/Outro'],
    gradient: ['#11998e', '#38ef7d'],
    css: 'brightness(1.06) saturate(1.25) sepia(0.08)',
    config: {
      color: { enabled: true, preset: 'warm' },
      title: { enabled: true, text: 'Vlog hôm nay', duration: 3, position: 'center' },
      outro: { enabled: true },
      watermark: { enabled: true },
      music: { enabled: true },
      fade: { enabled: true, duration: 0.6 },
    },
  },
  {
    id: 'dreamy-slowmo',
    name: 'Slow-mo Mơ Màng',
    desc: 'Chậm 0.5x, hiệu ứng glow mềm, mờ dần đầu/cuối',
    tags: ['Slow motion', 'Glow'],
    gradient: ['#c471f5', '#fa71cd'],
    css: 'brightness(1.08) saturate(0.95) contrast(0.95) blur(0.3px)',
    config: {
      speed: { enabled: true, factor: 0.5 },
      color: { enabled: true, preset: 'dreamy' },
      fade: { enabled: true, duration: 1.2 },
    },
  },
  {
    id: 'timelapse',
    name: 'Tua Nhanh Timelapse',
    desc: 'Tăng tốc 4x, tắt tiếng gốc, màu rực — hợp ghép nhạc',
    tags: ['4x', 'Speed'],
    gradient: ['#00c6ff', '#0072ff'],
    css: 'saturate(1.35) contrast(1.08)',
    config: {
      speed: { enabled: true, factor: 4, mute: true },
      color: { enabled: true, preset: 'vivid' },
    },
  },
  {
    id: 'boomerang',
    name: 'Boomerang',
    desc: 'Lặp tới-lui đoạn đầu video như Instagram Boomerang',
    tags: ['Loop', 'Ngắn'],
    gradient: ['#f953c6', '#b91d73'],
    css: 'saturate(1.3) contrast(1.05)',
    config: {
      boomerang: { enabled: true, length: 2 },
      color: { enabled: true, preset: 'vivid', intensity: 0.8 },
    },
  },
  {
    id: 'moody',
    name: 'Moody Tối Màu',
    desc: 'Tông trầm, giảm bão hoà, hợp video du lịch / cảm xúc',
    tags: ['Màu', 'Cảm xúc'],
    gradient: ['#232526', '#414345'],
    css: 'brightness(0.9) saturate(0.7) contrast(1.12) hue-rotate(-6deg)',
    config: {
      color: { enabled: true, preset: 'moody' },
      film: { enabled: true, grain: 8, vignette: true, letterbox: false },
      fade: { enabled: true, duration: 1 },
    },
  },
  {
    id: 'insta-square',
    name: 'Instagram Vuông',
    desc: 'Khung 1:1 nền mờ, tông ấm, watermark tên bạn',
    tags: ['1:1'],
    gradient: ['#feda75', '#d62976'],
    css: 'saturate(1.2) sepia(0.1) brightness(1.03)',
    config: {
      format: { enabled: true, ratio: '1:1', mode: 'blur' },
      color: { enabled: true, preset: 'warm' },
      watermark: { enabled: true },
    },
  },
  {
    id: 'custom',
    name: 'Tự Do',
    desc: 'Bắt đầu trống, tự bật các hiệu ứng bạn muốn',
    tags: ['Tuỳ chỉnh'],
    gradient: ['#434343', '#6b6b83'],
    css: 'none',
    config: {},
  },
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, over) {
  const out = structuredClone(base);
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

const num = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const pick = (v, list, def) => (list.includes(v) ? v : def);
const str = (v, def, max = 120) => (typeof v === 'string' ? v.slice(0, max) : def);

/** Merge user config with defaults and clamp every value to a safe range. */
export function sanitizeConfig(input) {
  const c = deepMerge(DEFAULT_CONFIG, input);
  const D = DEFAULT_CONFIG;
  // A group sent with the wrong type (string / null / array) falls back to its defaults.
  for (const k of Object.keys(D)) if (!isObj(c[k])) c[k] = structuredClone(D[k]);
  for (const k of Object.keys(D)) if ('enabled' in D[k]) c[k].enabled = !!c[k].enabled;

  c.jumpcut.threshold = num(c.jumpcut.threshold, D.jumpcut.threshold, -60, -10);
  c.jumpcut.minSilence = num(c.jumpcut.minSilence, D.jumpcut.minSilence, 0.2, 3);
  c.jumpcut.padding = num(c.jumpcut.padding, D.jumpcut.padding, 0, 0.5);
  c.speed.factor = num(c.speed.factor, 1, 0.25, 8);
  c.speed.mute = !!c.speed.mute;
  c.boomerang.length = num(c.boomerang.length, 2.5, 0.5, 5);
  c.format.ratio = pick(c.format.ratio, ['9:16', '1:1', '4:5', '16:9'], '9:16');
  c.format.mode = pick(c.format.mode, ['blur', 'crop', 'fit'], 'blur');
  c.color.preset = pick(c.color.preset, ['cinematic', 'vintage', 'bw', 'vivid', 'warm', 'cool', 'moody', 'dreamy'], 'cinematic');
  c.color.intensity = num(c.color.intensity, 1, 0, 1);
  c.film.grain = num(c.film.grain, 10, 0, 40);
  c.film.vignette = !!c.film.vignette;
  c.film.letterbox = !!c.film.letterbox;
  c.subtitles.style = pick(c.subtitles.style, ['tiktok', 'classic', 'minimal'], 'tiktok');
  c.subtitles.position = pick(c.subtitles.position, ['auto', 'bottom', 'middle', 'top'], 'auto');
  c.subtitles.uppercase = !!c.subtitles.uppercase;
  c.subtitles.smartAnalysis = !!c.subtitles.smartAnalysis;
  c.subtitles.highlightKeywords = !!c.subtitles.highlightKeywords;
  c.subtitles.emojis = !!c.subtitles.emojis;
  c.subtitles.color = typeof c.subtitles.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.subtitles.color) ? c.subtitles.color : '#c8ff3d';
  c.title.text = str(c.title.text, '');
  c.title.duration = num(c.title.duration, 3, 0.5, 15);
  c.title.position = pick(c.title.position, ['center', 'top', 'bottom'], 'center');
  c.watermark.text = str(c.watermark.text, '', 60);
  c.watermark.position = pick(c.watermark.position, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'bottom-right');
  c.outro.text = str(c.outro.text, '');
  c.outro.duration = num(c.outro.duration, 3, 0.5, 10);
  c.fade.duration = num(c.fade.duration, 0.8, 0.1, 5);
  c.music.volume = num(c.music.volume, 0.25, 0, 2);
  c.music.originalVolume = num(c.music.originalVolume, 1, 0, 2);
  c.music.ducking = !!c.music.ducking;
  c.music.fileId = typeof c.music.fileId === 'string' && /^[\w-]+$/.test(c.music.fileId) ? c.music.fileId : null;
  c.trim.start = num(c.trim.start, 0, 0, 1e6);
  c.trim.end = num(c.trim.end, 0, 0, 1e6);
  if (c.trim.end > 0 && c.trim.end <= c.trim.start) c.trim.end = 0;
  c.loudnorm.target = num(c.loudnorm.target, -14, -24, -9);
  c.export.quality = pick(c.export.quality, ['high', 'balanced', 'small'], 'high');
  c.export.resolution = pick(Number(c.export.resolution), [720, 1080], 1080);
  return c;
}
