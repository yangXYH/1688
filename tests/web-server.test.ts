import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startWebFixture } from './helpers/web-fixture.js';

describe('packaged workbench API', () => {
  let fixture: Awaited<ReturnType<typeof startWebFixture>>;
  beforeAll(async () => { fixture = await startWebFixture(); });
  afterAll(async () => { await fixture?.close(); });
  const post = (route: string, body: unknown) => fetch(`${fixture.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('serves the shipped page and reports the CLI session directory', async () => {
    expect(await (await fetch(fixture.url)).text()).toContain('verified-select');
    const status = await (await fetch(`${fixture.url}/api/status`)).json();
    expect(status).toMatchObject({ connected: true, sessionPath: fixture.home });
    expect(await (await fetch(`${fixture.url}/api/health`)).json()).toEqual({ ok: true, exportSchemaVersion: 2, offerDedupeVersion: 1 });
  });

  it('provides dialogue setup without exposing credentials or contacting sellers', async () => {
    const before = (await fixture.calls()).length;
    expect((await fetch(`${fixture.url}/supplier-ui.js`)).status).toBe(200);
    expect((await post('/api/supplier/start', {})).status).toBe(400);
    const configured = await post('/api/supplier/config', { endpoint: 'https://model.example/v1/chat/completions', model: 'test', apiKey: 'private-key', workers: 2 });
    expect(configured.status).toBe(200);
    expect(await configured.text()).not.toContain('private-key');
    expect((await post('/api/supplier/start', { maxSends: 10 })).status).toBe(400);
    expect((await fixture.calls()).length).toBe(before);
    expect((await post('/api/supplier/jobs', { targets: ['123'], mode: 'automatic' })).status).toBe(400);
    const created = await (await post('/api/supplier/jobs', { targets: ['123'] })).json();
    expect(created).toMatchObject({ running: false, jobs: [{ phase: 'queued', mode: 'review', offerId: '123' }] });
    expect((await post('/api/supplier/jobs', { targets: ['--help'] })).status).toBe(400);
    expect((await post('/api/supplier/config', null)).status).toBe(400);
    expect((await post('/api/supplier/pause', {})).status).toBe(200);
    expect((await fixture.calls()).length).toBe(before);
  });

  it('shows failed doctor checks and recovery rather than an empty exit-code error', async () => {
    const file = path.join(fixture.home, 'doctor-failure.json');
    await fs.writeFile(file, JSON.stringify({ ok: false, checks: [{ name: 'Chromium cache', status: 'fail', message: 'Required browser executable missing', fix: 'npx playwright install chromium' }] }));
    try {
      const response = await post('/api/supplier/start', { maxSends: 10 });
      expect(response.status).toBe(500);
      const error = await response.json();
      expect(error.message).toContain('Chromium cache: Required browser executable missing');
      expect(error.message).toContain('npx playwright install chromium');
      const state = await (await fetch(`${fixture.url}/api/supplier`)).json();
      expect(state.running).toBe(false);
      expect(state.notice).toContain('Required browser executable missing');
      expect((await fixture.calls()).some((args) => args[0] === 'seller')).toBe(false);
    } finally { await fs.unlink(file); }
  });

  it('links a search receipt to an authorized scoped inquiry and rejects arbitrary/stale targets', async () => {
    const search = await (await post('/api/search', { keyword: '旅行箱', max: 20 })).json();
    expect(search.inquirySource.keyword).toBe('旅行箱');
    const body = { sourceId: search.inquirySource.id, offerIds: ['123'], approvedTemplates: true, maxSends: 10 };
    expect((await post('/api/supplier/from-search', { ...body, sourceId: 'stale' })).status).toBe(409);
    expect((await post('/api/supplier/from-search', { ...body, offerIds: ['999'] })).status).toBe(400);
    expect((await post('/api/supplier/from-search', { ...body, approvedTemplates: false })).status).toBe(400);
    const response = await post('/api/supplier/from-search', body);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.running).toBe(true);
    expect(result.scopeIds).toEqual(result.triggeredJobIds);
    const job = result.jobs.find((j) => j.id === result.triggeredJobIds[0]);
    expect(job.searchHistory[0]).toMatchObject({ keyword: '旅行箱', searchId: search.inquirySource.id });
    expect(job.title).toBe('测试保温杯');
    expect(result.jobs).toHaveLength(1); // existing offer was reused, not contacted twice
    await post('/api/supplier/pause', {});
  });

  it('rejects reversed price ranges before invoking the CLI and keeps serving', async () => {
    const before = (await fixture.calls()).length;
    const response = await post('/api/search', { keyword: '杯', priceMin: 100, priceMax: 10 });
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('最低价不能高于最高价。');
    expect((await fixture.calls()).length).toBe(before);
    expect((await fetch(`${fixture.url}/api/health`)).status).toBe(200);
  });

  it('passes region and inspection filters as arguments and bounds detail requests', async () => {
    expect((await post('/api/search', { keyword: '杯', province: '浙江', city: '杭州', verified: 'factory', excludeAds: true })).status).toBe(200);
    const args = (await fixture.calls()).at(-1);
    expect(args).toEqual(expect.arrayContaining(['--province', '浙江', '--city', '杭州', '--verified', 'factory', '--exclude-ads']));
    expect((await post('/api/offer-details', { offerIds: ['123'] })).status).toBe(200);
    expect((await fixture.calls()).at(-1)).toEqual(['offer', '123', '--json']);
    expect((await post('/api/offer-details', { offerIds: Array(6).fill('123') })).status).toBe(400);
    expect((await post('/api/offer-details', { offerIds: ['--help'] })).status).toBe(400);
  });

  it.each([20, 30, 50, 100, 500, 1000])('passes the %i result limit to both search commands', async (max) => {
    expect((await post('/api/search', { keyword: '杯', max })).status).toBe(200);
    let args = (await fixture.calls()).at(-1);
    expect(args[args.indexOf('--max') + 1]).toBe(String(max));
    expect((await post('/api/image-search', { imageUrl: 'https://example.com/cup.png', max })).status).toBe(200);
    args = (await fixture.calls()).at(-1);
    expect(args[args.indexOf('--max') + 1]).toBe(String(max));
  });

  it('exports 1000 rows and rejects exports beyond the result limit', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ['', String(1000 + i), '杯', '20', '', '', '', '', '', '', '', '', '上游未提供统计周期']);
    const response = await post('/api/export-products', { rows, source: '最多 1000 件' });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    expect(workbook.getWorksheet('商品')!.rowCount).toBe(1001);
    expect(workbook.getWorksheet('商品')!.getCell('B1001').value).toBe('1999');
    expect((await post('/api/export-products', { rows: [...rows, rows[0]], source: '超出上限' })).status).toBe(400);
  });

  it('exports an actual workbook with the previous query provenance and demand columns', async () => {
    const response = await post('/api/export-products', { schemaVersion: 2, rows: Array.from({ length: 20 }, (_, i) => ['', String(123 + i), '杯', '20', '', '', '', '100+', '', '', '', 'bookedCount', '上游未提供统计周期']), source: '上一次成功搜索；关键词「杯」' });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    expect(workbook.getWorksheet('商品')!.getRow(1).values).toContain('销量线索');
    expect(workbook.getWorksheet('商品')!.getRow(1).values).not.toContain('复购率');
    expect(workbook.getWorksheet('商品')!.getRow(1).values).not.toContain('统计周期');
    expect(workbook.getWorksheet('商品')!.rowCount).toBe(21);
    expect(workbook.getWorksheet('搜索来源')!.getCell('B1').value).toContain('上一次成功搜索');
  });

  it('reports an incompatible export schema with a recoverable error', async () => {
    const response = await post('/api/export-products', { schemaVersion: 1 });
    expect(response.status).toBe(409);
    expect((await response.json()).message).toContain('导出版本不一致');
  });

  it('deduplicates offer IDs only when requested and validates the option', async () => {
    const rows = [
      ['', '1', '甲', '', '', '', '', '', '', 'https://example.com/a.jpg', 'https://detail.1688.com/offer/1.html', '', ''],
      ['', '1', '乙', '', '', '', '', '', '', 'https://example.com/a.jpg', 'https://detail.1688.com/offer/1.html', '', ''],
    ];
    const response = await post('/api/export-products', { rows, source: '图片搜索', dedupeOfferIds: true });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    expect(workbook.getWorksheet('商品')!.rowCount).toBe(2);
    expect(response.headers.get('x-exported-count')).toBe('1');
    expect((await post('/api/export-products', { rows, source: '图片搜索', dedupeOfferIds: 'true' })).status).toBe(400);
  });

  it('accepts current 13-column pages already open before schema negotiation was added', async () => {
    const response = await post('/api/export-products', { rows: [['', '123', '杯', '20', '', '', '', '100+', '', '', '', 'bookedCount', '上游未提供统计周期']], source: '已打开页面的搜索结果' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
  });
});
