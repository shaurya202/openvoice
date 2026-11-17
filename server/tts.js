import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createToneWav, embedWatermark } from './watermark.js';

const WORKER_PATH = path.resolve(process.cwd(), 'worker', 'tts_worker.py');

function runPythonWorker({ engine, text, voiceId, speed, refAudioPath }) {
  return new Promise((resolve) => {
    if (!fs.existsSync(WORKER_PATH)) return resolve(null);
    const outPath = path.join(os.tmpdir(), `openvoice_${crypto.randomBytes(6).toString('hex')}.wav`);
    const args = [
      WORKER_PATH,
      '--engine',
      engine,
      '--text',
      text,
      '--voice',
      voiceId,
      '--speed',
      String(speed || 1.0),
      '--out',
      outPath,
    ];
    if (refAudioPath) {
      args.push('--ref-audio', refAudioPath);
    }

    const child = spawn(process.env.PYTHON_BIN || 'python', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        const buf = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        resolve({ wav: buf, mode: engine });
      } else {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        resolve(null);
      }
    });
  });
}

export async function synthesizeSpeech({ text, voice, speed = 1.0, generationId }) {
  const engine = voice?.engine || 'kokoro';
  const voiceId = voice?.id || 'af_heart';
  const refAudioPath = voice?.samplePath || null;

  const workerResult = await runPythonWorker({ engine, text, voiceId, speed, refAudioPath });

  // shortcut: tone fallback when Python kokoro/chatterbox packages are not installed locally
  const rawWav =
    workerResult?.wav ||
    createToneWav({
      durationSec: Math.min(4, Math.max(0.8, text.length * 0.04)),
      freq: engine === 'chatterbox' ? 260 : 210,
    });

  const mode = workerResult ? workerResult.mode : 'fallback';
  const watermarkedWav = embedWatermark(rawWav, {
    id: generationId,
    voiceId,
    engine,
    ts: Date.now(),
  });

  return { wav: watermarkedWav, mode, engine };
}
