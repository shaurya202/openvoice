// publik LLM adapter for OpenVoice (OpenAI-compatible /chat/completions via resolveProvider).
import { MODELS, resolveProvider, topUpUrlFrom402 } from './publik.js';

export function isPublikConfigured() {
  return resolveProvider(getOwnKeyConfig()).kind === 'publik';
}

function getOwnKeyConfig() {
  if (!process.env.OPENAI_API_KEY) return null;
  return {
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
  };
}

async function chatComplete(system, user, { json = false } = {}) {
  const provider = resolveProvider(getOwnKeyConfig());
  if (provider.kind === 'needs_own_key') return { fallback: true, provider: 'local-fallback' };

  const res = await fetch(`${provider.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.kind === 'publik' ? MODELS.fast : (process.env.OPENAI_MODEL || 'gpt-4o-mini'),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (res.status === 402) {
    const info = topUpUrlFrom402(body);
    const err = new Error(info.message);
    err.status = 402;
    err.topUpUrl = info.url;
    throw err;
  }
  if (!res.ok) {
    throw new Error(body.error?.message || `LLM API error (${res.status})`);
  }
  const content = body.choices?.[0]?.message?.content?.trim() || '';
  return { fallback: false, provider: provider.kind, content };
}

export async function designVoice(description) {
  const res = await chatComplete(
    'Return JSON with keys: settings ({gender, age, accent, pitch, speed, energy, texture}), sampleLine (one in-character sentence).',
    `Design a voice for: ${description}`,
    { json: true },
  ).catch((e) => {
    if (e.status === 402) throw e;
    return { fallback: true, provider: 'local-fallback' };
  });

  let settings;
  let sampleLine;
  if (!res.fallback && res.content) {
    try {
      const parsed = JSON.parse(res.content);
      settings = parsed.settings;
      sampleLine = parsed.sampleLine;
    } catch {}
  }

  // Fallback heuristic when no key is active or JSON parse failed
  const text = String(description || '').toLowerCase();
  if (!settings) {
    const gender = /\b(woman|female|girl|lady|she|her|mother|queen)\b/.test(text) ? 'female' : /\b(man|male|guy|cowboy|boy|he|him|father|king|sir)\b/.test(text) ? 'male' : 'neutral';
    const age = /\b(old|elder|aged|raspy|weathered|grandpa|grandma)\b/.test(text) ? 'older' : /\b(young|teen|kid|youthful)\b/.test(text) ? 'young' : 'adult';
    const accent = /\b(british|uk|london|posh)\b/.test(text) ? 'british' : /\b(southern|cowboy|texas|country)\b/.test(text) ? 'southern-us' : 'american';
    const speed = /\b(slow|calm|measured|relaxed|lazy)\b/.test(text) ? 0.85 : /\b(fast|quick|energetic|hyper|excited)\b/.test(text) ? 1.15 : 1.0;
    const pitch = gender === 'male' ? (age === 'older' ? 0.88 : 0.95) : 1.05;
    const energy = /\b(soft|whisper|gentle|warm|calm)\b/.test(text) ? 'low' : /\b(loud|intense|excited|bold)\b/.test(text) ? 'high' : 'medium';
    const texture = /\b(raspy|gravelly|rough|smoky)\b/.test(text) ? 'raspy' : /\b(crisp|clear|bright)\b/.test(text) ? 'crisp' : 'warm';
    settings = { gender, age, accent, pitch, speed, energy, texture };
  }

  const baseVoice =
    settings.accent === 'british'
      ? settings.gender === 'female' ? 'bf_emma' : 'bm_george'
      : settings.gender === 'female' ? 'af_heart' : 'am_adam';

  if (!sampleLine) {
    sampleLine =
      settings.accent === 'southern-us'
        ? 'Well now, pull up a chair by the fire—good stories take their own sweet time.'
        : settings.accent === 'british'
          ? 'Good evening. Take a breath, settle in, and let us begin properly.'
          : 'Hey there—every voice carries a story, and this one is ready to speak.';
  }

  const speed = Number(settings.speed) || 1.0;
  const pitch = Number(settings.pitch) || 1.0;

  return {
    provider: res.provider,
    settings,
    sampleLine,
    variations: [
      { label: 'Variation A — Balanced Blend', engine: 'kokoro', voiceId: baseVoice, blend: [{ voiceId: baseVoice, weight: 0.8 }, { voiceId: 'af_bella', weight: 0.2 }], speed, pitch, sampleLine },
      { label: 'Variation B — Deeper & Slower', engine: 'kokoro', voiceId: baseVoice, blend: [{ voiceId: baseVoice, weight: 0.65 }, { voiceId: 'am_adam', weight: 0.35 }], speed: Number((speed * 0.92).toFixed(2)), pitch: Number((pitch * 0.94).toFixed(2)), sampleLine },
      { label: 'Variation C — Expressive (Chatterbox)', engine: 'chatterbox', voiceId: 'chatterbox_default', blend: [{ voiceId: 'chatterbox_default', weight: 1.0 }], speed, pitch, sampleLine },
    ],
  };
}

export async function autoDirect(text) {
  const res = await chatComplete(
    'Add natural [warm], [excited], [curious], and [pause:0.4s] direction tags to this voiceover script. Return only the directed script.',
    String(text || ''),
  ).catch((e) => {
    if (e.status === 402) throw e;
    return { fallback: true, provider: 'local-fallback' };
  });

  if (!res.fallback && res.content) {
    return { provider: res.provider, original: text, directed: res.content };
  }

  const sentences = String(text || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const directed = sentences
    .map((s, idx) => {
      const t = s.trim();
      if (t.endsWith('!')) return `[excited] ${t} [pause:0.4s]`;
      if (t.endsWith('?')) return `[curious] ${t} [pause:0.5s]`;
      if (idx === 0) return `[warm] ${t} [pause:0.3s]`;
      return `${t} [pause:0.35s]`;
    })
    .join(' ');
  return { provider: 'local-fallback', original: text, directed };
}

export async function writeScript(topic) {
  const cleanTopic = String(topic || 'OpenVoice').trim();
  const res = await chatComplete(
    'Write a short, punchy 3-sentence voiceover script with [warm] and [pause:0.4s] direction tags.',
    `Topic: ${cleanTopic}`,
  ).catch((e) => {
    if (e.status === 402) throw e;
    return { fallback: true, provider: 'local-fallback' };
  });

  if (!res.fallback && res.content) {
    return { provider: res.provider, topic: cleanTopic, script: res.content };
  }
  return {
    provider: 'local-fallback',
    topic: cleanTopic,
    script: `[warm] Have you ever wondered how ${cleanTopic} can sound truly human? [pause:0.4s] With the right pacing and natural warmth, every word lands with clarity. [pause:0.3s] Let's dive into ${cleanTopic} right now.`,
  };
}

export async function translateText(text, targetLanguage = 'Spanish') {
  const res = await chatComplete(
    `Translate the user's voiceover script naturally into ${targetLanguage}. Preserve any [pause] or emotion tags. Return only the translation.`,
    String(text || ''),
  ).catch((e) => {
    if (e.status === 402) throw e;
    return { fallback: true, provider: 'local-fallback' };
  });

  if (!res.fallback && res.content) {
    return { provider: res.provider, targetLanguage, translated: res.content };
  }
  return {
    provider: 'local-fallback',
    targetLanguage,
    translated: `[${targetLanguage} translation requires an active AI key] ${text}`,
  };
}

export async function agentReply(transcript, systemPrompt = 'You are a helpful OpenVoice assistant.') {
  const clean = String(transcript || '').trim();
  const res = await chatComplete(
    `${systemPrompt} Keep replies concise and conversational for spoken audio.`,
    clean || 'Hello',
  ).catch((e) => {
    if (e.status === 402) throw e;
    return { fallback: true, provider: 'local-fallback' };
  });

  if (!res.fallback && res.content) {
    return { provider: res.provider, systemPrompt, reply: res.content };
  }
  return {
    provider: 'local-fallback',
    systemPrompt,
    reply: clean
      ? `I heard you say: "${clean}". Connect your publik plan or own API key for live AI responses.`
      : 'Hello! Ask me anything.',
  };
}
