import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
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

  it('exports an actual workbook with the previous query provenance and demand columns', async () => {
    const response = await post('/api/export-products', { rows: [['', '123', '杯', '20', '', '', '', '100+', '', '', '', 'bookedCount', '上游未提供统计周期']], source: '上一次成功搜索；关键词「杯」' });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    expect(workbook.getWorksheet('商品')!.getCell('H1').value).toBe('销量线索');
    expect(workbook.getWorksheet('搜索来源')!.getCell('B1').value).toContain('上一次成功搜索');
  });
});
