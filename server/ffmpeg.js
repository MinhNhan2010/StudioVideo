// Thin wrappers around the bundled ffmpeg / ffprobe binaries.
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegPath;
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path;

function collect(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

/** Read basic metadata. Width/height are rotation-corrected (what the viewer sees). */
export async function probe(file) {
  const { code, out, err } = await collect(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  if (code !== 0) throw new Error('Không đọc được file media: ' + err.slice(-300));
  const info = JSON.parse(out);
  const v = info.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = info.streams.find((s) => s.codec_type === 'audio');
  let duration = parseFloat(info.format?.duration || v?.duration || a?.duration || 0);
  if (!(duration > 0)) duration = await decodeDuration(file);

  let width = v?.width || 0;
  let height = v?.height || 0;
  let rotation = 0;
  if (v) {
    const sd = (v.side_data_list || []).find((s) => s.rotation !== undefined);
    rotation = Math.abs(parseInt(sd?.rotation ?? v.tags?.rotate ?? 0, 10)) % 360;
    if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  }
  let fps = 30;
  if (v?.avg_frame_rate && v.avg_frame_rate !== '0/0') {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    if (n && d) fps = n / d;
  }
  return {
    duration,
    width,
    height,
    fps: Math.min(60, Math.max(1, Math.round(fps * 100) / 100)),
    hasVideo: !!v,
    hasAudio: !!a,
    videoCodec: v?.codec_name || null,
    audioCodec: a?.codec_name || null,
    size: parseInt(info.format?.size || 0, 10),
  };
}

/** Some containers (MediaRecorder WebM…) carry no duration: remux to null and read the last timestamp. */
async function decodeDuration(file) {
  const { err } = await collect(FFMPEG, ['-hide_banner', '-i', file, '-map', '0', '-c', 'copy', '-f', 'null', '-']);
  const all = [...err.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  if (!all.length) return 0;
  const [, hh, mm, ss] = all[all.length - 1];
  return +hh * 3600 + +mm * 60 + parseFloat(ss);
}

/**
 * Run ffmpeg with machine-readable progress.
 * onProgress receives 0..1 (based on `duration` seconds of expected output).
 */
export function runFFmpeg(args, { cwd, duration = 0, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args];
    const p = spawn(FFMPEG, full, { cwd, windowsHide: true });
    let errTail = '';
    let buf = '';

    const abort = () => p.kill('SIGKILL');
    if (signal) {
      if (signal.aborted) abort();
      signal.addEventListener('abort', abort, { once: true });
    }

    p.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && duration > 0 && onProgress) {
          onProgress(Math.min(1, parseInt(m[1], 10) / 1e6 / duration));
        }
      }
    });
    p.stderr.on('data', (d) => {
      errTail = (errTail + d).slice(-4000);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      signal?.removeEventListener?.('abort', abort);
      if (signal?.aborted) return reject(new Error('Đã huỷ'));
      if (code === 0) {
        onProgress?.(1);
        resolve();
      } else {
        const lines = errTail.split('\n').filter((l) => l.trim()).slice(-8).join('\n');
        reject(new Error('FFmpeg lỗi (code ' + code + '):\n' + lines));
      }
    });
  });
}

/** Detect silent ranges. Returns [{start, end}] in seconds. */
export async function detectSilence(file, { threshold = -32, minSilence = 0.6, ss = 0, t = 0 } = {}) {
  const args = ['-hide_banner', '-nostats'];
  if (ss) args.push('-ss', String(ss));
  if (t) args.push('-t', String(t));
  args.push('-i', file, '-vn', '-af', `silencedetect=noise=${threshold}dB:d=${minSilence}`, '-f', 'null', '-');
  const { err } = await collect(FFMPEG, args);
  const silences = [];
  let cur = null;
  for (const line of err.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) cur = { start: Math.max(0, parseFloat(s[1])) };
    if (e && cur) {
      cur.end = parseFloat(e[1]);
      silences.push(cur);
      cur = null;
    }
  }
  if (cur) cur.end = Infinity, silences.push(cur);
  return silences;
}
