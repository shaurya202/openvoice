/** Browser build. The esm.sh entry is the Node build and throws "[unenv] fs.readFile is not implemented yet". */
export const KOKORO_BROWSER_MODULE = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * WebGPU is usable only when requestAdapter() returns an adapter.
 * Headless Chrome exposes navigator.gpu even when that call returns null.
 */
export async function selectKokoroDevice(nav = globalThis.navigator) {
  const gpu = nav?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return 'wasm';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}
