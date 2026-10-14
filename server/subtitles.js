// AI subtitles: Gemini transcription (word timestamps) + multimodal video analysis -> ASS / SRT.
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { runFFmpeg } from './ffmpeg.js';

const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const ANALYSIS_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const INLINE_LIMIT = 14 * 1024 * 1024; // keep total request < 20 MB

const parseOffset = (v) => {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/s$/, ''));
};

/** Convert hex (#c8ff3d) to ASS &HAABBGGRR color format */
export function hexToASS(hex, alpha = '00') {
  if (!hex || typeof hex !== 'string') return `&H${alpha}3DFFC8`;
  const m = hex.replace('#', '').trim();
  if (m.length !== 6) return `&H${alpha}3DFFC8`;
  const r = m.slice(0, 2);
  const g = m.slice(2, 4);
  const b = m.slice(4, 6);
  return `&H${alpha}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

/** Transcribe an mp3 file. Returns [{ text, start, end, isKeyword? }] in seconds. */
export async function transcribe(audioPath, apiKey, { duration = 0, signal } = {}) {
  if (!apiKey) throw new Error('Chưa có Gemini API key. Mở ⚙ Cài đặt để nhập key (miễn phí tại aistudio.google.com).');
  const ai = new GoogleGenAI({ apiKey });

  let audio;
  const size = fs.statSync(audioPath).size;
  if (size <= INLINE_LIMIT) {
    audio = { type: 'audio', data: fs.readFileSync(audioPath).toString('base64'), mime_type: 'audio/mp3' };
  } else {
    const file = await ai.files.upload({ file: audioPath, config: { mimeType: 'audio/mp3' } });
    audio = { type: 'audio', uri: file.uri, mime_type: file.mimeType || 'audio/mp3' };
  }
  if (signal?.aborted) throw new Error('Đã huỷ');

  const interaction = await ai.interactions.create({
    model: TRANSCRIBE_MODEL,
    input: [audio],
    store: false,
    generation_config: {
      transcription_config: { mode: { type: 'verbatim', timestamp_granularities: ['word'] } },
    },
  });

  const words = [];
  for (const step of interaction.steps ?? []) {
    for (const content of step.content ?? []) {
      for (const a of content.annotations ?? []) {
        if (a.type !== 'word_info') continue;
        const start = parseOffset(a.start_offset);
        const end = parseOffset(a.end_offset);
        const text = String(a.text || '').trim();
        if (text && Number.isFinite(start)) words.push({ text, start, end: Number.isFinite(end) ? end : start + 0.3 });
      }
    }
  }
  if (words.length) return words;

  // Fallback: no word annotations -> spread the plain transcript evenly.
  const text = (interaction.output_text || '').trim();
  if (!text) return [];
  const tokens = text.split(/\s+/);
  const per = (duration || tokens.length * 0.35) / tokens.length;
  return tokens.map((t, i) => ({ text: t, start: i * per, end: (i + 1) * per }));
}

/**
 * Multimodal video analysis:
 * 1. Analyzes visual composition (subject/face position -> safe subtitle placement).
 * 2. Analyzes topic & energy tone -> recommends style & highlight palette.
 * 3. Extracts high-impact keywords & contextual emojis for each caption sentence.
 */
export async function analyzeVideoSubtitles({ videoPath, duration = 0, captions = [], apiKey, signal, config = {}, jobDir }) {
  if (!apiKey || !videoPath || !fs.existsSync(videoPath) || !captions?.length) return null;
  const ai = new GoogleGenAI({ apiKey });

  // Extract up to 2 keyframes to examine composition
  const frames = [];
  const dir = jobDir || path.resolve('data', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  const times = duration > 4 ? [Math.max(0.5, duration * 0.25), Math.min(duration - 0.5, duration * 0.65)] : [Math.max(0.2, duration * 0.5)];
  for (let i = 0; i < times.length; i++) {
    const fPath = path.join(dir, `ai-frame-${i}.jpg`);
    try {
      await runFFmpeg(['-ss', times[i].toFixed(2), '-i', videoPath, '-vf', 'scale=480:-2', '-vframes', '1', '-q:v', '4', fPath], { signal });
      if (fs.existsSync(fPath)) frames.push(fPath);
    } catch { /* skip if frame extract fails */ }
  }

  const sampleCaps = captions.slice(0, 30).map((c, idx) => ({
    id: idx,
    text: c.words.map((w) => w.text).join(' '),
  }));

  const contents = [];
  for (const fp of frames) {
    contents.push({
      inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(fp).toString('base64') },
    });
  }

  const prompt = `Bạn là chuyên gia dựng video và thiết kế phụ đề AI tự động.
Hãy phân tích hình ảnh khung hình video và các câu phụ đề sau:
${JSON.stringify(sampleCaps)}

Yêu cầu phân tích:
1. Bố cục hình ảnh: Khuôn mặt hoặc chủ thể chính nằm ở vị trí nào? Vùng an toàn để đặt phụ đề mà KHÔNG che mặt người nói hay đè lên chi tiết quan trọng là: "bottom" (dưới đáy), "middle" (trung tâm hơi thấp để né đáy) hay "top" (đỉnh màn hình)?
2. Thể loại & cảm xúc video: Đề xuất "recommendedStyle" ('tiktok' | 'classic' | 'minimal'), màu nhấn "highlightColor" (hex dạng #c8ff3d, #ffe100, #ff4f7b, #45c8ff) và "tone" ('energetic' | 'calm' | 'cinematic' | 'tech' | 'story').
3. Với từng câu phụ đề:
   - "keywords": danh sách 1-3 từ khoá quan trọng, số liệu hoặc từ cảm xúc đắt giá nhất cần highlight đổi màu.
   - "emoji": 1 emoji phù hợp nhất với ý nghĩa của câu (hoặc "" nếu câu bình thường).

Trả về định dạng JSON thuần:
{
  "safePosition": "bottom",
  "recommendedMarginV": 0.14,
  "recommendedStyle": "tiktok",
  "highlightColor": "#c8ff3d",
  "tone": "energetic",
  "captions": [
    { "id": 0, "keywords": ["từ", "khóa"], "emoji": "⚡" }
  ]
}`;

  contents.push(prompt);

  let analysis = null;
  for (const model of ANALYSIS_MODELS) {
    if (signal?.aborted) throw new Error('Đã huỷ');
    try {
      const res = await ai.models.generateContent({
        model,
        contents,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(res.text || '{}');
      if (parsed.safePosition) {
        analysis = parsed;
        break;
      }
    } catch {
      // try fallback model
    }
  }

  if (!analysis) {
    analysis = fallbackSubtitleAnalysis(captions, { duration, videoPath });
  }

  applyAnalysis(captions, analysis, config);
  return analysis;
}

const VI_EMOJI_RULES = [
  { match: /(?:^|\s)(chào|hello|xin chào)(?:$|\s|[.,!?;:…])/i, emoji: '👋' },
  { match: /(?:^|\s)(tuyệt|hay|đẹp|đỉnh|xuất sắc|cháy|hot)(?:$|\s|[.,!?;:…])/i, emoji: '🔥' },
  { match: /(?:^|\s)(ai|công nghệ|robot|phần mềm|studio|tool|app)(?:$|\s|[.,!?;:…])/i, emoji: '🤖' },
  { match: /(?:^|\s)(nhanh|tốc độ|ngay|tức thì|chớp mắt)(?:$|\s|[.,!?;:…])/i, emoji: '⚡' },
  { match: /(?:^|\s)(video|phim|clip|xem|dựng|quay)(?:$|\s|[.,!?;:…])/i, emoji: '🎬' },
  { match: /(?:^|\s)(tiền|giá|triệu|tỷ|đô|doanh thu|lợi nhuận)(?:$|\s|[.,!?;:…])|\$|%|\d+k/i, emoji: '💰' },
  { match: /(?:^|\s)(yêu|thích|tâm huyết|cảm ơn|biết ơn)(?:$|\s|[.,!?;:…])/i, emoji: '❤️' },
  { match: /(?:^|\s)(chú ý|lưu ý|cảnh báo|quan trọng|bí mật)(?:$|\s|[.,!?;:…])/i, emoji: '⚠️' },
  { match: /(?:^|\s)(mới|bắt đầu|khởi động|phát triển|tăng trưởng)(?:$|\s|[.,!?;:…])/i, emoji: '🚀' },
  { match: /(?:^|\s)(học|kiến thức|chia sẻ|kinh nghiệm|mẹo|tip)(?:$|\s|[.,!?;:…])/i, emoji: '💡' },
  { match: /(?:^|\s)(vui|cười|hài|thú vị|bất ngờ)(?:$|\s|[.,!?;:…])/i, emoji: '😄' },
];

const VI_STOP_WORDS = new Set([
  'và', 'là', 'của', 'có', 'cho', 'với', 'trong', 'được', 'các', 'những', 'một',
  'này', 'đó', 'thì', 'ở', 'đến', 'từ', 'khi', 'về', 'đã', 'sẽ', 'đang', 'ra',
  'vào', 'lại', 'qua', 'lên', 'xuống', 'làm', 'đi', 'nói', 'rằng', 'như', 'nhưng',
  'đây', 'thế', 'nào', 'ai', 'gì', 'sao', 'rồi', 'bị', 'bởi', 'do', 'để', 'mà',
  'chúng', 'ta', 'tôi', 'bạn', 'mình', 'họ', 'nó', 'anh', 'em', 'chị',
]);

/** Smart rule-based subtitle analysis fallback (handles keywords, emoji, safe position) */
export function fallbackSubtitleAnalysis(captions, meta = {}) {
  const items = captions.map((cp, idx) => {
    const text = cp.words ? cp.words.map((w) => w.text).join(' ') : String(cp.text || '');
    let emoji = '';
    for (const rule of VI_EMOJI_RULES) {
      if (rule.match.test(text)) { emoji = rule.emoji; break; }
    }
    const tokens = text.split(/\s+/).map((t) => t.replace(/[.,!?;:…"'()]/g, '').trim()).filter(Boolean);
    const candidates = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (/\d/.test(t)) { candidates.push(t); continue; }
      const lower = t.toLowerCase();
      if (t.length >= 2 && !VI_STOP_WORDS.has(lower)) {
        if (/^[A-ZĐÀÁẢÃẠÂẦẤẨẪẬĂẰẮẲẴẶÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ]/.test(t) && i > 0) {
          candidates.push(t);
        } else if (t.length >= 4) {
          candidates.push(t);
        }
      }
    }
    return {
      id: idx,
      keywords: candidates.slice(0, 2),
      emoji: emoji || '✨',
    };
  });

  return {
    safePosition: 'bottom',
    recommendedMarginV: 0.16,
    recommendedStyle: 'tiktok',
    highlightColor: '#c8ff3d',
    tone: 'energetic',
    captions: items,
  };
}

/** Apply keywords & emojis from analysis to caption items */
export function applyAnalysis(captions, analysis, config = {}) {
  if (!analysis || !captions?.length) return;
  const map = new Map((analysis.captions || []).map((c) => [c.id, c]));
  for (let i = 0; i < captions.length; i++) {
    const info = map.get(i);
    if (!info) continue;
    if (info.emoji && config.emojis !== false && !captions[i].emoji) {
      captions[i].emoji = String(info.emoji).trim();
    }
    const kws = (info.keywords || []).map((k) => String(k).toLowerCase().trim());
    if (kws.length && captions[i].words && config.highlightKeywords !== false) {
      for (const w of captions[i].words) {
        const clean = w.text.toLowerCase().replace(/[.,!?;:…"'()]/g, '');
        if (clean.length >= 2 && kws.some((k) => k.includes(clean) || clean.includes(k))) {
          w.isKeyword = true;
        }
      }
    }
  }
}

/** Sample words for previews so the user can see the caption style and highlight without spending API calls. */
export function sampleWords(duration) {
  const sentence = [
    { text: 'Đây', isKeyword: false },
    { text: 'là', isKeyword: false },
    { text: 'phụ', isKeyword: false },
    { text: 'đề', isKeyword: false },
    { text: 'VideoStudio', isKeyword: true },
    { text: 'tự', isKeyword: false },
    { text: 'động', isKeyword: false },
    { text: 'thông', isKeyword: true },
    { text: 'minh', isKeyword: true },
    { text: 'bằng', isKeyword: false },
    { text: 'AI', isKeyword: true },
  ];
  const words = [];
  let t = 0.3;
  let i = 0;
  while (t < duration - 0.2) {
    const w = sentence[i % sentence.length];
    words.push({ text: w.text, start: t, end: t + 0.3, isKeyword: w.isKeyword });
    t += 0.36;
    i++;
    if (i % sentence.length === 0) t += 0.6;
  }
  return words;
}

const LIMITS = {
  tiktok: { words: 3, secs: 1.6, chars: 22 },
  classic: { words: 9, secs: 3.6, chars: 44 },
  minimal: { words: 9, secs: 3.6, chars: 44 },
};

/** Group words into caption chunks. */
export function buildCaptions(words, style = 'tiktok') {
  const lim = LIMITS[style] || LIMITS.classic;
  const caps = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    caps.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur, emoji: '' });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
      if (
        cur.length >= lim.words ||
        w.end - cur[0].start > lim.secs ||
        chars > lim.chars ||
        w.start - prev.end > 0.6 ||
        /[.!?…,;:]$/.test(prev.text)
      ) flush();
    }
    cur.push(w);
  }
  flush();
  // Hold each caption until the next one (max +0.5s) so text doesn't flicker.
  for (let i = 0; i < caps.length; i++) {
    const next = caps[i + 1];
    const hold = caps[i].end + 0.5;
    caps[i].end = next ? Math.min(hold, next.start) : hold;
    if (caps[i].end <= caps[i].start) caps[i].end = caps[i].start + 0.2;
  }
  return caps;
}

const assTime = (s) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};
const srtTime = (s) => {
  s = Math.max(0, s);
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const assEscape = (t) => t.replace(/\\/g, '＼').replace(/[{}]/g, '').replace(/\n/g, ' ');

export const FONT_BOLD = 'Be Vietnam Pro ExtraBold';
export const FONT_SEMI = 'Be Vietnam Pro SemiBold';

/** Build an ASS subtitle file sized for a W x H video with smart positioning & keyword highlights. */
export function toASS(captions, {
  width, height, style = 'tiktok', position = 'auto', uppercase = false,
  highlightKeywords = true, emojis = true, color = '#c8ff3d', analysis = null,
} = {}) {
  const base = Math.min(width, height);

  // Position: auto selects safePosition from analysis, or falls back to bottom
  const effPos = position === 'auto' ? (analysis?.safePosition || 'bottom') : position;
  const align = { bottom: 2, middle: 5, top: 8 }[effPos] || 2;

  let marginV;
  if (analysis?.recommendedMarginV && effPos === analysis?.safePosition) {
    marginV = Math.round(height * Math.max(0.06, Math.min(0.4, analysis.recommendedMarginV)));
  } else if (effPos === 'middle') {
    marginV = Math.round(height * 0.12);
  } else if (effPos === 'top') {
    marginV = Math.round(height * 0.1);
  } else {
    marginV = Math.round(height * (style === 'tiktok' ? 0.18 : 0.08));
  }
  const marginH = Math.round(width * 0.07);

  // Highlight color (lime/yellow/custom) in ASS BBGGRR format
  const activeColor = color || analysis?.highlightColor || '#c8ff3d';
  const assHighlight = hexToASS(activeColor);

  // Default styles
  let styleLine;
  if (style === 'tiktok') {
    const fs = Math.round(base * 0.082);
    // Primary = highlight color, Secondary = not-yet-spoken (white) -> karaoke \k
    styleLine = `Style: Default,${FONT_BOLD},${fs},${assHighlight},&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(fs * 0.09))},${Math.round(fs * 0.05)},${align},${marginH},${marginH},${marginV},1`;
  } else if (style === 'classic') {
    const fs = Math.round(base * 0.05);
    styleLine = `Style: Default,${FONT_SEMI},${fs},&H00FFFFFF,&H00FFFFFF,&H99000000,&H99000000,0,0,0,0,100,100,0,0,3,${Math.round(fs * 0.3)},0,${align},${marginH},${marginH},${marginV},1`;
  } else {
    const fs = Math.round(base * 0.044);
    styleLine = `Style: Default,${FONT_SEMI},${fs},&H00FFFFFF,&H00FFFFFF,&H50000000,&H80000000,0,0,0,0,100,100,0.5,0,1,${Math.max(1, Math.round(fs * 0.06))},${Math.max(1, Math.round(fs * 0.05))},${align},${marginH},${marginH},${marginV},1`;
  }

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const c of captions) {
    const fmt = (t) => assEscape(uppercase ? t.toLocaleUpperCase('vi') : t);
    let text;
    if (style === 'tiktok') {
      // Pop-in + per-word karaoke highlight + optional keyword emphasis
      let t = c.start;
      text = '{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}' + c.words.map((w) => {
        const k = Math.max(1, Math.round((Math.max(w.start, t) - t) * 100));
        const lead = w.start > t ? `{\\k${k}}` : '';
        const dur = Math.max(1, Math.round((w.end - Math.max(w.start, t)) * 100));
        t = Math.max(w.end, t);
        const isKey = !!w.isKeyword && highlightKeywords;
        const keyTag = isKey ? `{\\1c${assHighlight}&\\fscx112\\fscy112}` : '';
        const rTag = isKey ? '{\\r}' : '';
        return `${lead}{\\k${dur}}${keyTag}${fmt(w.text)}${rTag}`;
      }).join(' ');
      if (emojis && c.emoji) {
        text += ` {\\fscx115\\fscy115}${assEscape(c.emoji)}{\\r}`;
      }
    } else {
      // Classic or minimal
      text = '{\\fad(120,80)}' + c.words.map((w) => {
        const isKey = !!w.isKeyword && highlightKeywords;
        return isKey ? `{\\1c${assHighlight}&\\b1}${fmt(w.text)}{\\r}` : fmt(w.text);
      }).join(' ');
      if (emojis && c.emoji) {
        text += ` ${assEscape(c.emoji)}`;
      }
    }
    lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${text}`);
  }
  return lines.join('\n') + '\n';
}

export function toSRT(captions, { emojis = true } = {}) {
  return captions
    .map((c, i) => {
      const em = emojis && c.emoji ? ` ${c.emoji}` : '';
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.words.map((w) => w.text).join(' ')}${em}\n`;
    })
    .join('\n');
}
