import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Write an upload to a 16-bit PCM wav. Uses ffmpeg when it is available. */
export function writeUploadAsWav(buffer, destPath, { sampleRate = 24000 } = {}) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const srcPath = `${destPath}.src`;
  fs.writeFileSync(srcPath, buffer);
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-i', srcPath, '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_s16le', destPath],
    { stdio: 'ignore' },
  );
  fs.rmSync(srcPath, { force: true });
  if (result.status === 0 && fs.existsSync(destPath) && fs.statSync(destPath).size > 44) {
    return destPath;
  }
  fs.writeFileSync(destPath, buffer);
  return destPath;
}
