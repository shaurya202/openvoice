import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStore } from './store.js';
import { designVoice, autoDirect, writeScript, translateText, agentReply, isPublikConfigured } from './llm.js';
import { synthesizeSpeech } from './tts.js';
import { embedWatermark, extractWatermark } from './watermark.js';

export function createApp({ dataDir } = {}) {
  const app = express();
  const store = createStore(dataDir);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'openvoice',
      publikLlmConfigured: isPublikConfigured(),
    });
  });

  app.get('/api/voices', (_req, res) => {
    res.json({ voices: store.listVoices() });
  });

  app.post('/api/voices', (req, res) => {
    const { name, engine = 'kokoro', description = '', settings = {}, blend = [], tags = [] } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Voice name is required' });
    }
    const voice = store.addVoice({
      name: String(name).trim(),
      engine,
      type: 'designed',
      description,
      settings,
      blend,
      tags,
    });
    res.status(201).json({ voice });
  });

  app.post('/api/voices/design', async (req, res) => {
    const { description } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ error: 'Voice description is required' });
    }
    const result = await designVoice(description);
    res.json(result);
  });

  app.post(
    '/api/voices/clone',
    upload.fields([
      { name: 'sampleAudio', maxCount: 1 },
      { name: 'consentAudio', maxCount: 1 },
    ]),
    (req, res) => {
      const { name, consentConfirmed, consentPhrase } = req.body || {};
      const sampleFile = req.files?.sampleAudio?.[0];
      const consentFile = req.files?.consentAudio?.[0];

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Voice name is required' });
      }
      if (!sampleFile) {
        return res.status(400).json({ error: 'A ~10s reference audio clip (sampleAudio) is required' });
      }
      if (!consentFile || consentConfirmed !== 'true') {
        return res.status(400).json({
          error: 'Safety check failed: a consent recording (consentAudio) and explicit consent confirmation are required to clone a voice.',
        });
      }

      const id = `clone_${crypto.randomBytes(5).toString('hex')}`;
      const samplePath = path.join(store.voicesDir, `${id}_sample.wav`);
      const consentPath = path.join(store.voicesDir, `${id}_consent.wav`);
      fs.writeFileSync(samplePath, sampleFile.buffer);
      fs.writeFileSync(consentPath, consentFile.buffer);

      const voice = store.addVoice({
        id,
        name: String(name).trim(),
        engine: 'chatterbox',
        type: 'cloned',
        description: 'Cloned voice with verified consent recording',
        samplePath,
        consentPath,
        consentPhrase: consentPhrase || 'I consent to cloning my voice on OpenVoice',
        tags: ['cloned', 'chatterbox', 'consent-verified'],
      });

      res.status(201).json({ voice });
    },
  );

  app.post('/api/tts', async (req, res) => {
    try {
      const { text, voiceId = 'af_heart', speed = 1.0, applyAutoDirect = false, format = 'json' } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const voice = store.getVoice(voiceId) || { id: voiceId, name: voiceId, engine: 'kokoro' };
      const finalText = applyAutoDirect ? (await autoDirect(text)).directed : String(text);
      const generationId = crypto.randomBytes(6).toString('hex');

      const { wav, mode, engine } = await synthesizeSpeech({
        text: finalText,
        voice,
        speed: Number(speed) || 1.0,
        generationId,
      });

      const entry = store.addHistory(
        {
          id: generationId,
          text: finalText,
          voiceId: voice.id,
          voiceName: voice.name,
          engine,
          mode,
          watermarked: true,
        },
        wav,
      );

      if (format === 'wav') {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('X-OpenVoice-Id', entry.id);
        res.setHeader('X-OpenVoice-Mode', mode);
        return res.send(wav);
      }

      res.status(201).json({
        entry,
        audioUrl: `/api/history/${entry.id}/audio`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/history/upload', upload.single('audio'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'audio file is required' });
      const { text = '', voiceId = 'af_heart', voiceName = 'Kokoro (Browser)', engine = 'kokoro' } = req.body || {};
      const generationId = crypto.randomBytes(6).toString('hex');
      const watermarkedWav = embedWatermark(req.file.buffer, {
        id: generationId,
        voiceId,
        engine,
        ts: Date.now(),
      });
      const entry = store.addHistory(
        {
          id: generationId,
          text,
          voiceId,
          voiceName,
          engine,
          mode: 'browser-kokoro',
          watermarked: true,
        },
        watermarkedWav,
      );
      res.status(201).json({ entry, audioUrl: `/api/history/${entry.id}/audio` });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/history', (_req, res) => {
    res.json({ history: store.listHistory() });
  });

  app.get('/api/history/:id/audio', (req, res) => {
    const item = store.getHistory(req.params.id);
    if (!item) return res.status(404).json({ error: 'History item not found' });
    const filePath = path.join(store.audioDir, item.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio file missing' });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${item.filename}"`);
    res.sendFile(filePath);
  });

  app.delete('/api/history/:id', (req, res) => {
    const ok = store.deleteHistory(req.params.id);
    if (!ok) return res.status(404).json({ error: 'History item not found' });
    res.json({ deleted: true });
  });

  app.post('/api/llm/direct', async (req, res) => {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });
    res.json(await autoDirect(text));
  });

  app.post('/api/llm/write', async (req, res) => {
    const { topic } = req.body || {};
    if (!topic) return res.status(400).json({ error: 'topic is required' });
    res.json(await writeScript(topic));
  });

  app.post('/api/llm/translate', async (req, res) => {
    const { text, targetLanguage } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });
    res.json(await translateText(text, targetLanguage));
  });

  app.post('/api/agent/turn', async (req, res) => {
    const { transcript, systemPrompt, voiceId = 'af_heart' } = req.body || {};
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });

    const llmResult = await agentReply(transcript, systemPrompt);
    const voice = store.getVoice(voiceId) || { id: voiceId, name: voiceId, engine: 'kokoro' };
    const generationId = crypto.randomBytes(6).toString('hex');
    const { wav, mode, engine } = await synthesizeSpeech({
      text: llmResult.reply,
      voice,
      generationId,
    });
    const entry = store.addHistory(
      {
        id: generationId,
        text: llmResult.reply,
        voiceId: voice.id,
        voiceName: voice.name,
        engine,
        mode,
        watermarked: true,
        source: 'voice-agent',
      },
      wav,
    );

    res.json({
      ...llmResult,
      entry,
      audioUrl: `/api/history/${entry.id}/audio`,
    });
  });

  app.post('/api/watermark/verify', upload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'audio file is required' });
    res.json(extractWatermark(req.file.buffer));
  });

  const publicDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  return app;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server\\index.js') || process.argv[1]?.endsWith('server/index.js')) {
  const port = Number(process.env.PORT) || 3001;
  const app = createApp();
  app.listen(port, () => {
    console.log(`OpenVoice API listening on http://localhost:${port}`);
  });
}
