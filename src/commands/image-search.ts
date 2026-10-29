import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BrowserContext } from 'playwright';
import { dispatch } from '../session/dispatch.js';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { withRecovery } from '../session/recovery.js';
import {
  clickImageSearchButton,
  clickImageUploadButton,
} from '../session/image-search-locators.js';
import { captureSearchOffersForAction } from '../session/search-capture.js';
import type { SearchOfferCaptureWaitStatus } from '../session/search-capture.js';
import { type Offer } from './search.js';

export interface ImageSearchOpts {
  imagePath: string;
  max?: string;
  profile?: string;
  headed?: boolean;
}

export interface ImageSearchArgs {
  imagePath: string;
  max: number;
  headed?: boolean;
}

export interface ImageSearchResult {
  imageId: string;
  total: number;
  offers: Offer[];
}

// Upload entry point. 1688 currently redirects this to the pc-image-search app
// on air.1688.com, and after "搜索图片" the page lands on a URL carrying
// `imageId=<digits>` — that is where uploadAndGetImageId reads the id from.
export const IMAGE_SEARCH_UPLOAD_URL = 'https://s.1688.com/youyuan/index.htm';

// Results page for an already-uploaded imageId.
//
// Do NOT use the legacy `s.1688.com/selloffer/offer_search.htm?imageId=...`
// URL here: 1688 now ignores `imageId` on that page and renders the ordinary
// keyword-search shell with an empty query. Its getOfferList mtop call then
// returns a personalised "猜你喜欢" feed, so every image produced the same 60
// unrelated offers. The pc-image-search app instead fires appId=32517
// recommend calls with the imageId in their params (see
// IMAGE_SEARCH_RESULT_METHODS); the response has the same
// `data.data.OFFER.items` shape our parser expects.
export function imageSearchResultUrl(imageId: string): string {
  const id = encodeURIComponent(imageId);
  return `https://air.1688.com/kapp/1688-search/pc-image-search/?tab=imageSearch&imageId=${id}&imageIdList=${id}`;
}

// mtop `params.method` values that carry the image-search offer list on the
// results page. Observed sequence on a fresh imageId:
//   1. getImageSearchPreResult  → placeholder (`"mock":["mock"]`, no items)
//      while the server is still computing
//   2. imageOfferSearchService  → the real 60-offer list ~0.5s later
// On a later load of the same imageId the pre-result is cached server-side
// and getImageSearchPreResult itself returns the 60 offers, with no second
// call. Accept both; empty placeholder bodies are ignored by the capture.
// The page also fires other appId=32517 calls (behaviour reports, AI-assist
// streams, empty getOfferList probes), so the capture must stay scoped.
export const IMAGE_SEARCH_RESULT_METHODS = [
  'getImageSearchPreResult',
  'imageOfferSearchService',
] as const;

function isLoginUrl(url: string): boolean {
  return /login\.1688\.com|login\.taobao\.com/.test(url);
}

function isRiskUrl(url: string): boolean {
  return /\/punish|x5secdata=/.test(url);
}

/** An empty capture is inconclusive; it does not prove there are no matches. */
export function assertImageSearchCapture(
  status: SearchOfferCaptureWaitStatus,
  url: string,
): void {
  if (status === 'browser_closed') {
    throw new CliError(130, 'CANCELED', 'Browser closed.');
  }
  if (isLoginUrl(url)) {
    throw new CliError(3, 'NOT_LOGGED_IN', 'Session expired. Run `1688 login`.');
  }
  if (status === 'blocked' || isRiskUrl(url)) {
    throw new CliError(4, 'RISK_CONTROL', '1688 verification required. Run once with `--headed` and complete it manually.');
  }
  if (status !== 'captured') {
    throw new CliError(9, 'IMAGE_SEARCH_CAPTURE_FAILED',
      'Could not capture image-search results. The search outcome is unknown.');
  }
}

export async function execute(
  ctx: BrowserContext,
  args: ImageSearchArgs,
): Promise<ImageSearchResult> {
  try {
    await fs.access(args.imagePath, fs.constants.R_OK);
  } catch {
    throw new CliError(2, 'BAD_INPUT', `Cannot read image: ${args.imagePath}`);
  }

  return withRecovery(
    ctx,
    { cmd: 'image-search', args },
    () => executeImageSearch(ctx, args),
    { headed: args.headed === true, maxRetries: 1 },
  );
}

async function executeImageSearch(
  ctx: BrowserContext,
  args: ImageSearchArgs,
): Promise<ImageSearchResult> {
  info('Uploading image to 1688...');
  const imageId = await uploadAndGetImageId(ctx, args.imagePath);
  info(`Image uploaded (imageId=${imageId}). Fetching results...`);

  const offers = await searchByImageId(ctx, imageId, args.max);
  return {
    imageId,
    total: offers.length,
    offers: offers.slice(0, args.max),
  };
}

async function uploadAndGetImageId(
  ctx: BrowserContext,
  imagePath: string,
): Promise<string> {
  const page = await ctx.newPage();
  try {
    page.on('filechooser', async (chooser) => {
      try {
        await chooser.setFiles(imagePath);
      } catch {
        /* ignore — handled by waitForURL timeout */
      }
    });

    await page.goto(IMAGE_SEARCH_UPLOAD_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    assertImageSearchCapture('captured', page.url());

    await clickImageUploadButton(page);

    await Promise.all([
      page
        .waitForURL(/imageId=\d+/, { timeout: 20000 })
        .catch(() => undefined),
      clickImageSearchButton(page),
    ]);

    assertImageSearchCapture('captured', page.url());
    const match = page.url().match(/imageId=(\d+)/);
    if (!match) {
      throw new CliError(
        13,
        'UPLOAD_FAILED',
        'No imageId in URL after upload. Try again or use --headed.',
      );
    }
    return match[1]!;
  } catch (error) {
    // The upload controls can disappear when navigation hits a login or risk
    // page. Check before closing the page so recovery preserves exit 3/4.
    assertImageSearchCapture('captured', page.url());
    throw error;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function searchByImageId(
  ctx: BrowserContext,
  imageId: string,
  max: number,
): Promise<Offer[]> {
  const page = await ctx.newPage();

  try {
    const captureResult = await captureSearchOffersForAction(
      { page, keep: 'largest', requireMethod: IMAGE_SEARCH_RESULT_METHODS },
      async () => {
        await page.goto(imageSearchResultUrl(imageId), {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      },
      {
        timeoutMs: 15000,
        isClosed: () => page.isClosed(),
        isBlocked: () => isRiskUrl(page.url()) || isLoginUrl(page.url()),
      },
    );
    if (process.env.BB1688_DEBUG === '1') {
      process.stderr.write(
        `[image-search] capture status=${captureResult.status} url=${page.url()} ` +
          `diagnostics=${JSON.stringify(captureResult.diagnostics)}\n`,
      );
    }
    assertImageSearchCapture(captureResult.status, page.url());
    const offers = new Map(captureResult.offers.map((offer) => [offer.offerId, offer]));
    // The image results page loads its next batch when scrolled to the bottom.
    // Capture only the requested page so background requests cannot pollute it.
    for (let number = 2; offers.size < max && number <= 34; number++) {
      const previousHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const next = await captureSearchOffersForAction(
        { page, keep: 'largest', requireMethod: 'imageOfferSearchService', targetPage: () => number },
        async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        },
        { timeoutMs: 15000, isClosed: () => page.isClosed(), isBlocked: () => isRiskUrl(page.url()) || isLoginUrl(page.url()) },
      );
      if (next.status === 'timeout') break;
      assertImageSearchCapture(next.status, page.url());
      const before = offers.size;
      for (const offer of next.offers) if (!offers.has(offer.offerId)) offers.set(offer.offerId, offer);
      if (offers.size === before) break;
      // Let the page render the batch before scrolling to its new bottom.
      await page.waitForFunction((height) => document.documentElement.scrollHeight > height,
        previousHeight, { timeout: 5000 }).catch(() => {});
    }
    return [...offers.values()];
  } finally {
    await page.close().catch(() => {});
  }
}

export async function run(opts: ImageSearchOpts): Promise<void> {
  if (!opts.imagePath) {
    throw new CliError(2, 'BAD_INPUT', 'Image path or URL required.');
  }
  const max = Math.max(1, parseInt(opts.max ?? '20', 10));

  let abs: string;
  let cleanup: (() => Promise<void>) | null = null;
  if (/^https?:\/\//i.test(opts.imagePath)) {
    info(`Downloading image from URL...`);
    const t = await downloadToTemp(opts.imagePath);
    abs = t.path;
    cleanup = t.cleanup;
  } else {
    abs = path.resolve(opts.imagePath);
  }

  try {
    const data = await dispatch<ImageSearchArgs, ImageSearchResult>(
      'image-search',
      { imagePath: abs, max, headed: opts.headed },
      { headed: opts.headed, profile: opts.profile },
    );
    emit({
      human: () => printResults(data),
      data,
    });
  } finally {
    if (cleanup) await cleanup().catch(() => {});
  }
}

interface TempFile {
  path: string;
  cleanup: () => Promise<void>;
}

async function downloadToTemp(url: string): Promise<TempFile> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      `Failed to download image: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new CliError(
      9,
      'NETWORK_ERROR',
      `Download failed: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new CliError(9, 'NETWORK_ERROR', 'Downloaded image is empty.');
  }
  if (buf.length > 20 * 1024 * 1024) {
    throw new CliError(
      2,
      'BAD_INPUT',
      `Image too large (${(buf.length / 1024 / 1024).toFixed(1)}MB > 20MB).`,
    );
  }
  const ext = guessExt(url, res.headers.get('content-type'));
  const tmpPath = path.join(
    os.tmpdir(),
    `bb1688-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
  );
  await fs.writeFile(tmpPath, buf);
  return {
    path: tmpPath,
    cleanup: () => fs.rm(tmpPath, { force: true }),
  };
}

function guessExt(url: string, contentType: string | null): string {
  const m = url.match(/\.(jpe?g|png|webp|bmp)(\?|$|#)/i);
  if (m) return '.' + m[1]!.toLowerCase().replace('jpeg', 'jpg');
  if (contentType) {
    if (/jpeg/i.test(contentType)) return '.jpg';
    if (/png/i.test(contentType)) return '.png';
    if (/webp/i.test(contentType)) return '.webp';
    if (/bmp/i.test(contentType)) return '.bmp';
  }
  return '.jpg';
}

function printResults(r: ImageSearchResult): void {
  if (r.offers.length === 0) {
    process.stdout.write(`No offers found (imageId=${r.imageId}).\n`);
    return;
  }
  process.stdout.write(`Image search (imageId=${r.imageId}):\n\n`);
  const w = String(r.offers.length).length;
  r.offers.forEach((o, i) => {
    const idx = String(i + 1).padStart(w, ' ');
    const price = o.price.text || '(n/a)';
    process.stdout.write(`${idx}. ${o.title}\n`);
    const pad = ' '.repeat(w + 2);
    process.stdout.write(`${pad}${price}`);
    if (o.turnover) process.stdout.write(`  ·  ${o.turnover}`);
    process.stdout.write('\n');
    const supplierBits = [
      o.supplier.name,
      o.supplier.years ? `${o.supplier.years}年` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (supplierBits) process.stdout.write(`${pad}${supplierBits}\n`);
    process.stdout.write(`${pad}${o.url}\n`);
    if (i < r.offers.length - 1) process.stdout.write('\n');
  });
}
