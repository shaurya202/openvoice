// Invisible LSB audio watermarking for 16-bit PCM WAV files.

const MAGIC = Buffer.from('OVW1', 'ascii');

function findDataChunk(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV buffer');
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      return { dataOffset: offset + 8, dataSize: Math.min(size, buf.length - (offset + 8)) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV data chunk not found');
}

export function embedWatermark(wavBuffer, metadata) {
  const out = Buffer.from(wavBuffer);
  const { dataOffset, dataSize } = findDataChunk(out);

  const json = Buffer.from(JSON.stringify(metadata), 'utf8');
  const header = Buffer.alloc(8);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(json.length, 4);
  const payload = Buffer.concat([header, json]);

  const totalBits = payload.length * 8;
  const availableSamples = Math.floor(dataSize / 2);
  if (totalBits > availableSamples) {
    throw new Error(`Audio too short for watermark (${availableSamples} samples < ${totalBits} bits)`);
  }

  for (let i = 0; i < totalBits; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    const bit = (payload[byteIdx] >> bitIdx) & 1;
    const samplePos = dataOffset + i * 2;
    // Modify LSB of 16-bit little-endian PCM sample
    out[samplePos] = (out[samplePos] & 0xfe) | bit;
  }

  return out;
}

export function extractWatermark(wavBuffer) {
  try {
    const { dataOffset, dataSize } = findDataChunk(wavBuffer);
    const availableSamples = Math.floor(dataSize / 2);
    if (availableSamples < 64) return { valid: false, reason: 'Audio too short' };

    const readBytes = (startBit, byteCount) => {
      const result = Buffer.alloc(byteCount);
      for (let i = 0; i < byteCount * 8; i++) {
        const samplePos = dataOffset + (startBit + i) * 2;
        const bit = wavBuffer[samplePos] & 1;
        result[Math.floor(i / 8)] |= bit << (i % 8);
      }
      return result;
    };

    const header = readBytes(0, 8);
    if (!header.subarray(0, 4).equals(MAGIC)) {
      return { valid: false, reason: 'No OpenVoice watermark found' };
    }

    const payloadLen = header.readUInt32LE(4);
    if (payloadLen <= 0 || payloadLen > 4096 || (8 + payloadLen) * 8 > availableSamples) {
      return { valid: false, reason: 'Corrupted watermark length' };
    }

    const jsonBuf = readBytes(64, payloadLen);
    const payload = JSON.parse(jsonBuf.toString('utf8'));
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

export function createToneWav({ durationSec = 1.2, freq = 220, sampleRate = 24000 } = {}) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / 800) * Math.min(1, (numSamples - i) / 800);
    const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.15 * 32767 * envelope);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}
