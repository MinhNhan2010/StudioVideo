// Unit tests for the pure logic (no FFmpeg, no network). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeConfig, deepMerge, DEFAULT_CONFIG, TEMPLATES } from '../server/templates.js';
import { outputDims, trimWindow, timelineKey } from '../server/pipeline.js';
import { buildCaptions, sampleWords, toASS, toSRT, hexToASS, applyAnalysis } from '../server/subtitles.js';

const meta = { duration: 12, width: 1280, height: 720, fps: 30, size: 1000 };

// ---------------- templates / config ----------------
test('sanitizeConfig: defaults khi input rỗng', () => {
  assert.deepEqual(sanitizeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(sanitizeConfig(null), DEFAULT_CONFIG);
});

test('sanitizeConfig: kẹp giá trị ngoài phạm vi', () => {
  const c = sanitizeConfig({
    speed: { factor: 100 }, jumpcut: { threshold: 5, minSilence: -1 }, color: { intensity: 9, preset: 'xxx' },
    format: { ratio: '3:2' }, export: { resolution: 4320, quality: 'ultra' }, loudnorm: { target: 0 },
  });
  assert.equal(c.speed.factor, 8);
  assert.equal(c.jumpcut.threshold, -10);
  assert.equal(c.jumpcut.minSilence, 0.2);
  assert.equal(c.color.intensity, 1);
  assert.equal(c.color.preset, 'cinematic');
  assert.equal(c.format.ratio, '9:16');
  assert.equal(c.export.resolution, 1080);
  assert.equal(c.export.quality, 'high');
  assert.equal(c.loudnorm.target, -9);
});

test('sanitizeConfig: trim.end <= trim.start thì bỏ end', () => {
  assert.equal(sanitizeConfig({ trim: { start: 5, end: 3 } }).trim.end, 0);
  assert.equal(sanitizeConfig({ trim: { start: 2, end: 7 } }).trim.end, 7);
});

test('sanitizeConfig: chặn fileId nhạc độc hại', () => {
  assert.equal(sanitizeConfig({ music: { fileId: '../../etc/passwd' } }).music.fileId, null);
  assert.equal(sanitizeConfig({ music: { fileId: 'abcdef123456' } }).music.fileId, 'abcdef123456');
});

test('sanitizeConfig: enabled luôn là boolean', () => {
  const c = sanitizeConfig({ fade: { enabled: 'yes' }, film: { enabled: 0 } });
  assert.equal(c.fade.enabled, true);
  assert.equal(c.film.enabled, false);
});

test('sanitizeConfig: không crash khi nhóm cấu hình sai kiểu (string / null / array)', () => {
  for (const bad of [{ format: 'abc' }, { trim: null }, { color: [1, 2] }, { music: 42 }]) {
    const c = sanitizeConfig(bad);
    for (const k of Object.keys(DEFAULT_CONFIG)) assert.equal(typeof c[k], 'object', `${JSON.stringify(bad)} -> ${k}`);
  }
});

test('deepMerge không làm thay đổi object gốc', () => {
  const base = { a: { b: 1 } };
  const out = deepMerge(base, { a: { b: 2 } });
  assert.equal(base.a.b, 1);
  assert.equal(out.a.b, 2);
});

test('TEMPLATES: id duy nhất và config hợp lệ sau sanitize', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of TEMPLATES) {
    const c = sanitizeConfig(t.config);
    for (const [k, v] of Object.entries(t.config)) {
      for (const [kk, vv] of Object.entries(v)) assert.deepEqual(c[k][kk], vv, `${t.id}.${k}.${kk} bị sanitize thay đổi`);
    }
  }
});

// ---------------- pipeline helpers ----------------
test('outputDims: các tỉ lệ khung', () => {
  const dims = (ratio, preview = false) =>
    outputDims(meta, sanitizeConfig({ format: { enabled: true, ratio } }), preview);
  assert.deepEqual(dims('9:16'), { W: 1080, H: 1920 });
  assert.deepEqual(dims('1:1'), { W: 1080, H: 1080 });
  assert.deepEqual(dims('4:5'), { W: 1080, H: 1350 });
  assert.deepEqual(dims('16:9'), { W: 1920, H: 1080 });
  assert.deepEqual(dims('9:16', true), { W: 540, H: 960 });
});

test('outputDims: không phóng to video nhỏ, luôn chẵn', () => {
  const small = { ...meta, width: 641, height: 361 };
  const d = outputDims(small, sanitizeConfig({}), false);
  assert.ok(d.W % 2 === 0 && d.H % 2 === 0);
  assert.ok(d.W <= 642 && d.H <= 362);
  assert.deepEqual(outputDims(meta, sanitizeConfig({ export: { resolution: 720 } }), false), { W: 1280, H: 720 });
});

test('trimWindow: các trường hợp biên', () => {
  assert.deepEqual(trimWindow(meta, sanitizeConfig({})), { start: 0, end: 12 });
  assert.deepEqual(trimWindow(meta, sanitizeConfig({ trim: { start: 2, end: 9 } })), { start: 2, end: 9 });
  assert.deepEqual(trimWindow(meta, sanitizeConfig({ trim: { start: 50 } })), { start: 11.5, end: 12 });
  assert.deepEqual(trimWindow(meta, sanitizeConfig({ trim: { start: 0, end: 99 } })), { start: 0, end: 12 });
});

test('timelineKey: đổi khi đổi timeline, giữ nguyên khi đổi màu', () => {
  const k0 = timelineKey('v', meta, sanitizeConfig({}));
  assert.equal(k0, timelineKey('v', meta, sanitizeConfig({ color: { enabled: true } })));
  assert.notEqual(k0, timelineKey('v', meta, sanitizeConfig({ trim: { start: 1 } })));
  assert.notEqual(k0, timelineKey('v', meta, sanitizeConfig({ speed: { enabled: true, factor: 2 } })));
});

// ---------------- subtitles ----------------
const W = (text, start, end) => ({ text, start, end });

test('buildCaptions: tiktok tối đa 3 từ / câu', () => {
  const words = 'một hai ba bốn năm sáu bảy'.split(' ').map((t, i) => W(t, i * 0.3, i * 0.3 + 0.25));
  const caps = buildCaptions(words, 'tiktok');
  assert.ok(caps.every((c) => c.words.length <= 3));
  assert.equal(caps.flatMap((c) => c.words).length, words.length);
});

test('buildCaptions: ngắt câu ở dấu câu và khoảng nghỉ dài', () => {
  const caps = buildCaptions([W('Xin', 0, 0.3), W('chào.', 0.3, 0.6), W('Tôi', 0.7, 1), W('là', 3, 3.2)], 'classic');
  assert.deepEqual(caps.map((c) => c.words.map((w) => w.text).join(' ')), ['Xin chào.', 'Tôi', 'là']);
});

test('buildCaptions: không chồng lấn thời gian, end > start', () => {
  const caps = buildCaptions(sampleWords(10), 'tiktok');
  for (let i = 0; i < caps.length; i++) {
    assert.ok(caps[i].end > caps[i].start);
    if (caps[i + 1]) assert.ok(caps[i].end <= caps[i + 1].start + 1e-9);
  }
  assert.deepEqual(buildCaptions([], 'tiktok'), []);
});

test('toSRT: định dạng thời gian chuẩn', () => {
  const srt = toSRT([{ start: 3661.5, end: 3662.25, words: [W('Chào', 0, 0)] }]);
  assert.equal(srt, '1\n01:01:01,500 --> 01:01:02,250\nChào\n');
});

test('toASS: escape ký tự override và in hoa tiếng Việt', () => {
  const ass = toASS([{ start: 0, end: 1, words: [W('{\\b1}đường', 0, 1)] }],
    { width: 1080, height: 1920, style: 'classic', uppercase: true });
  const line = ass.split('\n').find((l) => l.startsWith('Dialogue'));
  assert.ok(!line.includes('{\\b1}'), 'không được để lọt override tag của người dùng');
  assert.ok(line.includes('ĐƯỜNG'));
  assert.match(ass, /PlayResX: 1080/);
});

test('toASS: karaoke \\k có thời lượng dương', () => {
  const ass = toASS(buildCaptions(sampleWords(5), 'tiktok'), { width: 540, height: 960, style: 'tiktok' });
  const ks = [...ass.matchAll(/\\k(-?\d+)/g)].map((m) => +m[1]);
  assert.ok(ks.length > 0 && ks.every((k) => k >= 1));
});

test('hexToASS: chuyển đổi màu hex RGB sang ASS &HAABBGGRR', () => {
  assert.equal(hexToASS('#c8ff3d'), '&H003DFFC8');
  assert.equal(hexToASS('#ff0000'), '&H000000FF');
  assert.equal(hexToASS('#0000ff'), '&H00FF0000');
  assert.equal(hexToASS('invalid'), '&H003DFFC8');
});

test('applyAnalysis: gán đúng emoji và keyword từ kết quả phân tích AI', () => {
  const captions = [
    { start: 0, end: 2, words: [{ text: 'Khóa' }, { text: 'học' }, { text: 'AI' }] },
    { start: 2, end: 4, words: [{ text: 'Rất' }, { text: 'tuyệt' }, { text: 'vời' }] },
  ];
  const analysis = {
    safePosition: 'bottom',
    highlightColor: '#ffe100',
    captions: [
      { id: 0, keywords: ['AI'], emoji: '🤖' },
      { id: 1, keywords: ['tuyệt vời'], emoji: '🔥' },
    ],
  };
  applyAnalysis(captions, analysis, { highlightKeywords: true, emojis: true });
  assert.equal(captions[0].emoji, '🤖');
  assert.equal(captions[0].words[2].isKeyword, true);
  assert.equal(captions[1].emoji, '🔥');
  assert.equal(captions[1].words[1].isKeyword, true);
});

test('toASS: hiển thị highlight keyword và emoji theo ngữ cảnh', () => {
  const captions = [
    { start: 0, end: 2, emoji: '🔥', words: [{ text: 'Video', start: 0, end: 1, isKeyword: true }, { text: 'hay', start: 1, end: 2 }] },
  ];
  const ass = toASS(captions, {
    width: 1080, height: 1920, style: 'tiktok', highlightKeywords: true, emojis: true, color: '#c8ff3d',
  });
  assert.ok(ass.includes('\\1c&H003DFFC8&'), 'phải có tag màu highlight keyword');
  assert.ok(ass.includes('🔥'), 'phải có emoji');
});

test('toSRT: xuất kèm emoji khi bật option emojis', () => {
  const captions = [
    { start: 0, end: 2, emoji: '🚀', words: [{ text: 'Khởi' }, { text: 'động' }] },
  ];
  const srtWithEmoji = toSRT(captions, { emojis: true });
  assert.ok(srtWithEmoji.includes('Khởi động 🚀'));
  const srtWithoutEmoji = toSRT(captions, { emojis: false });
  assert.ok(!srtWithoutEmoji.includes('🚀'));
});

