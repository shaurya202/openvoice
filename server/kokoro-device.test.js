import test from 'node:test';
import assert from 'node:assert/strict';
import { KOKORO_BROWSER_MODULE, selectKokoroDevice } from '../public/kokoro-device.js';

test('browser Kokoro loads the web build, not the esm.sh Node build', () => {
  assert.match(KOKORO_BROWSER_MODULE, /kokoro\.web\.js$/);
  assert.equal(KOKORO_BROWSER_MODULE.includes('esm.sh'), false);
});

test('WebGPU is selected only when requestAdapter returns an adapter', async () => {
  assert.equal(await selectKokoroDevice(undefined), 'wasm');
  assert.equal(await selectKokoroDevice({}), 'wasm');
  assert.equal(
    await selectKokoroDevice({ gpu: { requestAdapter: async () => null } }),
    'wasm',
  );
  assert.equal(
    await selectKokoroDevice({
      gpu: {
        requestAdapter: async () => {
          throw new Error('no adapter');
        },
      },
    }),
    'wasm',
  );
  assert.equal(
    await selectKokoroDevice({ gpu: { requestAdapter: async () => ({ name: 'gpu' }) } }),
    'webgpu',
  );
});
