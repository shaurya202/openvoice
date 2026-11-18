import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './index.js';
import { createToneWav, embedWatermark, extractWatermark } from './watermark.js';

function startTestServer(options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvoice-test-'));
  const app = createApp({ dataDir: tmpDir, ...options });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((r) => {
            server.close(() => {
              fs.rmSync(tmpDir, { recursive: true, force: true });
              r();
            });
          }),
      });
    });
  });
}

test('watermark embed and extract roundtrip', () => {
  const raw = createToneWav({ durationSec: 0.5 });
  assert.equal(extractWatermark(raw).valid, false);

  const meta = { id: 'gen_123', voiceId: 'af_heart', ts: 1700000000 };
  const watermarked = embedWatermark(raw, meta);
  const extracted = extractWatermark(watermarked);
  assert.equal(extracted.valid, true);
  assert.deepEqual(extracted.payload, meta);
});

test('POST /api/tts synthesizes, watermarks, and saves to history', { timeout: 300_000 }, async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello from OpenVoice!', voiceId: 'af_heart' }),
    });
    if (res.status !== 201) {
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(body.error, /Speech synthesis failed/);
      const hist = await fetch(`${srv.baseUrl}/api/history`).then((r) => r.json());
      assert.equal(hist.history.length, 0);
      return;
    }
    const body = await res.json();
    assert.ok(body.entry.id);
    assert.equal(body.entry.watermarked, true);
    assert.equal(body.entry.mode, 'kokoro');

    const audioRes = await fetch(`${srv.baseUrl}${body.audioUrl}`);
    assert.equal(audioRes.status, 200);
    const wavBuf = Buffer.from(await audioRes.arrayBuffer());
    const wm = extractWatermark(wavBuf);
    assert.equal(wm.valid, true);
    assert.equal(wm.payload.id, body.entry.id);
  } finally {
    await srv.close();
  }
});

test('POST /api/tts reports a worker failure instead of a tone', async () => {
  const srv = await startTestServer({ pythonBin: '/usr/bin/false' });
  try {
    const res = await fetch(`${srv.baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'This must not become a beep.', voiceId: 'af_heart' }),
    });
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('content-type')?.includes('audio'), false);
    const body = await res.json();
    assert.match(body.error, /Speech synthesis failed/);
    const hist = await fetch(`${srv.baseUrl}/api/history`).then((r) => r.json());
    assert.equal(hist.history.length, 0);
  } finally {
    await srv.close();
  }
});

test('POST /api/voices/clone enforces consent recording', async () => {
  const srv = await startTestServer({
    transcribeAudio: async () => 'I consent to cloning my voice on OpenVoice',
  });
  try {
    const wavBlob = new Blob([createToneWav({ durationSec: 0.5 })], { type: 'audio/wav' });

    const badForm = new FormData();
    badForm.append('name', 'Test Voice');
    badForm.append('consentConfirmed', 'true');
    badForm.append('sampleAudio', wavBlob, 'sample.wav');

    const badRes = await fetch(`${srv.baseUrl}/api/voices/clone`, { method: 'POST', body: badForm });
    assert.equal(badRes.status, 400);

    const goodForm = new FormData();
    goodForm.append('name', 'Test Voice');
    goodForm.append('consentConfirmed', 'true');
    goodForm.append('sampleAudio', wavBlob, 'sample.wav');
    goodForm.append('consentAudio', wavBlob, 'consent.wav');

    const goodRes = await fetch(`${srv.baseUrl}/api/voices/clone`, { method: 'POST', body: goodForm });
    assert.equal(goodRes.status, 201);
    const { voice } = await goodRes.json();
    assert.equal(voice.type, 'cloned');
    assert.equal(voice.engine, 'chatterbox');
    assert.equal(voice.consentPhrase, 'I consent to cloning my voice on OpenVoice');
    assert.ok(voice.samplePath);
  } finally {
    await srv.close();
  }
});

test('POST /api/voices/clone rejects a consent transcript that misses the phrase', async () => {
  const srv = await startTestServer({
    transcribeAudio: async () => 'The weather today is rainy and cold',
  });
  try {
    const wavBlob = new Blob([createToneWav({ durationSec: 0.5 })], { type: 'audio/wav' });
    const form = new FormData();
    form.append('name', 'Wrong Consent');
    form.append('consentConfirmed', 'true');
    form.append('sampleAudio', wavBlob, 'sample.wav');
    form.append('consentAudio', wavBlob, 'consent.wav');

    const res = await fetch(`${srv.baseUrl}/api/voices/clone`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /I consent to cloning my voice on OpenVoice/);
    const voices = await fetch(`${srv.baseUrl}/api/voices`).then((r) => r.json());
    assert.equal(voices.voices.some((voice) => voice.name === 'Wrong Consent'), false);
  } finally {
    await srv.close();
  }
});

test('POST /api/voices/design returns structured settings and 3 variations', async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/api/voices/design`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'raspy old cowboy, slow and warm' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.settings.gender, 'male');
    assert.equal(data.settings.age, 'older');
    assert.equal(data.settings.accent, 'southern-us');
    assert.equal(data.variations.length, 3);
  } finally {
    await srv.close();
  }
});
