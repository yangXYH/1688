import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  checkChromiumCache,
  removePathFix,
  writePermissionFix,
} from '../src/commands/doctor.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('doctor browser installation check', () => {
  it('accepts system Chrome without requiring a second Chromium download', async () => {
    vi.stubEnv('BB1688_FORCE_CHROMIUM', '0');
    vi.spyOn(fs, 'access').mockImplementation(async (filename) => {
      if (!/chrome\.exe$|Google Chrome$|\/opt\/google\/chrome\/chrome$/.test(String(filename))) throw new Error('missing');
    });
    expect(await checkChromiumCache()).toMatchObject({ status: 'ok', message: expect.stringContaining('System Chrome found') });
  });
  it('honors forced Chromium even when system Chrome exists', async () => {
    vi.stubEnv('BB1688_FORCE_CHROMIUM', '1');
    const access = vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'));
    expect(await checkChromiumCache()).toMatchObject({ status: 'fail', fix: 'npx playwright install chromium' });
    expect(access).toHaveBeenCalledTimes(1);
    expect(access.mock.calls[0]?.[0]).toBe(chromium.executablePath());
  });
  it('accepts only the executable matching the current Playwright version', async () => {
    vi.stubEnv('BB1688_FORCE_CHROMIUM', '1');
    const access = vi.spyOn(fs, 'access').mockResolvedValue();
    expect(await checkChromiumCache()).toMatchObject({ status: 'ok', message: expect.stringContaining(chromium.executablePath()) });
    expect(access).toHaveBeenCalledTimes(1);
    access.mockRejectedValue(new Error('stale cache'));
    expect(await checkChromiumCache()).toMatchObject({ status: 'fail' });
  });
});

describe('doctor platform hints', () => {
  it('prints Unix permission and removal fixes', () => {
    expect(writePermissionFix('/home/me/.1688', 'linux')).toBe(
      'chmod u+w "/home/me/.1688"',
    );
    expect(removePathFix('/home/me/.1688/.lock.lock', 'linux', { recursive: true })).toBe(
      'rm -rf "/home/me/.1688/.lock.lock"',
    );
    expect(removePathFix('/home/me/.1688/state.json', 'linux')).toBe(
      'rm "/home/me/.1688/state.json"',
    );
  });

  it('prints Windows PowerShell-compatible fixes', () => {
    expect(writePermissionFix('C:\\Users\\me\\.1688', 'win32')).toBe(
      'Grant write permission to "C:\\Users\\me\\.1688" or set BB1688_HOME to a writable directory.',
    );
    expect(removePathFix('C:\\Users\\me\\.1688\\.lock.lock', 'win32', { recursive: true })).toBe(
      'PowerShell: Remove-Item -Recurse -Force "C:\\Users\\me\\.1688\\.lock.lock"',
    );
    expect(removePathFix('C:\\Users\\me\\.1688\\state.json', 'win32')).toBe(
      'PowerShell: Remove-Item -Force "C:\\Users\\me\\.1688\\state.json"',
    );
  });
});
