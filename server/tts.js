import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { embedWatermark } from './watermark.js';

const WORKER_PATH = path.resolve(process.cwd(), 'worker', 'tts_worker.py');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

let cachedBin;
let cachedBinKey = '';

function canRun(bin) {
  try {
    const result = spawnSync(bin, ['-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'], {
      stdio: 'ignore',
      timeout: 8000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Interpreter for the speech worker. PYTHON_BIN wins, then .venv, then python3, then python. */
export function resolvePythonBin(explicit) {
  if (explicit) return explicit;
  const key = `${process.env.PYTHON_BIN || ''}|${process.cwd()}`;
  if (cachedBin && cachedBinKey === key) return cachedBin;
  cachedBinKey = key;
  if (process.env.PYTHON_BIN) {
    cachedBin = process.env.PYTHON_BIN;
    return cachedBin;
  }
  const venv = path.resolve(process.cwd(), '.venv', 'bin', 'python');
  if (canRun(venv)) {
    cachedBin = venv;
    return cachedBin;
  }
  if (canRun('python3')) {
    cachedBin = 'python3';
    return cachedBin;
  }
  if (canRun('python')) {
    cachedBin = 'python';
    return cachedBin;
  }
  cachedBin = 'python3';
  return cachedBin;
}

export function speechText(text) {
  return String(text || '')
    .replace(/\[[^\]\n]{0,48}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveSynthesisTarget(voice) {
  const engine = voice?.engine === 'chatterbox' ? 'chatterbox' : 'kokoro';
  let voiceId = voice?.id || 'af_heart';
  if (engine === 'kokoro') {
    const blended = Array.isArray(voice?.blend)
      ? voice.blend.find((item) => /^[a-z]{2}_/.test(item?.voiceId || ''))
      : null;
    if (blended) voiceId = blended.voiceId;
    else if (!/^[a-z]{2}_/.test(voiceId)) voiceId = 'af_heart';
  }
  const refAudioPath = engine === 'chatterbox' && voice?.samplePath ? voice.samplePath : null;
  if (voice?.type === 'cloned' && !refAudioPath) {
    throw new Error('Cloned voice is missing its reference sample, so it cannot be synthesized.');
  }
  return { engine, voiceId, refAudioPath };
}

export function buildWorkerArgs({ engine, text, voiceId, speed, refAudioPath, outPath }) {
  const args = [
    WORKER_PATH,
    '--engine',
    engine,
    '--text',
    text,
    '--voice',
    voiceId,
    '--speed',
    String(speed || 1),
    '--out',
    outPath,
  ];
  if (refAudioPath) args.push('--ref-audio', refAudioPath);
  return args;
}

function formatWorkerFailure(engine, bin, code, stderr) {
  const lines = String(stderr || '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-6).join(' | ');
  const clipped = tail.length > 700 ? `…${tail.slice(-700)}` : tail;
  const missing = /No module named|not installed|ModuleNotFoundError/i.test(stderr || '') || code === 2;
  const hint = missing
    ? ` Install dependencies with scripts/setup-python.sh and point PYTHON_BIN at that interpreter if it is not ${bin}.`
    : '';
  const detail = clipped || `worker exited with code ${code}`;
  return `Speech synthesis failed (${engine}): ${detail}.${hint}`;
}

function runPythonWorker({ engine, text, voiceId, speed, refAudioPath, pythonBin }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WORKER_PATH)) {
      reject(new Error(`Speech synthesis failed (${engine}): worker not found at ${WORKER_PATH}.`));
      return;
    }
    const bin = resolvePythonBin(pythonBin);
    const outPath = path.join(os.tmpdir(), `openvoice_${crypto.randomBytes(6).toString('hex')}.wav`);
    const args = buildWorkerArgs({ engine, text, voiceId, speed, refAudioPath, outPath });
    const timeoutMs = Number(process.env.OPENVOICE_TTS_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    let stderr = '';
    let settled = false;
    const child = spawn(bin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
        TOKENIZERS_PARALLELISM: 'false',
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '4',
        MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || '4',
      },
    });
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (fs.existsSync(outPath)) {
        try {
          if (err) fs.unlinkSync(outPath);
        } catch {
          /* the caller reports the synthesis error */
        }
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`Speech synthesis failed (${engine}): timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on('error', (err) => {
      finish(
        new Error(
          `Speech synthesis failed (${engine}): could not start ${bin} (${err.message}). Install Python 3, run scripts/setup-python.sh, or set PYTHON_BIN.`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        const wav = fs.readFileSync(outPath);
        fs.unlinkSync(outPath);
        if (wav.length < 1000) {
          finish(new Error(`Speech synthesis failed (${engine}): the worker wrote an empty wav.`));
          return;
        }
        finish(null, wav);
        return;
      }
      finish(new Error(formatWorkerFailure(engine, bin, code, stderr)));
    });
  });
}

let readinessCache = null;
let readinessInflight = null;

export function getSpeechReadiness(pythonBin) {
  const bin = resolvePythonBin(pythonBin);
  if (readinessCache && readinessCache.bin === bin && Date.now() - readinessCache.at < 30_000) {
    return Promise.resolve(readinessCache.value);
  }
  if (readinessInflight && readinessInflight.bin === bin) return readinessInflight.promise;

  const promise = new Promise((resolve) => {
    const script = [
      'import importlib.util, json',
      'mods = ["kokoro", "chatterbox", "faster_whisper", "soundfile"]',
      'print(json.dumps({m: importlib.util.find_spec(m) is not None for m in mods}))',
    ].join('\n');
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(bin, ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({
        python: false,
        pythonBin: bin,
        kokoro: false,
        chatterbox: false,
        stt: false,
        error: error.message,
      });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    child.on('error', (error) => {
      done({ python: false, pythonBin: bin, kokoro: false, chatterbox: false, stt: false, error: error.message });
    });
    child.on('close', (code) => {
      try {
        const parsed = JSON.parse(out.trim().split('\n').pop());
        done({
          python: true,
          pythonBin: bin,
          kokoro: Boolean(parsed.kokoro),
          chatterbox: Boolean(parsed.chatterbox),
          stt: Boolean(parsed.faster_whisper),
          soundfile: Boolean(parsed.soundfile),
        });
      } catch {
        done({
          python: false,
          pythonBin: bin,
          kokoro: false,
          chatterbox: false,
          stt: false,
          error: (err || `python exited ${code}`).trim().slice(-300),
        });
      }
    });
  }).then((value) => {
    readinessCache = { bin, at: Date.now(), value };
    readinessInflight = null;
    return value;
  });
  readinessInflight = { bin, promise };
  return promise;
}

export async function synthesizeSpeech({ text, voice, speed = 1.0, generationId, pythonBin }) {
  const spoken = speechText(text);
  if (!spoken) {
    throw new Error('Text did not contain any speakable words.');
  }
  const { engine, voiceId, refAudioPath } = resolveSynthesisTarget(voice);
  const wav = await runPythonWorker({
    engine,
    text: spoken,
    voiceId,
    speed: Number(speed) || 1,
    refAudioPath,
    pythonBin,
  });
  const watermarkedWav = embedWatermark(wav, {
    id: generationId,
    voiceId: voice?.id || voiceId,
    engine,
    ts: Date.now(),
  });
  return { wav: watermarkedWav, mode: engine, engine };
}
