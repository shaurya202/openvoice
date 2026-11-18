/** Phrase the speaker must say in the consent recording. The server checks this; the client cannot substitute another phrase. */
export const CONSENT_PHRASE = 'I consent to cloning my voice on OpenVoice';

const ACCEPT_SCORE = 0.78;

export function normalizeSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/open[\s-]*voice/g, 'openvoice')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = next;
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (!a && !b) return 1;
  const denom = Math.max(a.length, b.length);
  if (!denom) return 1;
  return 1 - levenshtein(a, b) / denom;
}

function bestWindowScore(heard, expected) {
  if (heard.includes(expected)) return 1;
  const words = heard.split(' ');
  const expectedWords = expected.split(' ');
  const n = expectedWords.length;
  let best = similarity(heard, expected);
  for (let i = 0; i < words.length; i++) {
    const minLen = Math.max(1, n - 1);
    const maxLen = n + 2;
    for (let len = minLen; len <= maxLen && i + len <= words.length; len++) {
      best = Math.max(best, similarity(words.slice(i, i + len).join(' '), expected));
    }
  }
  return best;
}

/**
 * Fuzzy-match a transcript against the consent phrase.
 * A refusal ("I do not consent...") does not pass just because most of the words appear.
 */
export function matchConsentPhrase(transcript, phrase = CONSENT_PHRASE) {
  const heard = normalizeSpeech(transcript);
  const expected = normalizeSpeech(phrase);
  if (!heard) {
    return { ok: false, score: 0, heard, reason: 'The consent recording had no recognizable speech.' };
  }
  if (/\b(do not|don t|dont|never|refuse|refusing)\b/.test(heard) || /\bno\b/.test(heard)) {
    return { ok: false, score: 0, heard, reason: 'The consent recording sounds like a refusal.' };
  }
  const score = bestWindowScore(heard, expected);
  const ok = score >= ACCEPT_SCORE;
  return {
    ok,
    score,
    heard,
    reason: ok ? '' : 'The consent recording does not match the required phrase.',
  };
}
