// API integration tests: spawns the real server on a spare port. Run after `npm test` (needs data/test/clip.mp4).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIP = path.join(ROOT, 'data', 'test', 'clip.mp4');
const UPLOADS = path.join(ROOT, 'data', 'uploads');
const USER_TPL = path.join(ROOT, 'data', 'user-templates.json');
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let tplBackup = null;
const createdIds = [];
const createdOutputs = [];

const json = async (method, url, body) => {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data };
};

async function uploadFile(file, name, kind = 'video') {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)]), name);
  const r = await fetch(`${BASE}/api/upload?kind=${kind}`, { method: 'POST', body: fd });
  return { status: r.status, data: await r.json() };
}

/** Follow the SSE stream until the job leaves "running". */
async function waitJob(jobId, timeoutMs = 120e3) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const r = await fetch(`${BASE}/api/jobs/${jobId}/events`, { signal: ctrl.signal });
  assert.equal(r.status, 200);
  const dec = new TextDecoder();
  let buf = '';
  let last = null;
  const progress = [];
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, '');
        buf = buf.slice(i + 2);
        last = JSON.parse(line);
        progress.push(last.progress);
        if (last.status !== 'running') return { state: last, progress };
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { state: last, progress };
}

before(async () => {
  assert.ok(fs.existsSync(CLIP), 'Chạy `npm test` trước để tạo data/test/clip.mp4');
  if (fs.existsSync(USER_TPL)) tplBackup = fs.readFileSync(USER_TPL);
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server không khởi động')), 15e3);
    server.stdout.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); resolve(); } });
    server.on('exit', (c) => reject(new Error('server thoát code ' + c)));
  });
});

after(async () => {
  server?.kill();
  for (const id of createdIds) {
    for (const f of fs.readdirSync(UPLOADS)) if (f.startsWith(id)) fs.rmSync(path.join(UPLOADS, f), { force: true });
  }
  for (const f of createdOutputs) fs.rmSync(f, { force: true });
  if (tplBackup) fs.writeFileSync(USER_TPL, tplBackup);
  else fs.rmSync(USER_TPL, { force: true });
});

// ---------------- read-only endpoints ----------------
test('GET /api/templates trả về đủ mẫu + defaults', async () => {
  const { status, data } = await json('GET', '/api/templates');
  assert.equal(status, 200);
  assert.equal(data.templates.length, 13);
  assert.ok(data.defaults.export);
  assert.ok(Array.isArray(data.userTemplates));
});

test('GET /api/settings không lộ API key', async () => {
  const { status, data } = await json('GET', '/api/settings');
  assert.equal(status, 200);
  assert.equal(typeof data.hasApiKey, 'boolean');
  assert.ok(!('apiKey' in data));
});

test('GET / phục vụ giao diện', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<html/i);
});

// ---------------- upload validation ----------------
test('POST /api/upload không có file -> 400', async () => {
  const r = await fetch(BASE + '/api/upload', { method: 'POST' });
  assert.equal(r.status, 400);
});

test('POST /api/upload file không phải media -> 400 và file bị xoá', async () => {
  const before = new Set(fs.readdirSync(UPLOADS));
  const tmp = path.join(ROOT, 'data', 'test', 'fake.mp4');
  fs.writeFileSync(tmp, 'đây không phải video');
  const { status, data } = await uploadFile(tmp, 'fake.mp4');
  assert.equal(status, 400);
  assert.ok(data.error);
  const leftovers = fs.readdirSync(UPLOADS).filter((f) => !before.has(f));
  assert.deepEqual(leftovers, [], 'file rác phải được xoá');
});

test('POST /api/upload video hợp lệ: metadata, tên tiếng Việt, Range, filmstrip', async () => {
  const { status, data } = await uploadFile(CLIP, 'Video thử nghiệm.mp4');
  assert.equal(status, 200);
  createdIds.push(data.id);
  assert.match(data.id, /^[a-f0-9]{12}$/);
  assert.equal(data.name, 'Video thử nghiệm.mp4', 'tên file tiếng Việt phải giữ nguyên');
  assert.equal(data.meta.duration, 12);
  assert.equal(data.meta.width, 1280);

  const rec = await json('GET', '/api/media/' + data.id);
  assert.equal(rec.status, 200);
  const media = await fetch(BASE + data.url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(media.status, 206, 'video phải hỗ trợ Range để tua');

  const strip = await fetch(`${BASE}/api/media/${data.id}/strip`);
  assert.equal(strip.status, 200);
  assert.match(strip.headers.get('content-type'), /jpeg/);
});

// ---------------- security ----------------
test('GET /api/media/:id chặn id không hợp lệ', async () => {
  assert.equal((await json('GET', '/api/media/..%2F..%2Fpackage')).status, 404);
  assert.equal((await json('GET', '/api/media/ffffffffffff')).status, 404);
});

test('Static /media không cho thoát thư mục', async () => {
  const r = await fetch(BASE + '/media/..%2F..%2Fpackage.json');
  assert.notEqual(r.status, 200);
});

test('DELETE /api/outputs/:name không xoá được file ngoài outputs', async () => {
  const victim = path.join(ROOT, 'package.json');
  await fetch(BASE + '/api/outputs/' + encodeURIComponent('../../package.json'), { method: 'DELETE' });
  assert.ok(fs.existsSync(victim));
});

// ---------------- user templates ----------------
test('User templates: tạo / liệt kê / xoá, từ chối tên rỗng', async () => {
  assert.equal((await json('POST', '/api/user-templates', { name: '   ' })).status, 400);
  const { status, data } = await json('POST', '/api/user-templates', {
    name: 'Mẫu test', baseId: 'cinematic', config: { color: { enabled: true, preset: 'moody' }, trim: { start: 3 } },
  });
  assert.equal(status, 200);
  assert.equal(data.baseId, 'cinematic');
  assert.ok(!('trim' in data.config), 'trim không được lưu vào mẫu');
  let list = (await json('GET', '/api/templates')).data.userTemplates;
  assert.ok(list.some((t) => t.id === data.id));
  await json('DELETE', '/api/user-templates/' + data.id);
  list = (await json('GET', '/api/templates')).data.userTemplates;
  assert.ok(!list.some((t) => t.id === data.id));
});

// ---------------- render jobs ----------------
test('POST /api/render với video không tồn tại -> 404', async () => {
  assert.equal((await json('POST', '/api/render', { videoId: 'abcabcabcabc' })).status, 404);
});

test('POST /api/render với config sai kiểu không làm server lỗi 500', async () => {
  const id = createdIds[0];
  const { status } = await json('POST', '/api/render', { videoId: id, preview: true, config: { format: 'abc' } });
  assert.ok(status < 500, `nhận ${status}`);
  assert.equal((await json('GET', '/api/settings')).status, 200, 'server vẫn sống');
});

test('Render preview: SSE tiến độ tăng dần, file xem trước tải được', async () => {
  const id = createdIds[0];
  const { status, data } = await json('POST', '/api/render', {
    videoId: id, preview: true, previewStart: 2, config: { format: { enabled: true, ratio: '9:16' }, color: { enabled: true, preset: 'vivid' } },
  });
  assert.equal(status, 200);
  const { state, progress } = await waitJob(data.jobId);
  assert.equal(state.status, 'done', state.error);
  assert.equal(state.width, 540);
  assert.equal(state.height, 960);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1] - 1e-9, 'progress không được giảm');
  const r = await fetch(BASE + state.url);
  assert.equal(r.status, 200);
  assert.ok(Number(r.headers.get('content-length')) > 1000);
});

test('Render export: file xuất xuất hiện trong lịch sử và xoá được', async () => {
  const id = createdIds[0];
  const { data } = await json('POST', '/api/render', {
    videoId: id, templateId: 'bw', config: { trim: { start: 1, end: 4 }, color: { enabled: true, preset: 'bw' }, export: { resolution: 720, quality: 'small' } },
  });
  const { state } = await waitJob(data.jobId);
  assert.equal(state.status, 'done', state.error);
  assert.ok(Math.abs(state.duration - 3) < 0.3);
  createdOutputs.push(path.join(ROOT, 'data', 'outputs', state.fileName));
  assert.match(state.fileName, /^video-thu-nghiem-bw-\d{14}\.mp4$/i);
  const list = (await json('GET', '/api/outputs')).data;
  assert.ok(list.some((o) => o.name === state.fileName));
  await json('DELETE', '/api/outputs/' + encodeURIComponent(state.fileName));
  assert.ok(!(await json('GET', '/api/outputs')).data.some((o) => o.name === state.fileName));
});

test('Huỷ job export giữa chừng -> trạng thái cancelled, không để lại file', async () => {
  const id = createdIds[0];
  const { data } = await json('POST', '/api/render', {
    videoId: id, templateId: 'cancel-me', config: { speed: { enabled: true, factor: 0.25 }, color: { enabled: true, preset: 'dreamy' } },
  });
  setTimeout(() => json('POST', `/api/jobs/${data.jobId}/cancel`), 800);
  const { state } = await waitJob(data.jobId);
  assert.equal(state.status, 'cancelled');
  const outs = fs.readdirSync(path.join(ROOT, 'data', 'outputs')).filter((f) => f.includes('cancel-me'));
  assert.deepEqual(outs, []);
});

test('Preview mới tự huỷ preview cũ đang chạy', async () => {
  const id = createdIds[0];
  const cfg = { speed: { enabled: true, factor: 0.25 }, color: { enabled: true, preset: 'dreamy' } };
  const a = (await json('POST', '/api/render', { videoId: id, preview: true, config: cfg })).data.jobId;
  await new Promise((r) => setTimeout(r, 300));
  const b = (await json('POST', '/api/render', { videoId: id, preview: true, config: {} })).data.jobId;
  const [ra, rb] = await Promise.all([waitJob(a), waitJob(b)]);
  assert.equal(ra.state.status, 'cancelled');
  assert.equal(rb.state.status, 'done');
});

test('POST /api/transcribe khi không có API key -> 400 rõ ràng', async () => {
  const { status, data } = await json('POST', '/api/transcribe', { videoId: createdIds[0] });
  // server được khởi động với GEMINI_API_KEY rỗng; nếu data/settings.json có key thì bỏ qua
  if (status === 200) return;
  assert.equal(status, 400);
  assert.match(data.error, /API key/);
});

test('SSE cho job không tồn tại -> 404', async () => {
  const r = await fetch(BASE + '/api/jobs/nope/events');
  assert.equal(r.status, 404);
});
