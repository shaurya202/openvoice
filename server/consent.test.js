import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_PHRASE, matchConsentPhrase, normalizeSpeech } from './consent.js';

test('normalizeSpeech folds open voice into one word', () => {
  assert.equal(normalizeSpeech('Open Voice!'), 'openvoice');
  assert.equal(normalizeSpeech('I consent, to cloning.'), 'i consent to cloning');
});

test('exact and fuzzy consent transcripts match', () => {
  assert.equal(matchConsentPhrase(CONSENT_PHRASE).ok, true);
  assert.equal(matchConsentPhrase('I consent to cloning my voice on open voice.').ok, true);
  assert.equal(
    matchConsentPhrase(`Um, ${CONSENT_PHRASE}, thank you.`).ok,
    true,
  );
});

test('mismatched, partial, empty, and refused consent transcripts are rejected', () => {
  assert.equal(matchConsentPhrase('The weather today is rainy and cold.').ok, false);
  assert.equal(matchConsentPhrase('I consent to cloning').ok, false);
  assert.equal(matchConsentPhrase('').ok, false);
  assert.equal(matchConsentPhrase('   ').ok, false);
  assert.equal(matchConsentPhrase('I do not consent to cloning my voice on OpenVoice').ok, false);
});
