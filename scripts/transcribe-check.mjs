// Verify Gemini transcription works with the saved key: TTS wav -> mp3 -> transcribe().
import fs from 'node:fs';
import path from 'node:path';
import { runFFmpeg } from '../server/ffmpeg.js';
import { transcribe, buildCaptions, toSRT } from '../server/subtitles.js';

const dir = path.resolve('data', 'test');
const wav = path.join(dir, 'speech.wav');
const mp3 = path.join(dir, 'speech.mp3');
const key = process.env.GEMINI_API_KEY || JSON.parse(fs.readFileSync('data/settings.json', 'utf8')).apiKey;
if (!fs.existsSync(wav)) throw new Error('missing speech.wav');
await runFFmpeg(['-i', wav, '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3], {});
const t0 = Date.now();
const words = await transcribe(mp3, key, { duration: 6 });
console.log(`words=${words.length} in ${Date.now() - t0}ms`);
console.log(words.slice(0, 12));
console.log(toSRT(buildCaptions(words, 'classic')));
