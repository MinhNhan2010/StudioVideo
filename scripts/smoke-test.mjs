// Smoke test: renders the test clip with every template (full + preview) and reports failures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, runFFmpeg } from '../server/ffmpeg.js';
import { render, timelineKey } from '../server/pipeline.js';
import { TEMPLATES, sanitizeConfig } from '../server/templates.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'test');
fs.mkdirSync(dir, { recursive: true });
const clip = path.join(dir, 'clip.mp4');
const music = path.join(dir, 'music.mp3');
if (!fs.existsSync(clip)) {
  await runFFmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-f', 'lavfi', '-i',
    "aevalsrc='if(between(t,3,5)+between(t,9,10),0,0.3*sin(2*PI*440*t))':s=48000:d=12",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], {});
  await runFFmpeg(['-f', 'lavfi', '-i', 'sine=f=220:d=5', music], {});
}
const meta = await probe(clip);
console.log('meta', meta);

const only = process.argv[2];
let fail = 0;
for (const t of TEMPLATES) {
  if (only && t.id !== only) continue;
  for (const preview of [true, false]) {
    const cfg = sanitizeConfig({ ...t.config, music: { ...(t.config.music || {}), fileId: 'x' } });
    if (cfg.subtitles.enabled && !preview) cfg.subtitles.enabled = false; // no API key in smoke test
    const out = path.join(dir, `${t.id}-${preview ? 'p' : 'f'}.mp4`);
    const t0 = Date.now();
    try {
      const r = await render({
        inputPath: clip, videoId: 'test', meta, config: cfg, jobDir: path.join(dir, 'job-' + t.id),
        outPath: out, preview, previewStart: 2, previewLen: 8,
        musicPath: cfg.music.enabled ? music : null, apiKey: '',
      });
      const m = await probe(out);
      console.log(`OK   ${t.id.padEnd(14)} ${preview ? 'preview' : 'full   '} ${m.width}x${m.height} ${m.duration.toFixed(2)}s audio=${m.hasAudio} ${Date.now() - t0}ms ${r.warnings.join(' | ')}`);
    } catch (e) {
      fail++;
      console.log(`FAIL ${t.id} ${preview ? 'preview' : 'full'}\n${e.message}`);
    }
  }
}
// ---- extra cases: trim window, loudnorm, edited captions ----
const extras = [
  { name: 'trim+loudnorm', config: { trim: { start: 2, end: 9 }, loudnorm: { enabled: true }, outro: { enabled: true }, fade: { enabled: true } }, expect: 7 },
  { name: 'trim+jumpcut', config: { trim: { start: 1, end: 11 }, jumpcut: { enabled: true }, color: { enabled: true, preset: 'dreamy', intensity: 0.6 } } },
  { name: 'trim+speed', config: { trim: { start: 0, end: 8 }, speed: { enabled: true, factor: 2 } }, expect: 4 },
  { name: 'edited-captions', config: { trim: { start: 1, end: 7 }, subtitles: { enabled: true, style: 'tiktok' } }, captions: true, expect: 6 },
];
if (!only) {
  for (const x of extras) {
    const cfg = sanitizeConfig(x.config);
    const out = path.join(dir, `extra-${x.name}.mp4`);
    const t0 = Date.now();
    try {
      const captions = x.captions ? [
        { start: 0.2, end: 1.6, text: 'Xin chào các bạn', words: [{ start: 0.2, end: 0.5 }, { start: 0.5, end: 0.9 }, { start: 0.9, end: 1.2 }, { start: 1.2, end: 1.6 }] },
        { start: 2, end: 3.5, text: 'đã sửa thành câu dài hơn', words: [] },
      ] : null;
      const r = await render({
        inputPath: clip, videoId: 'test', meta, config: cfg, jobDir: path.join(dir, 'job-' + x.name),
        outPath: out, preview: false, apiKey: '', captions, captionsKey: captions ? timelineKey('test', meta, cfg) : null,
      });
      const m = await probe(out);
      const bad = x.expect && Math.abs(m.duration - x.expect) > 0.35;
      if (bad || (x.captions && !r.srt)) throw new Error(`unexpected result: duration ${m.duration} srt=${r.srt}`);
      console.log(`OK   ${x.name.padEnd(16)} ${m.width}x${m.height} ${m.duration.toFixed(2)}s audio=${m.hasAudio} ${Date.now() - t0}ms ${r.warnings.join(' | ')}`);
    } catch (e) {
      fail++;
      console.log(`FAIL ${x.name}\n${e.message}`);
    }
  }
}
console.log(fail ? `${fail} failures` : 'ALL PASSED');
