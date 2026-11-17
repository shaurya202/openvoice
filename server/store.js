import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_VOICES = [
  {
    id: 'af_heart',
    name: 'Heart (Kokoro)',
    engine: 'kokoro',
    type: 'standard',
    description: 'Warm, natural American female voice',
    tags: ['female', 'american', 'warm'],
  },
  {
    id: 'af_bella',
    name: 'Bella (Kokoro)',
    engine: 'kokoro',
    type: 'standard',
    description: 'Clear, expressive American female voice',
    tags: ['female', 'american', 'expressive'],
  },
  {
    id: 'am_adam',
    name: 'Adam (Kokoro)',
    engine: 'kokoro',
    type: 'standard',
    description: 'Deep, steady American male voice',
    tags: ['male', 'american', 'deep'],
  },
  {
    id: 'am_michael',
    name: 'Michael (Kokoro)',
    engine: 'kokoro',
    type: 'standard',
    description: 'Crisp, conversational American male voice',
    tags: ['male', 'american', 'conversational'],
  },
  {
    id: 'bf_emma',
    name: 'Emma (Kokoro)',
    engine: 'kokoro',
    type: 'standard',
    description: 'Polished British female voice',
    tags: ['female', 'british', 'polished'],
  },
  {
    id: 'bm_george',
    name: 'George (Kokoro)',
    engine: 'kokoro',
    type: 'standard',
    description: 'Rich British male narrator voice',
    tags: ['male', 'british', 'narrator'],
  },
  {
    id: 'chatterbox_default',
    name: 'Expressive Studio (Chatterbox)',
    engine: 'chatterbox',
    type: 'expressive',
    description: 'MIT-licensed expressive voice with emotion control',
    tags: ['expressive', 'chatterbox'],
  },
];

export function createStore(dataDir = path.resolve(process.cwd(), 'data')) {
  const audioDir = path.join(dataDir, 'audio');
  const voicesDir = path.join(dataDir, 'voices');
  const dbPath = path.join(dataDir, 'db.json');

  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(voicesDir, { recursive: true });

  function readDb() {
    if (!fs.existsSync(dbPath)) {
      const initial = { voices: [...DEFAULT_VOICES], history: [] };
      fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));
      return initial;
    }
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }

  function writeDb(db) {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  }

  return {
    audioDir,
    voicesDir,
    listVoices() {
      return readDb().voices;
    },
    getVoice(id) {
      return readDb().voices.find((v) => v.id === id) || null;
    },
    addVoice(voice) {
      const db = readDb();
      const entry = {
        id: voice.id || `voice_${crypto.randomBytes(5).toString('hex')}`,
        createdAt: new Date().toISOString(),
        ...voice,
      };
      db.voices.push(entry);
      writeDb(db);
      return entry;
    },
    listHistory() {
      return readDb().history;
    },
    getHistory(id) {
      return readDb().history.find((h) => h.id === id) || null;
    },
    addHistory(item, wavBuffer) {
      const db = readDb();
      const id = item.id || crypto.randomBytes(6).toString('hex');
      const filename = `${id}.wav`;
      fs.writeFileSync(path.join(audioDir, filename), wavBuffer);
      const entry = {
        id,
        filename,
        createdAt: new Date().toISOString(),
        ...item,
      };
      db.history.unshift(entry);
      writeDb(db);
      return entry;
    },
    deleteHistory(id) {
      const db = readDb();
      const idx = db.history.findIndex((h) => h.id === id);
      if (idx === -1) return false;
      const [removed] = db.history.splice(idx, 1);
      writeDb(db);
      const filePath = path.join(audioDir, removed.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    },
  };
}
