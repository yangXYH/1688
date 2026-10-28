import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixBinMode } from '../scripts/fix_bin_mode.mjs';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-bin-mode-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('fix_bin_mode', () => {
  it('is a no-op on Windows', async () => {
    const target = path.join(tmpDir, 'cli.js');
    const result = await fixBinMode({ platform: 'win32', target });

    expect(result).toEqual({
      changed: false,
      reason: 'windows-noop',
      target,
    });
  });

  it('chmods the bin file on Unix-like platforms', async () => {
    const target = path.join(tmpDir, 'cli.js');
    await fs.writeFile(target, '#!/usr/bin/env node\n');

    // Windows cannot represent POSIX execute bits. Verify the syscall on every
    // host, and the real permission bits where the filesystem supports them.
    const chmod = vi.spyOn(fs, 'chmod');
    const result = await fixBinMode({ platform: 'linux', target });
    expect(chmod).toHaveBeenCalledWith(target, 0o755);
    chmod.mockRestore();

    expect(result).toEqual({
      changed: true,
      reason: 'chmod-755',
      target,
    });
    if (process.platform !== 'win32') expect((await fs.stat(target)).mode & 0o777).toBe(0o755);
  });
});
