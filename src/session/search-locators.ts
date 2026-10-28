import type { Page } from 'playwright';
import { clickStable, findVisible } from './locator.js';

const NEXT_PAGE_SELECTORS = [
  // Current search uses CSS-module suffixes; match the stable component name
  // inside the pagination region, without coupling to a build-specific hash.
  '[data-spm="pagination"] [class*="nextArrow--"]:not([class*="arrowDisabled--"]):not([aria-disabled="true"])',
  '.fui-arrow.fui-next:not(.fui-next-disabled):not([aria-disabled="true"])',
];

export async function clickSearchNextPage(page: Page): Promise<boolean> {
  const next = await findVisible(
    page,
    NEXT_PAGE_SELECTORS.map((selector) => ({ kind: 'css' as const, selector })),
    {
      description: 'search next page button',
      timeoutMs: 1000,
    },
  ).catch(() => null);
  if (!next) {
    if (process.env.BB1688_PROBE === '1') {
      const controls = await page.evaluate(() => Array.from(document.querySelectorAll('button, a, [role="button"], [class*="pagination"], [class*="Pagination"]'))
        .filter((element) => /下一页|下页|next|pagination/i.test(`${element.className} ${element.getAttribute('aria-label')} ${element.textContent}`))
        .slice(-30).map((element) => element.outerHTML.slice(0, 2000)));
      process.stderr.write(`[pagination-controls] ${JSON.stringify(controls)}\n`);
    }
    return false;
  }

  await clickStable(
    page,
    NEXT_PAGE_SELECTORS.map((selector) => ({ kind: 'css' as const, selector })),
    {
      description: 'search next page button',
      timeoutMs: 5000,
    },
  );
  return true;
}
