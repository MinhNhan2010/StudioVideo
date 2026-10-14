// The render pipeline:
//   Stage A "timeline"  : jump cut, speed, boomerang      -> timeline.mp4   (only if needed)
//   Stage B "subtitles" : Gemini transcription            -> subs.ass / .srt (only if enabled)
//   Stage C "look"      : format, color, film, text, subs, music, fades -> final mp4
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { probe, runFFmpeg, detectSilence } from './ffmpeg.js';
import { transcribe, analyzeVideoSubtitles, applyAnalysis, sampleWords, buildCaptions, toASS, toSRT } from './subtitles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS_SRC = path.join(ROOT, 'assets', 'fonts');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const f3 = (n) => Number(n).toFixed(3);

/** Final output frame size. */
export function outputDims(meta, c, preview) {
  const R = preview ? 540 : c.export.resolution; // short side
  let W, H;
  if (c.format.enabled) {
    const [rw, rh] = c.format.ratio.split(':').map(Number);
    if (rw <= rh) { W = R; H = (R * rh) / rw; } else { H = R; W = (R * rw) / rh; }
  } else {
    const k = Math.min(1, R / Math.min(meta.width, meta.height));
    W = meta.width * k;
    H = meta.height * k;
  }
  return { W: even(W), H: even(H) };
}

const needsTimeline = (c) =>
  c.jumpcut.enabled || (c.speed.enabled && (c.speed.factor !== 1 || c.speed.mute)) || c.boomerang.enabled;

function atempoChain(f) {
  const parts = [];
  while (f > 2) { parts.push('atempo=2'); f /= 2; }
  while (f < 0.5) { parts.push('atempo=0.5'); f /= 0.5; }
  if (Math.abs(f - 1) > 1e-3) parts.push(`atempo=${f3(f)}`);
  return parts;
}

/** Complement of silences -> ranges to keep. */
function keepRanges(silences, duration, padding) {
  const keep = [];
  let cursor = 0;
  for (const s of silences) {
    const cutStart = s.start + padding;
    const cutEnd = Math.min(duration, s.end) - padding;
    if (cutEnd - cutStart < 0.1) continue;
    if (cutStart > cursor) keep.push([cursor, cutStart]);
    cursor = cutEnd;
  }
  if (cursor < duration) keep.push([cursor, duration]);
  return keep.filter(([a, b]) => b - a > 0.08);
}

// ---------- colour presets: (in, out) => filtergraph lines ----------
const COLOR = {
  cinematic: 'eq=contrast=1.08:saturation=0.88,colorbalance=rs=-0.06:bs=0.08:rh=0.08:gh=0.02:bh=-0.07',
  vintage: 'curves=preset=vintage,eq=saturation=0.85:contrast=1.03',
  bw: 'hue=s=0,eq=contrast=1.18:brightness=-0.02',
  vivid: 'eq=saturation=1.38:contrast=1.06,unsharp=5:5:0.5',
  warm: 'colorbalance=rs=0.04:rm=0.07:bm=-0.07:bh=-0.04,eq=saturation=1.12:brightness=0.02',
  cool: 'colorbalance=rm=-0.05:bm=0.08:bs=0.05,eq=saturation=1.05',
  moody: "eq=contrast=1.12:brightness=-0.03:saturation=0.72,colorbalance=bs=0.06:rh=0.04,curves=all='0/0 0.25/0.2 0.75/0.72 1/0.95'",
};
function colorGraph(preset, inL, outL, tag) {
  if (preset === 'dreamy') {
    return [
      `[${inL}]split[${tag}d1][${tag}d2]`,
      `[${tag}d2]gblur=sigma=14[${tag}d3]`,
      `[${tag}d1][${tag}d3]blend=all_mode=screen:all_opacity=0.38,eq=saturation=0.95:brightness=0.01[${outL}]`,
    ];
  }
  return [`[${inL}]${COLOR[preset]}[${outL}]`];
}

function copyFonts(jobDir) {
  const dst = path.join(jobDir, 'fonts');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(FONTS_SRC)) fs.copyFileSync(path.join(FONTS_SRC, f), path.join(dst, f));
}

const BOLD = 'fonts/BeVietnamPro-ExtraBold.ttf';
const SEMI = 'fonts/BeVietnamPro-SemiBold.ttf';

function fitFont(text, desired, W) {
  const approx = text.length * desired * 0.58;
  return Math.round(approx > W * 0.88 ? (W * 0.88) / (text.length * 0.58) : desired);
}

/** Stable key for "same audio timeline" — transcripts are reusable while this doesn't change. */
export function timelineKey(videoId, meta, c) {
  return crypto.createHash('sha1')
    .update(JSON.stringify([videoId, meta.size, c.trim, c.jumpcut, c.speed, c.boomerang]))
    .digest('hex');
}

/** Source window [start, end] after trimming. */
export function trimWindow(meta, c) {
  const start = Math.min(c.trim.start, Math.max(0, meta.duration - 0.5));
  const end = c.trim.end > 0 ? Math.min(c.trim.end, meta.duration) : meta.duration;
  return { start, end: Math.max(end, start + 0.5) };
}

/** Rebuild caption objects from user-edited text, keeping word timings when the word count is unchanged. */
function captionsFromEdit(list) {
  const caps = [];
  for (const c of list || []) {
    const text = String(c.text || '').replace(/\s+/g, ' ').trim();
    const start = Number(c.start), end = Number(c.end);
    if (!text || !(end > start)) continue;
    const tokens = text.split(' ');
    const orig = Array.isArray(c.words) ? c.words : [];
    const words = tokens.length === orig.length
      ? tokens.map((t, i) => ({
          text: t,
          start: Number(orig[i].start),
          end: Number(orig[i].end),
          isKeyword: !!orig[i].isKeyword,
        }))
      : tokens.map((t, i) => {
        const span = (end - start) / tokens.length;
        return { text: t, start: start + i * span, end: start + (i + 1) * span };
      });
    caps.push({ start, end, words, emoji: c.emoji || '' });
  }
  return caps.sort((a, b) => a.start - b.start);
}

/**
 * Render a video.
 * opts: { inputPath, videoId, meta, config, jobDir, outPath, preview, previewStart, previewLen,
 *         musicPath, apiKey, onUpdate({stage, progress, message}), signal,
 *         transcribeOnly, captions, captionsKey }
 */
export async function render(opts) {
  const { inputPath, meta, config: c, jobDir, outPath, preview, musicPath, apiKey, signal } = opts;
  const warnings = [];
  fs.mkdirSync(jobDir, { recursive: true });
  copyFonts(jobDir);

  const win = trimWindow(meta, c);
  const ss = preview
    ? Math.max(win.start, Math.min(opts.previewStart || 0, win.end - 0.5))
    : win.start;
  const winLen = preview ? Math.min(opts.previewLen || 8, win.end - ss) : win.end - win.start;
  const needSeek = ss > 0.001 || ss + winLen < meta.duration - 0.01;
  const key = timelineKey(opts.videoId, meta, c);
  const transcribeOnly = !!opts.transcribeOnly;

  const doTimeline = needsTimeline(c);
  const doSubs = c.subtitles.enabled || transcribeOnly;
  const stages = [
    ...(doTimeline ? [{ id: 'timeline', w: 1, label: 'Xử lý dòng thời gian (cắt lặng / tốc độ)' }] : []),
    ...(doSubs ? [{ id: 'subs', w: preview ? 0.05 : 0.5, label: preview ? 'Chuẩn bị phụ đề' : 'AI đang nghe & tạo phụ đề' }] : []),
    ...(transcribeOnly ? [] : [{ id: 'look', w: 1.6, label: preview ? 'Dựng bản xem trước' : 'Áp mẫu & xuất video' }]),
  ];
  const totalW = stages.reduce((s, x) => s + x.w, 0);
  const report = (id, frac, message) => {
    let done = 0;
    for (const s of stages) {
      if (s.id === id) {
        opts.onUpdate?.({ stage: s.label, progress: (done + s.w * Math.min(1, frac)) / totalW, message });
        return;
      }
      done += s.w;
    }
  };

  // ---------------- Stage A: timeline ----------------
  let src = inputPath;
  let srcDuration = winLen;
  let srcHasAudio = meta.hasAudio;
  let seekOnLook = needSeek; // apply -ss/-t at stage C if no stage A

  if (doTimeline) {
    report('timeline', 0);
    const vf = [];
    const af = [];
    let expected = winLen;

    if (c.jumpcut.enabled && meta.hasAudio) {
      report('timeline', 0.02, 'Đang dò khoảng lặng…');
      const sil = await detectSilence(inputPath, {
        threshold: c.jumpcut.threshold, minSilence: c.jumpcut.minSilence, ss, t: needSeek ? winLen : 0,
      });
      const keep = keepRanges(sil, winLen, c.jumpcut.padding);
      const kept = keep.reduce((s, [a, b]) => s + (b - a), 0);
      if (keep.length && kept < winLen - 0.15) {
        const expr = keep.map(([a, b]) => `between(t,${f3(a)},${f3(b)})`).join('+');
        vf.push(`fps=${meta.fps}`, `select='${expr}'`, 'setpts=N/FRAME_RATE/TB');
        af.push(`aselect='${expr}'`, 'asetpts=N/SR/TB');
        expected = kept;
        if (!preview) warnings.push(`Đã cắt ${(winLen - kept).toFixed(1)}s khoảng lặng (${keep.length} đoạn giữ lại).`);
      } else if (!preview) {
        warnings.push('Không tìm thấy khoảng lặng đáng kể để cắt.');
      }
    } else if (c.jumpcut.enabled) {
      warnings.push('Video không có âm thanh nên bỏ qua cắt khoảng lặng.');
    }

    let muteAudio = false;
    if (c.speed.enabled && c.speed.factor !== 1) {
      vf.push(`setpts=PTS/${f3(c.speed.factor)}`);
      af.push(...atempoChain(c.speed.factor));
      expected /= c.speed.factor;
    }
    if (c.speed.enabled && c.speed.mute) muteAudio = true;

    const lines = [];
    const vChain = vf.length ? vf.join(',') : 'null';
    if (c.boomerang.enabled) {
      const L = Math.min(c.boomerang.length, expected);
      lines.push(`[0:v]${vChain},trim=duration=${f3(L)},setpts=PTS-STARTPTS,split[bf][bb]`);
      lines.push('[bb]reverse[br]');
      lines.push('[bf][br]concat=n=2:v=1:a=0,split[bx][by]');
      lines.push('[bx][by]concat=n=2:v=1:a=0[vout]');
      muteAudio = true;
      expected = L * 4;
    } else {
      lines.push(`[0:v]${vChain}[vout]`);
    }
    const keepAudio = meta.hasAudio && !muteAudio;
    if (keepAudio) lines.push(`[0:a]${af.length ? af.join(',') : 'anull'}[aout]`);

    fs.writeFileSync(path.join(jobDir, 'timeline.txt'), lines.join(';\n'));
    const tlOut = path.join(jobDir, 'timeline.mp4');
    const args = [];
    if (needSeek) args.push('-ss', f3(ss), '-t', f3(winLen));
    args.push('-i', inputPath, '-filter_complex_script', 'timeline.txt', '-map', '[vout]');
    if (keepAudio) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
    args.push('-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'veryfast', '-crf', preview ? '23' : '16',
      '-pix_fmt', 'yuv420p', tlOut);
    await runFFmpeg(args, { cwd: jobDir, duration: expected, signal, onProgress: (p) => report('timeline', 0.05 + p * 0.95) });

    const tlMeta = await probe(tlOut);
    src = tlOut;
    srcDuration = tlMeta.duration || expected;
    srcHasAudio = tlMeta.hasAudio;
    seekOnLook = false;
  }

  const D = srcDuration;
  const { W, H } = outputDims(meta, c, preview);
  const base = Math.min(W, H);

  // ---------------- Stage B: subtitles ----------------
  let srtPath = null;
  let subsReady = false;
  let caps = [];
  let subAnalysis = null;
  if (doSubs) {
    report('subs', 0);
    const edited = Array.isArray(opts.captions) && opts.captions.length ? opts.captions : null;
    const analysisCacheFile = path.join(CACHE_DIR, `analysis-${key}.json`);
    if (fs.existsSync(analysisCacheFile)) {
      try { subAnalysis = JSON.parse(fs.readFileSync(analysisCacheFile, 'utf8')); } catch {}
    }

    if (!srcHasAudio) {
      warnings.push('Không có âm thanh để tạo phụ đề — đã bỏ qua phụ đề.');
    } else if (preview) {
      // Real (edited) captions can be shown when the timeline is a plain trim; otherwise a style sample.
      if (edited && opts.captionsKey === key && !doTimeline) {
        const off = ss - win.start;
        caps = captionsFromEdit(edited)
          .filter((cp) => cp.end > off && cp.start < off + D)
          .map((cp) => ({
            start: cp.start - off, end: cp.end - off,
            words: cp.words.map((w) => ({ ...w, start: w.start - off, end: w.end - off })),
            emoji: cp.emoji || '',
          }));
      }
      if (!caps.length) caps = buildCaptions(sampleWords(D), c.subtitles.style);
      if (subAnalysis) applyAnalysis(caps, subAnalysis, c.subtitles);
    } else if (edited && opts.captionsKey === key && !transcribeOnly) {
      caps = captionsFromEdit(edited);
      if (subAnalysis) applyAnalysis(caps, subAnalysis, c.subtitles);
      report('subs', 0.9, 'Dùng phụ đề bạn đã biên tập');
    } else {
      if (edited) warnings.push('Phụ đề đã sửa không còn khớp (bạn đã đổi đoạn cắt / tốc độ) — AI đã tạo lại.');
      let words = [];
      const cacheFile = path.join(CACHE_DIR, `subs-${key}.json`);
      if (fs.existsSync(cacheFile)) {
        words = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        report('subs', 0.6, 'Dùng lại lời thoại đã chép');
      } else {
        report('subs', 0.05, 'Đang tách âm thanh…');
        const mp3 = path.join(jobDir, 'audio.mp3');
        await runFFmpeg(['-i', src, ...(seekOnLook ? ['-ss', f3(ss), '-t', f3(winLen)] : []),
          '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3], {
          cwd: jobDir, duration: D, signal, onProgress: (p) => report('subs', 0.05 + p * 0.15),
        });
        report('subs', 0.25, 'Gemini đang nghe và chép lời…');
        words = await transcribe(mp3, apiKey, { duration: D, signal });
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(words));
      }
      if (!words.length) warnings.push('AI không nghe thấy lời nói nào trong video.');
      caps = buildCaptions(words, c.subtitles.style);

      // AI Multimodal video analysis for positioning, keywords & emoji
      if (caps.length && c.subtitles.smartAnalysis !== false && apiKey) {
        if (!subAnalysis) {
          report('subs', 0.75, 'AI đang phân tích khung hình video & từ khoá…');
          try {
            subAnalysis = await analyzeVideoSubtitles({
              videoPath: src,
              duration: D,
              captions: caps,
              apiKey,
              signal,
              config: c.subtitles,
              jobDir,
            });
            if (subAnalysis) {
              fs.mkdirSync(CACHE_DIR, { recursive: true });
              fs.writeFileSync(analysisCacheFile, JSON.stringify(subAnalysis));
            }
          } catch (e) {
            console.warn('[subtitles-analysis]', e.message);
          }
        } else {
          applyAnalysis(caps, subAnalysis, c.subtitles);
        }
      }
    }
    if (transcribeOnly) {
      report('subs', 1);
      return { captions: caps, captionsKey: key, duration: D, warnings, timeline: doTimeline, analysis: subAnalysis };
    }
    if (caps.length) {
      fs.writeFileSync(path.join(jobDir, 'subs.ass'), toASS(caps, {
        width: W, height: H, ...c.subtitles, analysis: subAnalysis,
      }));
      if (!preview) {
        srtPath = outPath.replace(/\.mp4$/, '.srt');
        fs.writeFileSync(srtPath, toSRT(caps, { emojis: c.subtitles.emojis !== false }));
      }
      subsReady = true;
    }
    report('subs', 1);
  }

  // ---------------- Stage C: look ----------------
  report('look', 0);
  const g = [];
  let cur = '0:v';
  let n = 0;
  const label = () => `v${n++}`;
  const chain = (filters) => { const o = label(); g.push(`[${cur}]${filters}[${o}]`); cur = o; };

  // 1. Frame / aspect ratio
  if (c.format.enabled && c.format.mode === 'blur') {
    const bw = even(W / 8), bh = even(H / 8);
    const o = label();
    g.push(`[${cur}]split[bgs][fgs]`);
    g.push(`[bgs]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,scale=${W}:${H},eq=brightness=-0.07:saturation=1.15,setsar=1[bg]`);
    g.push(`[fgs]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg]`);
    g.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2[${o}]`);
    cur = o;
  } else if (c.format.enabled && c.format.mode === 'crop') {
    chain(`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`);
  } else if (c.format.enabled) {
    chain(`scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`);
  } else {
    chain(`scale=${W}:${H},setsar=1`);
  }

  // 2. Colour grade (optionally blended with the original for "intensity")
  if (c.color.enabled) {
    const o = label();
    if (c.color.intensity < 0.999) {
      g.push(`[${cur}]split[co][ci]`);
      g.push(...colorGraph(c.color.preset, 'ci', 'cg0', 'c'));
      g.push('[cg0]format=yuv420p[cg]');
      g.push('[co]format=yuv420p[cob]');
      g.push(`[cob][cg]blend=all_mode=normal:all_opacity=${f3(c.color.intensity)}[${o}]`);
    } else {
      g.push(...colorGraph(c.color.preset, cur, o, 'c'));
    }
    cur = o;
  }

  // 3. Film look
  if (c.film.enabled) {
    const f = [];
    if (c.film.grain > 0) f.push(`noise=alls=${Math.round(c.film.grain)}:allf=t+u`);
    if (c.film.vignette) f.push('vignette=angle=PI/4.5');
    if (c.film.letterbox) {
      const bar = even(H * 0.11);
      f.push(`drawbox=x=0:y=0:w=iw:h=${bar}:color=black:t=fill`, `drawbox=x=0:y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`);
    }
    if (f.length) chain(f.join(','));
  }

  // 4. Subtitles
  if (subsReady) chain('subtitles=subs.ass:fontsdir=fonts');

  // 5. Title (intro)
  if (c.title.enabled && c.title.text.trim()) {
    fs.writeFileSync(path.join(jobDir, 'title.txt'), c.title.text.trim());
    const Dt = Math.min(c.title.duration, D);
    const fsz = fitFont(c.title.text.trim(), base * 0.08, W);
    const y = { center: '(h-text_h)/2', top: 'h*0.12', bottom: 'h*0.82-text_h' }[c.title.position];
    const fi = Math.min(0.5, Dt / 3);
    chain(`drawtext=fontfile=${BOLD}:textfile=title.txt:expansion=none:fontsize=${fsz}:fontcolor=white:` +
      `box=1:boxcolor=black@0.42:boxborderw=${Math.round(fsz * 0.45)}:shadowcolor=black@0.45:shadowx=2:shadowy=2:` +
      `x=(w-text_w)/2:y=${y}:alpha='if(lt(t,${f3(fi)}),t/${f3(fi)},if(gt(t,${f3(Dt - fi)}),max(0,(${f3(Dt)}-t)/${f3(fi)}),1))':` +
      `enable='lt(t,${f3(Dt)})'`);
  }

  // 6. Watermark
  if (c.watermark.enabled && c.watermark.text.trim()) {
    fs.writeFileSync(path.join(jobDir, 'watermark.txt'), c.watermark.text.trim());
    const m = Math.round(base * 0.045);
    const [vy, hx] = c.watermark.position.split('-');
    const x = hx === 'left' ? `${m}` : `w-text_w-${m}`;
    const y = vy === 'top' ? `${m}` : `h-text_h-${m}`;
    chain(`drawtext=fontfile=${SEMI}:textfile=watermark.txt:expansion=none:fontsize=${Math.round(base * 0.034)}:` +
      `fontcolor=white@0.78:shadowcolor=black@0.55:shadowx=2:shadowy=2:x=${x}:y=${y}`);
  }

  // 7. Outro (in previews only when the window reaches the end of the clip)
  const outroStart = !preview
    ? D - c.outro.duration
    : (!doTimeline && ss + winLen >= win.end - 0.05 ? win.end - c.outro.duration - ss : -1e9);
  if (c.outro.enabled && c.outro.text.trim() && outroStart > -c.outro.duration && outroStart < D) {
    fs.writeFileSync(path.join(jobDir, 'outro.txt'), c.outro.text.trim());
    const T0 = Math.max(0, outroStart);
    const fsz = fitFont(c.outro.text.trim(), base * 0.075, W);
    chain(`drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill:enable='gte(t,${f3(T0)})',` +
      `drawtext=fontfile=${BOLD}:textfile=outro.txt:expansion=none:fontsize=${fsz}:fontcolor=white:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:alpha='min(1,max(0,(t-${f3(T0)})/0.5))':enable='gte(t,${f3(T0)})'`);
  } else if (c.outro.enabled && preview) {
    warnings.push('Outro hiện ở cuối video — xem trước từ gần cuối để thấy, hoặc xuất bản đầy đủ.');
  }

  // 8. Fades
  const fd = c.fade.enabled ? Math.min(c.fade.duration, D / 3) : 0;
  if (fd > 0) chain(`fade=t=in:st=0:d=${f3(fd)},fade=t=out:st=${f3(D - fd)}:d=${f3(fd)}`);

  chain('format=yuv420p');
  g.push(`[${cur}]null[vout]`);

  // ---- audio ----
  const useMusic = c.music.enabled && musicPath;
  if (c.music.enabled && !musicPath) warnings.push('Mẫu có nhạc nền nhưng bạn chưa chọn file nhạc — đã bỏ qua.');
  let aOut = null;
  // voice chain: optional loudness normalisation (loudnorm upsamples -> resample back)
  const voice = (vol) => (c.loudnorm.enabled
    ? `loudnorm=I=${c.loudnorm.target}:TP=-1.5:LRA=11,aresample=48000,volume=${f3(vol)}`
    : `volume=${f3(vol)}`);
  if (useMusic) {
    const mFade = Math.min(1.5, D / 3);
    g.push(`[1:a]volume=${f3(c.music.volume)},atrim=duration=${f3(D)},asetpts=PTS-STARTPTS,afade=t=out:st=${f3(Math.max(0, D - mFade))}:d=${f3(mFade)}[mus]`);
  }
  if (srcHasAudio && useMusic) {
    if (c.music.ducking) {
      g.push(`[0:a]${voice(c.music.originalVolume)},asplit=2[av][asc]`);
      g.push('[mus][asc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=400[musd]');
      g.push('[av][musd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amx]');
    } else {
      g.push(`[0:a]${voice(c.music.originalVolume)}[av]`);
      g.push('[av][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amx]');
    }
    aOut = 'amx';
  } else if (srcHasAudio) {
    g.push(`[0:a]${voice(c.music.enabled ? c.music.originalVolume : 1)}[av]`);
    aOut = 'av';
  } else if (useMusic) {
    aOut = 'mus';
  }
  if (aOut) {
    g.push(fd > 0
      ? `[${aOut}]afade=t=in:st=0:d=${f3(fd)},afade=t=out:st=${f3(D - fd)}:d=${f3(fd)}[aout]`
      : `[${aOut}]anull[aout]`);
  }

  fs.writeFileSync(path.join(jobDir, 'look.txt'), g.join(';\n'));

  const q = preview ? { preset: 'ultrafast', crf: 28 } : {
    high: { preset: 'medium', crf: 19 },
    balanced: { preset: 'veryfast', crf: 22 },
    small: { preset: 'veryfast', crf: 27 },
  }[c.export.quality];

  const args = [];
  if (seekOnLook) args.push('-ss', f3(ss), '-t', f3(winLen));
  args.push('-i', src);
  if (useMusic) args.push('-stream_loop', '-1', '-i', musicPath);
  args.push('-filter_complex_script', 'look.txt', '-map', '[vout]');
  if (aOut) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', preview ? '128k' : '192k', '-ar', '48000');
  args.push('-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p',
    '-fpsmax', '60', '-movflags', '+faststart', '-t', f3(D), outPath);

  await runFFmpeg(args, { cwd: jobDir, duration: D, signal, onProgress: (p) => report('look', p) });

  return { output: outPath, srt: srtPath, duration: D, width: W, height: H, warnings, analysis: subAnalysis };
}
