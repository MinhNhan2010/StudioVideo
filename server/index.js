import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { probe, runFFmpeg } from './ffmpeg.js';
import { render } from './pipeline.js';
import { TEMPLATES, DEFAULT_CONFIG, sanitizeConfig } from './templates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DIRS = {
  uploads: path.join(DATA, 'uploads'),
  outputs: path.join(DATA, 'outputs'),
  previews: path.join(DATA, 'previews'),
  jobs: path.join(DATA, 'jobs'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const USER_TPL_FILE = path.join(DATA, 'user-templates.json');
const PORT = Number(process.env.PORT) || 5173;
const KEEP_JOBS = !!process.env.KEEP_JOBS; // keep temp job folders for debugging

// ---------- settings (Gemini key) ----------
const readSettings = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
};
const getApiKey = () => process.env.GEMINI_API_KEY || readSettings().apiKey || '';

// ---------- housekeeping: old previews ----------
for (const f of fs.readdirSync(DIRS.previews)) {
  const p = path.join(DIRS.previews, f);
  if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.rmSync(p, { force: true });
}

const app = express();
app.use(express.json({ limit: '10mb' })); // edited caption lists can be large
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.use('/media', express.static(DIRS.uploads));
app.use('/outputs', express.static(DIRS.outputs));
app.use('/previews', express.static(DIRS.previews, { maxAge: 0 }));

const newId = () => crypto.randomBytes(6).toString('hex');
const upload = multer({
  storage: multer.diskStorage({
    destination: DIRS.uploads,
    filename: (req, file, cb) => cb(null, newId() + (path.extname(file.originalname).toLowerCase() || '.bin')),
  }),
  limits: { fileSize: 8 * 1024 ** 3 },
});

function findUpload(id) {
  if (!/^[a-f0-9]{12}$/.test(id || '')) return null;
  const metaFile = path.join(DIRS.uploads, id + '.json');
  if (!fs.existsSync(metaFile)) return null;
  return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
}

// ---------- user templates ----------
const readUserTemplates = () => {
  try { return JSON.parse(fs.readFileSync(USER_TPL_FILE, 'utf8')); } catch { return []; }
};
const writeUserTemplates = (list) => fs.writeFileSync(USER_TPL_FILE, JSON.stringify(list, null, 2));

// ---------- API ----------
app.get('/api/templates', (req, res) =>
  res.json({ templates: TEMPLATES, defaults: DEFAULT_CONFIG, userTemplates: readUserTemplates() }));

app.post('/api/user-templates', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Hãy đặt tên cho mẫu' });
  const base = TEMPLATES.find((t) => t.id === req.body?.baseId) || TEMPLATES[TEMPLATES.length - 1];
  const config = sanitizeConfig(req.body?.config);
  delete config.trim; // trim belongs to a specific video, not to a style
  const tpl = {
    id: 'u-' + crypto.randomBytes(4).toString('hex'),
    name, user: true, baseId: base.id,
    desc: String(req.body?.desc || `Mẫu của bạn (dựa trên ${base.name})`).slice(0, 120),
    tags: ['Của tôi'], gradient: base.gradient, css: base.css, config, createdAt: Date.now(),
  };
  writeUserTemplates([tpl, ...readUserTemplates()].slice(0, 50));
  res.json(tpl);
});

app.delete('/api/user-templates/:id', (req, res) => {
  writeUserTemplates(readUserTemplates().filter((t) => t.id !== req.params.id));
  res.json({ ok: true });
});

// Session restore: re-fetch an upload record by id.
app.get('/api/media/:id', (req, res) => {
  const rec = findUpload(req.params.id);
  if (!rec || !fs.existsSync(path.join(DIRS.uploads, rec.file))) return res.status(404).json({ error: 'Không còn file' });
  res.json(rec);
});

// Filmstrip sprite (12 frames side by side) for the trim timeline.
const STRIP_N = 12;
const stripJobs = new Map();
app.get('/api/media/:id/strip', async (req, res) => {
  const rec = findUpload(req.params.id);
  if (!rec || rec.kind !== 'video') return res.status(404).end();
  const out = path.join(DIRS.uploads, `${rec.id}-strip.jpg`);
  try {
    if (!fs.existsSync(out)) {
      if (!stripJobs.has(rec.id)) {
        const d = rec.meta.duration;
        const args = [];
        for (let i = 0; i < STRIP_N; i++) args.push('-ss', ((d * (i + 0.5)) / STRIP_N).toFixed(3), '-i', rec.file);
        const g = [];
        for (let i = 0; i < STRIP_N; i++) g.push(`[${i}:v]scale=128:72:force_original_aspect_ratio=increase,crop=128:72,setsar=1[s${i}]`);
        g.push(`${Array.from({ length: STRIP_N }, (_, i) => `[s${i}]`).join('')}hstack=inputs=${STRIP_N}[out]`);
        args.push('-filter_complex', g.join(';'), '-map', '[out]', '-frames:v', '1', '-q:v', '4', path.basename(out));
        stripJobs.set(rec.id, runFFmpeg(args, { cwd: DIRS.uploads }).finally(() => stripJobs.delete(rec.id)));
      }
      await stripJobs.get(rec.id);
    }
    res.setHeader('Cache-Control', 'max-age=86400');
    res.sendFile(out);
  } catch (e) {
    console.error('[strip]', e.message);
    res.status(500).end();
  }
});

app.get('/api/settings', (req, res) => {
  res.json({ hasApiKey: !!getApiKey(), fromEnv: !!process.env.GEMINI_API_KEY });
});
app.post('/api/settings', (req, res) => {
  const s = readSettings();
  s.apiKey = String(req.body?.apiKey || '').trim();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  res.json({ hasApiKey: !!getApiKey() });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không nhận được file' });
  const kind = req.query.kind === 'music' ? 'music' : 'video';
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  try {
    const meta = await probe(req.file.path);
    if (kind === 'video' && !meta.hasVideo) throw new Error('File không có hình ảnh video');
    if (!(meta.duration > 0.2)) throw new Error('Không xác định được thời lượng file (file hỏng hoặc quá ngắn)');
    if (kind === 'music' && !meta.hasAudio) throw new Error('File không có âm thanh');
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const rec = { id, kind, name, file: req.file.filename, url: '/media/' + req.file.filename, meta };
    fs.writeFileSync(path.join(DIRS.uploads, id + '.json'), JSON.stringify(rec));
    res.json(rec);
  } catch (e) {
    fs.rmSync(req.file.path, { force: true });
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/outputs', (req, res) => {
  const list = fs.readdirSync(DIRS.outputs)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const st = fs.statSync(path.join(DIRS.outputs, f));
      const srt = f.replace(/\.mp4$/, '.srt');
      return {
        name: f, url: '/outputs/' + encodeURIComponent(f), size: st.size, time: st.mtimeMs,
        srt: fs.existsSync(path.join(DIRS.outputs, srt)) ? '/outputs/' + encodeURIComponent(srt) : null,
      };
    })
    .sort((a, b) => b.time - a.time)
    .slice(0, 30);
  res.json(list);
});

app.delete('/api/outputs/:name', (req, res) => {
  const name = path.basename(req.params.name);
  fs.rmSync(path.join(DIRS.outputs, name), { force: true });
  fs.rmSync(path.join(DIRS.outputs, name.replace(/\.mp4$/, '.srt')), { force: true });
  res.json({ ok: true });
});

// ---------- jobs ----------
const jobs = new Map(); // id -> { state, listeners:Set, controller }
let activePreview = null;

function emit(job, patch) {
  Object.assign(job.state, patch);
  const msg = `data: ${JSON.stringify(job.state)}\n\n`;
  for (const res of job.listeners) res.write(msg);
}

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

function createJob(kind) {
  const id = newId();
  const job = {
    controller: new AbortController(),
    listeners: new Set(),
    state: { id, kind, status: 'running', progress: 0, stage: 'Đang chuẩn bị…', message: '', preview: kind === 'preview', startedAt: Date.now() },
  };
  jobs.set(id, job);
  return job;
}

function finishJob(job, jobDir, promise, onDone, cleanupPath) {
  promise
    .then((r) => emit(job, { status: 'done', progress: 1, stage: 'Hoàn tất', message: '', elapsed: Date.now() - job.state.startedAt, ...onDone(r) }))
    .catch((e) => {
      const cancelled = job.controller.signal.aborted;
      if (!cancelled) console.error(`[${job.state.kind}]`, e.message);
      if (cleanupPath) fs.rmSync(cleanupPath, { force: true });
      emit(job, { status: cancelled ? 'cancelled' : 'error', error: cancelled ? 'Đã huỷ' : e.message });
    })
    .finally(() => {
      if (activePreview === job) activePreview = null;
      if (!KEEP_JOBS) fs.rm(jobDir, { recursive: true, force: true }, () => {});
      for (const l of job.listeners) l.end();
      setTimeout(() => jobs.delete(job.state.id), 10 * 60e3);
    });
}

function resolveMusic(cfg) {
  if (!(cfg.music.enabled && cfg.music.fileId)) return null;
  const m = findUpload(cfg.music.fileId);
  return m ? path.join(DIRS.uploads, m.file) : null;
}

app.post('/api/render', (req, res) => {
  const { videoId, config, preview = false, previewStart = 0, templateId = 'custom', captions, captionsKey } = req.body || {};
  const video = findUpload(videoId);
  if (!video || video.kind !== 'video') return res.status(404).json({ error: 'Không tìm thấy video. Hãy tải lại.' });
  const cfg = sanitizeConfig(config);

  if (preview && activePreview) activePreview.controller.abort();

  const job = createJob(preview ? 'preview' : 'export');
  const id = job.state.id;
  const jobDir = path.join(DIRS.jobs, id);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const outPath = preview
    ? path.join(DIRS.previews, id + '.mp4')
    : path.join(DIRS.outputs, `${slug(path.parse(video.name).name)}-${slug(String(templateId))}-${stamp}.mp4`);
  if (preview) activePreview = job;
  res.json({ jobId: id });

  const promise = render({
    inputPath: path.join(DIRS.uploads, video.file),
    videoId,
    meta: video.meta,
    config: cfg,
    jobDir,
    outPath,
    preview,
    previewStart: Number(previewStart) || 0,
    previewLen: 8,
    musicPath: resolveMusic(cfg),
    apiKey: getApiKey(),
    captions: Array.isArray(captions) ? captions.slice(0, 5000) : null,
    captionsKey: typeof captionsKey === 'string' ? captionsKey : null,
    signal: job.controller.signal,
    onUpdate: (u) => emit(job, { ...u, message: u.message || '' }),
  });
  const rel = (p) => (p ? (preview ? '/previews/' : '/outputs/') + encodeURIComponent(path.basename(p)) : null);
  finishJob(job, jobDir, promise, (r) => ({
    url: rel(r.output) + (preview ? `?t=${Date.now()}` : ''), srt: rel(r.srt),
    fileName: path.basename(r.output), duration: r.duration, width: r.width, height: r.height,
    warnings: r.warnings, analysis: r.analysis,
  }), outPath);
});

// Transcribe only (for the subtitle editor). Uses the same timeline as the final export.
app.post('/api/transcribe', (req, res) => {
  const { videoId, config } = req.body || {};
  const video = findUpload(videoId);
  if (!video || video.kind !== 'video') return res.status(404).json({ error: 'Không tìm thấy video. Hãy tải lại.' });
  if (!video.meta.hasAudio) return res.status(400).json({ error: 'Video không có âm thanh để tạo phụ đề.' });
  if (!getApiKey()) return res.status(400).json({ error: 'Cần Gemini API key — mở ⚙ Cài đặt để nhập.' });
  const cfg = sanitizeConfig(config);
  const job = createJob('transcribe');
  const jobDir = path.join(DIRS.jobs, job.state.id);
  res.json({ jobId: job.state.id });
  const promise = render({
    inputPath: path.join(DIRS.uploads, video.file),
    videoId, meta: video.meta, config: cfg, jobDir, preview: false,
    apiKey: getApiKey(), transcribeOnly: true,
    signal: job.controller.signal,
    onUpdate: (u) => emit(job, { ...u, message: u.message || '' }),
  });
  finishJob(job, jobDir, promise, (r) => ({
    captions: r.captions, captionsKey: r.captionsKey, duration: r.duration, warnings: r.warnings, timeline: r.timeline, analysis: r.analysis,
  }));
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify(job.state)}\n\n`);
  if (job.state.status !== 'running') return res.end();
  job.listeners.add(res);
  req.on('close', () => job.listeners.delete(res));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  jobs.get(req.params.id)?.controller.abort();
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n  🎬 VideoStudio đang chạy: http://localhost:${PORT}\n`);
  if (!getApiKey()) console.log('  (Chưa có GEMINI_API_KEY — phụ đề AI cần key, nhập trong ⚙ Cài đặt)\n');
});
