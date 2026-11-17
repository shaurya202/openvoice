import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './index.js';
import { createToneWav, embedWatermark, extractWatermark } from './watermark.js';

function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openvoice-test-'));
  const app = createApp({ dataDir: tmpDir });
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

test('POST /api/tts synthesizes, watermarks, and saves to history', async () => {
  const srv = await startTestServer();
  try {
    const res = await fetch(`${srv.baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello from OpenVoice!', voiceId: 'af_heart' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.entry.id);
    assert.equal(body.entry.watermarked, true);

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

test('POST /api/voices/clone enforces consent recording', async () => {
  const srv = await startTestServer();
  try {
    const wavBlob = new Blob([createToneWav({ durationSec: 0.5 })], { type: 'audio/wav' });

    // Missing consentAudio should be rejected
    const badForm = new FormData();
    badForm.append('name', 'Test Voice');
    badForm.append('consentConfirmed', 'true');
    badForm.append('sampleAudio', wavBlob, 'sample.wav');

    const badRes = await fetch(`${srv.baseUrl}/api/voices/clone`, { method: 'POST', body: badForm });
    assert.equal(badRes.status, 400);

    // With consentAudio + consentConfirmed should succeed
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
