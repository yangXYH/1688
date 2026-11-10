import fs from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// Exercise the shipped script and its event handlers without a live account.
// This small DOM double stores values/listeners; real rendering is checked in
// the browser separately.
async function workbench(supplier = false) {
  const elements = new Map<string, any>();
  function element(id: string): any {
    if (!elements.has(id)) elements.set(id, {
      value: ({ 'sort-select': 'relevance', 'max-select': '20', 'verified-select': 'any', 'image-max': '20' } as Record<string, string>)[id] ?? '',
      checked: false, hidden: false, disabled: false, textContent: '', innerHTML: '',
      firstChild: {}, dataset: {}, validity: { badInput: false }, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {}, focus() {}, click() {}, remove() {}, append() {}, after() {}, contains() { return false; }, scrollIntoView() {},
      querySelector() { return element(`${id}-child`); }, querySelectorAll() { return []; },
      addEventListener(type: string, callback: Function) { this.listeners[type] = callback; },
    });
    return elements.get(id);
  }
  const requests: any[] = [];
  const documentListeners = new Map<string, Function>();
  let failSearch = false;
  let exportSchemaVersion: number | undefined = 2;
  let offerDedupeVersion: number | undefined = 1;
  const offer = { offerId: '123', title: '杯子', price: { text: '¥20' }, turnover: '100+', demand: { orderCountText: '100+', orderCountSource: 'bookedCount' }, verified: { factory: true, business: true } };
  const question = { id: 'product', text: '请确认是否同款。', label: '同款' };
  const inquiryState = { running: false, starting: false, notice: '未启动', sendCount: 0, maxSends: 100, config: null, questions: [question], jobs: [] as any[] };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [], querySelector: element, addEventListener(type: string, fn: Function) { documentListeners.set(type, fn); }, dispatchEvent(event: Event) { documentListeners.get(event.type)?.(event); }, createElement: element, body: element('body') },
    Event,
    URL: class extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (url: string, options: any) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      requests.push({ url, body });
      if (url === '/api/supplier') return { ok: true, json: async () => inquiryState };
      if (url === '/api/supplier/from-search') {
        const job = { id: 'inquiry-1', offerId: '123', productUrl: 'https://detail.1688.com/offer/123.html', source: { keyword: '杯' }, mode: 'automatic', step: 0, phase: 'queued', questions: [question], answers: [], transcript: [], error: '' };
        return { ok: true, json: async () => ({ ...inquiryState, jobs: [job], running: true, triggeredJobIds: [job.id] }) };
      }
      if (url === '/api/health') return { ok: true, json: async () => ({ ok: true, exportSchemaVersion, offerDedupeVersion }) };
      if (url === '/api/export-products') return { ok: true, blob: async () => ({}), headers: { get: () => '0' } };
      return { ok: !(failSearch && url === '/api/search'), json: async () => url === '/api/status' ? { connected: false, sessionPath: 'test-home' }
        : failSearch && url === '/api/search' ? { message: '网络中断' } : { offers: [offer], total: 1, ...(url === '/api/search' ? { inquirySource: { id: `search-${body.keyword}`, keyword: body.keyword } } : {}) } };
    },
  });
  vm.runInContext(await fs.readFile(new URL('../web/app.js', import.meta.url), 'utf8'), context);
  if (supplier) {
    element('inquiry-count').value = '1'; element('supplier-budget').value = '100'; element('supplier-panel').hidden = true;
    vm.runInContext(await fs.readFile(new URL('../web/supplier-ui.js', import.meta.url), 'utf8'), context);
  }
  return {
    element, requests,
    run: (code: string) => vm.runInContext(code, context),
    fail: () => { failSearch = true; },
    oldServer: () => { exportSchemaVersion = undefined; },
    currentServer: () => { exportSchemaVersion = 2; },
    oldGrouping: () => { offerDedupeVersion = undefined; },
    submit: () => element('keyword-form').listeners.submit({ preventDefault() {} }),
  };
}

describe('workbench buyer regressions', () => {
  it('starts inquiry from actual search results and shows it inline without changing the search page', async () => {
    const ui = await workbench(true);
    ui.element('keyword-input').value = '杯'; await ui.submit();
    await Promise.resolve(); await Promise.resolve();
    ui.element('inquiry-consent').checked = true;
    ui.element('inquiry-consent').listeners.change();
    ui.element('supplier-detail').contains = () => true;
    ui.run('document.activeElement = {matches: () => false}'); // a focused action button must not freeze progress rendering
    await ui.element('inquiry-trigger').listeners.click();
    expect(ui.requests.find((r) => r.url === '/api/supplier/from-search').body).toMatchObject({ sourceId: 'search-杯', offerIds: ['123'], approvedTemplates: true });
    expect(ui.run('state.mode')).toBe('keyword');
    expect(ui.run('state.offers[0].offerId')).toBe('123');
    expect(ui.element('result-section').hidden).toBe(false);
    expect(ui.element('supplier-panel').hidden).toBe(false);
    expect(ui.element('supplier-flow-source').textContent).toContain('杯');
    expect(ui.element('supplier-detail').innerHTML).toContain('查看商品 123');
  });
  it('does not inquire stale results after a failed search and preserves source IDs per search mode', async () => {
    const ui = await workbench(true);
    ui.element('keyword-input').value = '杯'; await ui.submit();
    ui.run("setMode('bestseller'); setMode('keyword')");
    expect(ui.run('state.inquirySource.id')).toBe('search-杯');
    ui.fail(); await ui.submit();
    ui.element('inquiry-consent').checked = true;
    await ui.element('inquiry-trigger').listeners.click();
    expect(ui.requests.some((r) => r.url === '/api/supplier/from-search')).toBe(false);
  });
  it('sends the optional offer ID deduplication choice when exporting', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '杯';
    await ui.submit();
    ui.element('export-dedupe-offers').checked = true;
    await ui.element('export-button').listeners.click();
    expect(ui.requests.find((request) => request.url === '/api/export-products').body.dedupeOfferIds).toBe(true);
  });

  it('does not silently export without grouping on an older server', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '杯';
    await ui.submit();
    ui.element('export-dedupe-offers').checked = true;
    ui.oldGrouping();
    await ui.element('export-button').listeners.click();
    expect(ui.requests.some((request) => request.url === '/api/export-products')).toBe(false);
    expect(ui.element('message-box').textContent).toContain('重新运行 pnpm ui');
    expect(ui.run('state.offers.length')).toBe(1);
  });
  it('shows the actual pagination failure reason for partial results', async () => {
    const ui = await workbench();
    ui.run("handlePayload({offers:[{offerId:'123'}],pagination:{pagesFetched:1,stopReason:'next_page_unavailable'}}, '关键词搜索', 1000)");
    expect(ui.element('message-box').textContent).toContain('未找到可用的下一页按钮');
    expect(ui.element('message-box').textContent).toContain('已读取 1 页');
    expect(ui.element('message-box').textContent).not.toContain('实际数量以平台返回');
  });

  it('submits 1000 as the upper limit for both modes and explains shorter platform results', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '旅行拉杆箱';
    ui.element('max-select').value = '1000';
    await ui.submit();
    expect(ui.requests.find((request) => request.url === '/api/search').body.max).toBe(1000);
    expect(ui.element('message-box').textContent).toContain('已返回 1 件');
    expect(ui.element('message-box').textContent).toContain('最多 1000 件');
    ui.run("setMode('image'); state.imageMode = 'url'");
    ui.element('image-url').value = 'https://example.com/cup.png';
    ui.element('image-max').value = '1000';
    await ui.element('image-form').listeners.submit({ preventDefault() {} });
    expect(ui.requests.find((request) => request.url === '/api/image-search').body.max).toBe(1000);
    ui.run("setMode('keyword')");
    expect(ui.element('max-select').value).toBe(1000);
  });

  it('explains a stale running API and preserves the selected results for retry', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '旅行拉杆箱';
    await ui.submit();
    ui.element('select-all').listeners.change({ target: { checked: true } });
    ui.oldServer();
    await ui.element('export-button').listeners.click();
    expect(ui.element('message-box').textContent).toContain('服务版本过旧');
    expect(ui.element('message-box').textContent).toContain('重新运行 pnpm ui');
    expect(ui.requests.some((request) => request.url === '/api/export-products')).toBe(false);
    expect(ui.run('state.offers.length')).toBe(1);
    expect(ui.run('state.selected.size')).toBe(1);
    expect(ui.element('export-button').disabled).toBe(false);
    ui.currentServer();
    await ui.element('export-button').listeners.click();
    expect(ui.requests.find((request) => request.url === '/api/export-products').body.schemaVersion).toBe(2);
    expect(ui.element('message-box').hidden).toBe(true);
    expect(ui.run('state.selected.size')).toBe(1);
  });

  it('blocks invalid prices immediately without issuing a search', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '保温杯';
    ui.element('price-min').value = '100';
    ui.element('price-max').value = '10';
    ui.element('price-min').listeners.input();
    expect(ui.element('price-error').textContent).toBe('最低价不能高于最高价。');
    expect(ui.element('keyword-submit').disabled).toBe(true);
    await ui.submit();
    expect(ui.requests.some((request) => request.url === '/api/search')).toBe(false);
    ui.element('price-max').value = '200';
    ui.element('price-max').listeners.input();
    expect(ui.element('keyword-submit').disabled).toBe(false);
  });

  it('keeps the successful query snapshot after a failure, including in exports and after switching', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '保温杯';
    ui.element('province-input').value = '浙江';
    await ui.submit();
    expect(ui.requests.find((request) => request.url === '/api/search').body.province).toBe('浙江');
    ui.element('select-all').listeners.change({ target: { checked: true } });
    ui.fail();
    ui.element('keyword-input').value = '新关键词';
    await ui.submit();
    expect(ui.element('result-summary').textContent).toContain('以下为上一次搜索结果');
    expect(ui.element('result-summary').textContent).toContain('保温杯');
    expect(ui.element('result-summary').textContent).not.toContain('新关键词');
    await ui.element('export-button').listeners.click();
    const exported = ui.requests.find((request) => request.url === '/api/export-products').body;
    expect(exported.source).toContain('上一次成功搜索');
    expect(exported.source).toContain('保温杯');
    expect(exported.rows[0][11]).toContain('bookedCount');
    expect(exported.rows[0][12]).toBe('上游未提供统计周期');
    ui.run("setMode('image'); setMode('keyword')");
    expect(ui.run('state.offers.length')).toBe(1);
    expect(ui.run('state.selected.size')).toBe(1);
    expect(ui.element('keyword-input').value).toBe('新关键词');
    expect(ui.element('result-summary').textContent).toContain('以下为上一次搜索结果');
  });

  it('preserves separate mode results, selection and filters and exports image results as Excel', async () => {
    const ui = await workbench();
    ui.element('keyword-input').value = '保温杯';
    ui.element('sort-select').value = 'price-asc';
    await ui.submit();
    ui.element('select-all').listeners.change({ target: { checked: true } });
    ui.run("setMode('bestseller')");
    expect(ui.run('state.offers.length')).toBe(0);
    expect(ui.element('sort-select').value).toBe('best-selling');
    ui.run("setMode('image'); handlePayload({offers: [{offerId: '456', title: '图片结果'}]}, '图片搜索 · sample.png')");
    await ui.element('export-button').listeners.click();
    expect(ui.requests.find((request) => request.url === '/api/export-products').body.rows[0][1]).toBe('456');
    expect(ui.element('export-label').textContent).toContain('Excel');
    ui.run("setMode('keyword')");
    expect(ui.run('state.offers[0].offerId')).toBe('123');
    expect(ui.run('state.selected.size')).toBe(1);
    expect(ui.element('sort-select').value).toBe('price-asc');
    expect(ui.run('renderCard(state.offers[0], 0)')).toContain('factoryInspection');
    expect(ui.run('renderCard(state.offers[0], 0)')).not.toMatch(/实力工厂|诚信通商家/);
  });

  it('keeps per-offer detail errors visible beside successful comparison rows and escapes SKU text', async () => {
    const ui = await workbench();
    ui.run(`state.details.set('123', {title:'杯子', minOrderQty:10, unitName:'件', priceTiers:[{minQty:100,price:18}], skus:[{skuId:'1',specs:'<img onerror=alert(1)>',price:20,stock:null}]});
      state.failures.set('456', '详情获取失败');
      renderComparison([{offerId:'123'}, {offerId:'456',title:'商品二'}]);`);
    const html = ui.element('comparison-panel').innerHTML;
    expect(html).toContain('10 件');
    expect(html).toContain('100 件起：¥18');
    expect(html).toContain('详情获取失败');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
    expect(html).not.toContain('<img onerror');
    expect(ui.element('comparison-panel').hidden).toBe(false);
  });
});
