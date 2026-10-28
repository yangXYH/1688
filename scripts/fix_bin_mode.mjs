import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function fixBinMode({
  platform = process.platform,
  target = path.join('dist', 'cli.js'),
} = {}) {
  if (platform === 'win32') {
    return { changed: false, reason: 'windows-noop', target };
  }
  await fs.chmod(target, 0o755);
  return { changed: true, reason: 'chmod-755', target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await fixBinMode();
}
