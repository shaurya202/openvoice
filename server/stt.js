import { spawn } from 'node:child_process';
import path from 'node:path';
import { resolvePythonBin } from './tts.js';

const WORKER_PATH = path.resolve(process.cwd(), 'worker', 'stt_worker.py');
const MARKER = 'OPENVOICE_TRANSCRIPT:';

function summarize(stderr, code, bin) {
  const lines = String(stderr || '')
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-6).join(' | ');
  const clipped = tail.length > 700 ? `…${tail.slice(-700)}` : tail;
  const hint = /not installed|No module named|ModuleNotFoundError/i.test(stderr || '')
    ? ` Install dependencies with scripts/setup-python.sh or set PYTHON_BIN (current interpreter: ${bin}).`
    : '';
  return `Consent could not be verified because speech-to-text failed: ${clipped || `worker exited with code ${code}`}.${hint}`;
}

/** Transcribe an audio file. Resolves to the transcript (possibly empty). */
export function transcribeFile(audioPath, { pythonBin } = {}) {
  const bin = resolvePythonBin(pythonBin);
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(process.env.OPENVOICE_STT_TIMEOUT_MS) || 5 * 60 * 1000;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(bin, [WORKER_PATH, '--audio', audioPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
      },
    });
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Consent could not be verified because speech-to-text timed out.'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on('error', (err) => {
      finish(
        new Error(
          `Consent could not be verified because speech-to-text could not start ${bin} (${err.message}). Run scripts/setup-python.sh or set PYTHON_BIN.`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(summarize(stderr, code, bin)));
        return;
      }
      const line = stdout
        .split('\n')
        .map((item) => item.trim())
        .reverse()
        .find((item) => item.startsWith(MARKER));
      if (line === undefined) {
        finish(new Error('Consent could not be verified because speech-to-text returned no transcript.'));
        return;
      }
      finish(null, line.slice(MARKER.length).trim());
    });
  });
}
