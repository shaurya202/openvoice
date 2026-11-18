import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerArgs, resolveSynthesisTarget, speechText } from './tts.js';

test('speech text strips direction tags', () => {
  assert.equal(speechText('[warm] Hello [pause:0.4s] there.'), 'Hello there.');
});

test('cloned voices synthesize with their reference sample', () => {
  const target = resolveSynthesisTarget({
    id: 'clone_abc',
    engine: 'chatterbox',
    type: 'cloned',
    samplePath: '/tmp/sample.wav',
  });
  assert.equal(target.engine, 'chatterbox');
  assert.equal(target.refAudioPath, '/tmp/sample.wav');
  const args = buildWorkerArgs({ ...target, text: 'Hi', speed: 1, outPath: '/tmp/out.wav' });
  const refIndex = args.indexOf('--ref-audio');
  assert.equal(args[refIndex + 1], '/tmp/sample.wav');
});

test('a clone without a sample is an error', () => {
  assert.throws(
    () => resolveSynthesisTarget({ id: 'clone_abc', engine: 'chatterbox', type: 'cloned' }),
    /reference sample/,
  );
});

test('designed kokoro voices use the blend id', () => {
  const target = resolveSynthesisTarget({
    id: 'voice_custom',
    engine: 'kokoro',
    blend: [{ voiceId: 'am_adam', weight: 1 }],
  });
  assert.equal(target.voiceId, 'am_adam');
  assert.equal(target.refAudioPath, null);
});