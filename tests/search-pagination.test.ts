import type { BrowserContext } from 'playwright';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ capture: vi.fn(), next: vi.fn(), sleep: vi.fn() }));
vi.mock('../src/session/recovery.js', () => ({ withRecovery: (_ctx: unknown, _meta: unknown, task: () => unknown) => task() }));
vi.mock('../src/session/search-capture.js', () => ({ startSearchOfferCapture: mocks.capture }));
vi.mock('../src/session/search-locators.js', () => ({ clickSearchNextPage: mocks.next }));
vi.mock('../src/session/wait.js', () => ({ sleep: mocks.sleep, waitWithDeadline: vi.fn() }));

import { execute } from '../src/commands/search.js';
import { mapOffer, type Offer } from '../src/session/search-mtop.js';

function offers(start: number, count = 60): Offer[] {
  return Array.from({ length: count }, (_, i) => mapOffer({ data: { offerId: String(start + i), title: `商品 ${start + i}`, priceInfo: { price: '20' } } })!);
}

let batches: Offer[][];
let capturedPages: number[];
let timeoutPage: number | undefined;
let blockedPage: number | undefined;
let currentUrl: string;
let ctx: BrowserContext;

beforeEach(() => {
  vi.clearAllMocks();
  batches = Array.from({ length: 34 }, (_, i) => offers(i * 60 + 1));
  capturedPages = [];
  timeoutPage = undefined;
  blockedPage = undefined;
  currentUrl = 'https://www.1688.com/';
  const locator = { first() { return this; }, isVisible: async () => true, isEnabled: async () => true, click: async () => {} };
  const page = {
    url: () => currentUrl, isClosed: () => false,
    goto: async (url: string) => { currentUrl = url; },
    locator: () => locator,
    keyboard: { type: async () => {}, press: async (key: string) => { if (key === 'Enter') currentUrl = 'https://s.1688.com/selloffer/offer_search.htm?keywords=test'; } },
  };
  ctx = { newPage: async () => page } as unknown as BrowserContext;
  mocks.next.mockReset().mockResolvedValue(true);
  mocks.capture.mockImplementation((options: { targetPage: () => number }) => ({
    dispose: vi.fn(),
    wait: async () => {
      const target = options.targetPage();
      capturedPages.push(target);
      return { status: target === blockedPage ? 'blocked' : target === timeoutPage ? 'timeout' : 'captured', offers: target === timeoutPage || target === blockedPage ? [] : batches[target - 1], diagnostics: {} };
    },
  }));
});

describe('keyword multi-page collection', () => {
  it('collects 1000 unique offers across 17 sequential captured pages', async () => {
    const result = await execute(ctx, { keyword: '旅行拉杆箱', max: 1000 });
    expect(result.offers).toHaveLength(1000);
    expect(new Set(result.offers.map((offer) => offer.offerId)).size).toBe(1000);
    expect(result.offers.at(-1)?.offerId).toBe('1000');
    expect(capturedPages).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(mocks.next).toHaveBeenCalledTimes(16);
    expect(result.pagination).toEqual({ requestedMax: 1000, pagesFetched: 17, stopReason: 'limit_reached' });
  });

  it('continues past the nominal page count when repeated ads reduce the unique count', async () => {
    batches[1] = [...offers(1, 30), ...offers(61, 30)];
    batches[2] = offers(91);
    const result = await execute(ctx, { keyword: '旅行拉杆箱', max: 100 });
    expect(result.offers).toHaveLength(100);
    expect(new Set(result.offers.map((offer) => offer.offerId)).size).toBe(100);
    expect(capturedPages).toEqual([1, 2, 3]);
    expect(result.pagination?.pagesFetched).toBe(3);
  });

  it('reports an unavailable next button instead of implying the platform has only 60 offers', async () => {
    mocks.next.mockResolvedValue(false);
    const result = await execute(ctx, { keyword: '旅行拉杆箱', max: 1000 });
    expect(result.offers).toHaveLength(60);
    expect(result.pagination).toEqual({ requestedMax: 1000, pagesFetched: 1, stopReason: 'next_page_unavailable' });
    expect(capturedPages).toEqual([1]);
  });

  it('distinguishes a failed click from reaching the result end', async () => {
    mocks.next.mockRejectedValue(new Error('button covered'));
    const result = await execute(ctx, { keyword: '旅行拉杆箱', max: 1000 });
    expect(result.pagination?.stopReason).toBe('next_page_failed');
    expect(mocks.next).toHaveBeenCalledTimes(1);
  });

  it('keeps partial results with a specific reason when the next response times out', async () => {
    timeoutPage = 2;
    const result = await execute(ctx, { keyword: '旅行拉杆箱', max: 1000 });
    expect(result.offers).toHaveLength(60);
    expect(result.pagination?.stopReason).toBe('capture_timeout');
    expect(capturedPages).toEqual([1, 2]);
  });

  it('does not silently retry a later-page verification challenge', async () => {
    blockedPage = 2;
    await expect(execute(ctx, { keyword: '旅行拉杆箱', max: 1000 })).rejects.toMatchObject({ code: 'RISK_CONTROL', exitCode: 4 });
    expect(mocks.next).toHaveBeenCalledTimes(1);
    expect(capturedPages).toEqual([1, 2]);
  });

  it('stops at an actual short last page or a full page with no new IDs', async () => {
    batches[1] = offers(61, 12);
    const short = await execute(ctx, { keyword: '旅行拉杆箱', max: 1000 });
    expect(short.offers).toHaveLength(72);
    expect(short.pagination?.stopReason).toBe('end_of_results');
    batches[1] = offers(1);
    const repeated = await execute(ctx, { keyword: '旅行拉杆箱', max: 1000 });
    expect(repeated.offers).toHaveLength(60);
    expect(repeated.pagination?.stopReason).toBe('no_new_offers');
  });
});
