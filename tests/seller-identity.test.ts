import { beforeEach, describe, expect, it, vi } from 'vitest';
const { offerExecute } = vi.hoisted(() => ({ offerExecute: vi.fn() }));
vi.mock('../src/commands/offer.js', () => ({ execute: offerExecute }));
vi.mock('../src/session/wait.js', () => ({ sleep: async () => {} }));
import { scrapeFeGlobals } from '../src/commands/seller-inquire.js';
beforeEach(() => offerExecute.mockReset());
function fixture(loginId: string | null) {
  const page = { goto: vi.fn(async () => {}), evaluate: vi.fn(async () => ({ offerLoginId: loginId })), close: vi.fn(async () => {}) };
  const ctx = { newPage: vi.fn(async () => page) };
  return { page, ctx };
}
describe('seller identity resolution', () => {
  it('keeps the direct FE_GLOBALS identity when available', async () => {
    const { ctx, page } = fixture('direct-seller');
    expect(await scrapeFeGlobals(ctx as any, { offerId: '123' })).toEqual({ offerLoginId: 'direct-seller' });
    expect(offerExecute).not.toHaveBeenCalled(); expect(page.close).toHaveBeenCalledOnce();
  });
  it('uses the structured offer seller when FE_GLOBALS omits the ID', async () => {
    const { ctx, page } = fixture(null);
    offerExecute.mockImplementation(async () => { expect(page.close).toHaveBeenCalledOnce(); return { supplier: { loginId: 'structured-seller' } }; });
    expect(await scrapeFeGlobals(ctx as any, { offerId: '123' })).toEqual({ offerLoginId: 'structured-seller' });
    expect(offerExecute).toHaveBeenCalledWith(ctx, { offerId: '123' });
  });
  it('does not retry browser/risk errors as a different seller lookup', async () => {
    const { ctx, page } = fixture(null);
    const error = Object.assign(new Error('risk control'), { exitCode: 4 });
    page.goto.mockRejectedValueOnce(error);
    await expect(scrapeFeGlobals(ctx as any, { offerId: '123' })).rejects.toBe(error);
    expect(offerExecute).not.toHaveBeenCalled(); expect(page.close).toHaveBeenCalledOnce();
  });
});
