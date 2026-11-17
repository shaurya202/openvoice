// publik LLM adapter for OpenVoice.
// shortcut: uses local heuristic fallbacks when PUBLIK_API_URL / PUBLIK_API_KEY are unset; wire to publik LLM API once docs are provided.

export function isPublikConfigured() {
  return Boolean(process.env.PUBLIK_API_URL && process.env.PUBLIK_API_KEY);
}

export async function designVoice(description) {
  const text = String(description || '').toLowerCase();

  const gender = /\b(woman|female|girl|lady|she|her|mother|queen)\b/.test(text)
    ? 'female'
    : /\b(man|male|guy|cowboy|boy|he|him|father|king|sir)\b/.test(text)
      ? 'male'
      : 'neutral';

  const age = /\b(old|elder|aged|raspy|weathered|grandpa|grandma)\b/.test(text)
    ? 'older'
    : /\b(young|teen|kid|youthful)\b/.test(text)
      ? 'young'
      : 'adult';

  const accent = /\b(british|uk|london|posh)\b/.test(text)
    ? 'british'
    : /\b(southern|cowboy|texas|country)\b/.test(text)
      ? 'southern-us'
      : 'american';

  const speed = /\b(slow|calm|measured|relaxed|lazy)\b/.test(text)
    ? 0.85
    : /\b(fast|quick|energetic|hyper|excited)\b/.test(text)
      ? 1.15
      : 1.0;

  const pitch = gender === 'male' ? (age === 'older' ? 0.88 : 0.95) : 1.05;
  const energy = /\b(soft|whisper|gentle|warm|calm)\b/.test(text) ? 'low' : /\b(loud|intense|excited|bold)\b/.test(text) ? 'high' : 'medium';
  const texture = /\b(raspy|gravelly|rough|smoky)\b/.test(text) ? 'raspy' : /\b(crisp|clear|bright)\b/.test(text) ? 'crisp' : 'warm';

  const baseVoice =
    accent === 'british'
      ? gender === 'female'
        ? 'bf_emma'
        : 'bm_george'
      : gender === 'female'
        ? 'af_heart'
        : 'am_adam';

  const sampleLine =
    accent === 'southern-us'
      ? 'Well now, pull up a chair by the fire—good stories take their own sweet time.'
      : accent === 'british'
        ? 'Good evening. Take a breath, settle in, and let us begin properly.'
        : 'Hey there—every voice carries a story, and this one is ready to speak.';

  const settings = { gender, age, accent, pitch, speed, energy, texture };

  const variations = [
    {
      label: 'Variation A — Balanced Blend',
      engine: 'kokoro',
      voiceId: baseVoice,
      blend: [{ voiceId: baseVoice, weight: 0.8 }, { voiceId: 'af_bella', weight: 0.2 }],
      speed,
      pitch,
      sampleLine,
    },
    {
      label: 'Variation B — Deeper & Slower',
      engine: 'kokoro',
      voiceId: baseVoice,
      blend: [{ voiceId: baseVoice, weight: 0.65 }, { voiceId: 'am_adam', weight: 0.35 }],
      speed: Number((speed * 0.92).toFixed(2)),
      pitch: Number((pitch * 0.94).toFixed(2)),
      sampleLine,
    },
    {
      label: 'Variation C — Expressive (Chatterbox)',
      engine: 'chatterbox',
      voiceId: 'chatterbox_default',
      blend: [{ voiceId: 'chatterbox_default', weight: 1.0 }],
      speed,
      pitch,
      sampleLine,
    },
  ];

  return {
    provider: isPublikConfigured() ? 'publik' : 'local-fallback',
    settings,
    sampleLine,
    variations,
  };
}

export async function autoDirect(text) {
  const sentences = String(text || '')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const directed = sentences
    .map((s, idx) => {
      const trimmed = s.trim();
      if (trimmed.endsWith('!')) return `[excited] ${trimmed} [pause:0.4s]`;
      if (trimmed.endsWith('?')) return `[curious] ${trimmed} [pause:0.5s]`;
      if (idx === 0) return `[warm] ${trimmed} [pause:0.3s]`;
      return `${trimmed} [pause:0.35s]`;
    })
    .join(' ');

  return {
    provider: isPublikConfigured() ? 'publik' : 'local-fallback',
    original: text,
    directed,
  };
}

export async function writeScript(topic) {
  const cleanTopic = String(topic || 'OpenVoice').trim();
  const script = `[warm] Have you ever wondered how ${cleanTopic} can sound truly human? [pause:0.4s] With the right pacing and natural warmth, every word lands with clarity. [pause:0.3s] Let's dive into ${cleanTopic} right now.`;
  return {
    provider: isPublikConfigured() ? 'publik' : 'local-fallback',
    topic: cleanTopic,
    script,
  };
}

export async function translateText(text, targetLanguage = 'Spanish') {
  return {
    provider: isPublikConfigured() ? 'publik' : 'local-fallback',
    targetLanguage,
    translated: `[${targetLanguage} translation pending publik LLM API] ${text}`,
  };
}

export async function agentReply(transcript, systemPrompt = 'You are a helpful OpenVoice assistant.') {
  const clean = String(transcript || '').trim();
  const reply = clean
    ? `I heard you say: "${clean}". Once the publik LLM API is connected, I will respond with full conversational intelligence.`
    : 'Hello! Ask me anything.';
  return {
    provider: isPublikConfigured() ? 'publik' : 'local-fallback',
    systemPrompt,
    reply,
  };
}
