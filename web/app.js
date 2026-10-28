const state = {
  mode: 'keyword',
  imageMode: 'file',
  offers: [],
  selected: new Set(),
  file: null,
  previewUrl: null,
  busy: false,
  searchLabel: '',
  searchFailed: false,
  workspaces: {},
  details: new Map(),
  failures: new Map(),
  toastTimer: null,
  loginPollTimer: null,
  loginRequestActive: false,
  loginRunning: false,
  connected: false,
  serviceAvailable: true,
  loginQrVersion: null,
  resultView: 'grid',
  connectionMessage: '',
};

const byId = (id) => document.getElementById(id);
const navItems = [...document.querySelectorAll('[data-mode]')];
const keywordView = byId('keyword-view');
const imageView = byId('image-view');
const resultsGrid = byId('results-grid');
const emptyState = byId('empty-state');
const messageBox = byId('message-box');
const exportButton = byId('export-button');
const toast = byId('toast');

const modeContent = {
  keyword: {
    crumb: '关键词搜索',
    title: '发现值得采购的好货',
    subtitle: '从一个关键词、一张图片，找到下一款好商品。',
    result: '商品结果',
    kicker: 'SEARCH RESULTS',
    emptyTitle: '下一款好商品，从这里开始',
    emptyCopy: '输入商品关键词，或上传一张图片，发现合适的供应货源。',
  },
  image: {
    crumb: '图片找同款',
    title: '看见喜欢的，找到相似的',
    subtitle: '上传一张商品图片，让灵感与供应货源相遇。',
    result: '相似商品',
    kicker: 'IMAGE MATCHES',
    emptyTitle: '上传一张商品图片',
    emptyCopy: '选择本地图片、粘贴图片链接，或复制图片后按 Ctrl+V，开始以图找货。',
  },
  bestseller: {
    crumb: '畅销排序',
    title: '从畅销商品，发现新机会',
    subtitle: '搜索一个品类，按畅销顺序浏览 1688 返回的商品。',
    result: '畅销搜索结果',
    kicker: 'BEST-SELLING SEARCH',
    emptyTitle: '搜一个品类关键词',
    emptyCopy: '这里展示关键词搜索结果的畅销排序，不是平台全站类目榜单。',
  },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function safeHttpsUrl(value, allowedHosts = null) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (allowedHosts && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function setMode(mode) {
  if (!modeContent[mode] || state.busy) return;
  state.workspaces[state.mode] = {
    offers: state.offers, selected: state.selected, searchLabel: state.searchLabel,
    searchFailed: state.searchFailed, filters: readKeywordFilters(),
  };
  state.mode = mode;
  const saved = state.workspaces[mode];
  state.offers = saved?.offers ?? [];
  state.searchLabel = saved?.searchLabel ?? '';
  state.searchFailed = saved?.searchFailed ?? false;
  state.selected = saved?.selected ?? new Set();
  restoreKeywordFilters(saved?.filters);
  clearMessage();
  byId('comparison-panel').hidden = true;
  renderResults();
  navItems.forEach((item) => {
    const active = item.dataset.mode === mode;
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const copy = modeContent[mode];
  byId('crumb-title').textContent = copy.crumb;
  byId('page-title').textContent = copy.title;
  byId('page-subtitle').textContent = copy.subtitle;
  byId('result-title').firstChild.textContent = `${copy.result} `;
  byId('result-kicker').textContent = copy.kicker;
  byId('empty-title').textContent = copy.emptyTitle;
  byId('empty-copy').textContent = copy.emptyCopy;

  const isImage = mode === 'image';
  keywordView.hidden = isImage;
  imageView.hidden = !isImage;
  byId('keyword-button-label').textContent = mode === 'bestseller' ? '查看畅销结果' : '搜索货源';
  byId('empty-primary-label').textContent = isImage ? '选择商品图片' : '开始关键词搜索';
  byId('empty-secondary-label').textContent = isImage ? '返回关键词搜索' : '试试以图找同款';
  byId('empty-primary').querySelector('use').setAttribute('href', isImage ? '#i-upload' : '#i-search');
  if (mode === 'bestseller') byId('sort-select').value = 'best-selling';
  byId('sort-select').disabled = mode === 'bestseller';
  byId('sort-note').textContent = mode === 'bestseller'
    ? '按关键词搜索结果畅销顺序排列；非官方类目榜单'
    : '搜索结果可按价格或畅销程度排序';
  renderResultSummary();
}

function readKeywordFilters() {
  return {
    keyword: byId('keyword-input').value.trim(), sort: byId('sort-select').value,
    max: Number(byId('max-select').value), priceMin: byId('price-min').value,
    priceMax: byId('price-max').value, province: byId('province-input').value.trim(),
    city: byId('city-input').value.trim(), verified: byId('verified-select').value,
    excludeAds: byId('exclude-ads').checked,
  };
}

function restoreKeywordFilters(filters = {}) {
  for (const [key, id] of Object.entries({ keyword: 'keyword-input', sort: 'sort-select', max: 'max-select', priceMin: 'price-min', priceMax: 'price-max', province: 'province-input', city: 'city-input', verified: 'verified-select' })) {
    byId(id).value = filters[key] ?? ({ sort: 'relevance', max: 20, verified: 'any' }[key] ?? '');
  }
  byId('exclude-ads').checked = filters.excludeAds ?? false;
  validatePrices();
}

function validatePrices() {
  const min = byId('price-min');
  const max = byId('price-max');
  let message = '';
  if ([min, max].some((input) => input.validity.badInput || (input.value !== '' && (!Number.isFinite(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > 1000000)))) {
    message = '价格请输入 0 到 1,000,000 之间的数字。';
  } else if (min.value !== '' && max.value !== '' && Number(min.value) > Number(max.value)) {
    message = '最低价不能高于最高价。';
  }
  byId('price-error').textContent = message;
  byId('price-error').hidden = !message;
  min.setAttribute('aria-invalid', String(Boolean(message)));
  max.setAttribute('aria-invalid', String(Boolean(message)));
  byId('keyword-submit').disabled = state.busy || Boolean(message);
  return !message;
}

function keywordSearchLabel(filters) {
  const sort = { relevance: '综合排序', 'best-selling': '畅销排序', 'price-asc': '价格从低到高', 'price-desc': '价格从高到低' }[filters.sort];
  const verified = { any: '不限标识', factory: '验厂线索', business: '验商线索', 'super-factory': '超级工厂线索' }[filters.verified];
  return `关键词「${filters.keyword}」 · ${sort} · 价格 ${filters.priceMin || '不限'}–${filters.priceMax || '不限'} 元 · 地区 ${filters.province || '不限省份'}/${filters.city || '不限城市'} · ${verified} · ${filters.excludeAds ? '排除推广' : '含推广'} · 最多 ${filters.max} 件`;
}

function renderResultSummary() {
  byId('result-summary').textContent = state.searchLabel
    ? `${state.searchFailed ? '搜索未完成；以下为上一次搜索结果。原始条件：' : '结果条件：'}${state.searchLabel}`
    : state.searchFailed ? '搜索未完成，暂无已保存结果' : '你找到的好货，都会出现在这里';
  byId('result-summary').classList.toggle('stale-results', state.searchFailed && Boolean(state.searchLabel));
}

function searchFailed(error) {
  state.searchFailed = true;
  showMessage(error.message || '搜索未完成，请重试。');
  renderResultSummary();
}

function setBusy(value, buttonLabelId, idleLabel) {
  state.busy = value;
  byId('result-section').setAttribute('aria-busy', String(value));
  byId('loading-state').hidden = !value;
  resultsGrid.hidden = value || state.offers.length === 0;
  emptyState.hidden = value || state.offers.length > 0;
  exportButton.disabled = value || state.offers.length === 0;
  navItems.forEach((item) => { item.disabled = value; });
  document.querySelectorAll('[data-keyword], [data-result-view], #select-all, #empty-primary, #empty-secondary').forEach((item) => { item.disabled = value; });
  document.querySelectorAll('[data-image-mode]').forEach((item) => { item.disabled = value; });
  const button = buttonLabelId === 'keyword-button-label'
    ? document.querySelector('#keyword-form .primary-button')
    : document.querySelector('#image-form .primary-button');
  if (button) {
    button.disabled = value;
    button.classList.toggle('is-loading', value);
    button.setAttribute('aria-busy', String(value));
  }
  byId(buttonLabelId).textContent = value ? '正在查找…' : idleLabel;
  byId('compare-button').disabled = value || state.selected.size === 0 || state.selected.size > 5;
  validatePrices();
  updateLoginButton();
}

function showMessage(message, kind = 'error') {
  messageBox.textContent = message;
  messageBox.classList.toggle('info', kind === 'info');
  messageBox.hidden = false;
}

function clearMessage() {
  messageBox.hidden = true;
  messageBox.textContent = '';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function postJson(endpoint, payload) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('无法连接本地服务。请确认终端里的 1688 操作台仍在运行。');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || '请求失败，请重试。');
  return result;
}

async function refreshStatus() {
  const light = byId('status-light');
  const label = byId('status-text');
  label.textContent = '检查登录状态…';
  light.className = 'status-light';
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('服务状态暂时不可用。');
    const status = await response.json();
    byId('session-path').textContent = `当前会话：${status.sessionPath || '未知'}（默认 profile）`;
    state.serviceAvailable = true;
    state.connected = status.connected === true;
    state.connectionMessage = status.message || '';
    if (status.login?.running) state.loginRunning = true;
    if (status.connected) {
      label.textContent = status.daemonRunning ? '1688 会话已连接' : '1688 已登录';
      light.className = 'status-light connected';
    } else if (status.login?.running) {
      label.textContent = '等待扫码登录';
      light.className = 'status-light';
    } else {
      label.textContent = /验证|risk|slider/i.test(status.message ?? '') ? '1688 需要验证' : '1688 未登录';
      light.className = 'status-light disconnected';
    }
  } catch {
    state.serviceAvailable = false;
    state.connected = false;
    label.textContent = '本地服务未连接';
    light.className = 'status-light disconnected';
  }
  updateLoginButton();
}

function updateLoginButton() {
  const button = byId('login-button');
  if (!button) return;
  button.disabled = state.loginRunning || state.busy || !state.serviceAvailable;
  button.classList.toggle('running', state.loginRunning);
  button.textContent = state.loginRunning
    ? '等待扫码…'
    : state.connected ? '重新扫码登录' : '扫码登录';
  button.title = state.loginRunning
    ? '请在弹出的 1688 浏览器窗口扫码'
    : '打开 1688 登录窗口并扫码更新本机登录态';
  updateAccountNotice();
}

function updateAccountNotice() {
  const notice = byId('account-notice');
  notice.hidden = state.connected || state.loginRunning;
  notice.classList.toggle('offline', !state.serviceAvailable);
  byId('account-notice-title').textContent = !state.serviceAvailable
    ? '本地工作台连接已中断'
    : /验证|risk|slider/i.test(state.connectionMessage) ? '1688 会话需要验证' : '连接你的 1688 账号，开始找货';
  byId('account-notice-copy').textContent = !state.serviceAvailable
    ? '请启动本地工作台服务，再重试连接。'
    : state.connectionMessage || '扫码登录后，即可搜索商品、查看供应商并导出选品数据。';
  byId('notice-action-label').textContent = state.serviceAvailable ? '扫码连接' : '重试连接';
  byId('notice-login-button').disabled = state.busy || state.loginRunning;
  byId('local-badge').classList.toggle('offline', !state.serviceAvailable);
  byId('local-status-text').textContent = state.serviceAvailable ? '本地已连接' : '本地未连接';
  byId('sidebar-status-text').textContent = !state.serviceAvailable ? '本地服务未连接'
    : state.loginRunning ? '等待扫码登录' : state.connected ? '1688 会话已连接' : '等待连接 1688';
  byId('sidebar-status-dot').className = `status-light${state.connected ? ' connected' : state.loginRunning ? '' : ' disconnected'}`;
}

function scheduleLoginPoll() {
  if (state.loginPollTimer) return;
  state.loginPollTimer = setInterval(() => refreshLoginFlow(true), 1500);
}

function stopLoginPoll() {
  if (!state.loginPollTimer) return;
  clearInterval(state.loginPollTimer);
  state.loginPollTimer = null;
}

async function refreshLoginFlow(announce = false) {
  if (state.loginRequestActive) return;
  state.loginRequestActive = true;
  try {
    const response = await fetch('/api/login', { cache: 'no-store' });
    const flow = await response.json();
    if (!response.ok) throw new Error(flow.message || '读取扫码登录状态失败。');
    state.loginRunning = flow.running === true;
    updateLoginButton();
    byId('login-panel').hidden = !state.loginRunning;

    if (state.loginRunning) {
      byId('status-text').textContent = flow.state === 'starting' ? '正在打开登录…' : '等待扫码登录';
      byId('status-light').className = 'status-light';
      byId('login-flow-message').textContent = flow.message || '请在 1688 窗口完成扫码。';
      const hasQr = Boolean(flow.qrVersion);
      byId('login-qr-placeholder').hidden = hasQr;
      byId('login-qr').hidden = !hasQr;
      if (hasQr && flow.qrVersion !== state.loginQrVersion) {
        state.loginQrVersion = flow.qrVersion;
        byId('login-qr').src = `/api/login/qr?v=${flow.qrVersion}`;
      }
      if (announce) showMessage(flow.message || '请在弹出的 1688 窗口扫码登录。', 'info');
      scheduleLoginPoll();
      return;
    }

    stopLoginPoll();
    if (flow.state === 'succeeded') {
      await refreshStatus();
      if (announce) showMessage(flow.message || '1688 登录完成。', 'info');
    } else if (announce && ['failed', 'canceled'].includes(flow.state)) {
      await refreshStatus();
      showMessage(flow.message || '扫码登录没有完成，请重试。');
    }
  } catch (error) {
    if (announce) showMessage(error.message || '读取扫码登录状态失败。');
  } finally {
    state.loginRequestActive = false;
  }
}

async function startLoginFromPage() {
  if (state.loginRunning) return;
  const confirmed = window.confirm(
    '将打开 1688 登录窗口供你扫码。为确保重新扫码生效，会替换本机保存的 1688/Taobao 登录 Cookie。继续吗？',
  );
  if (!confirmed) return;

  state.loginRunning = true;
  state.loginQrVersion = null;
  updateLoginButton();
  byId('login-panel').hidden = false;
  byId('login-qr').hidden = true;
  byId('login-qr-placeholder').hidden = false;
  byId('login-flow-message').textContent = '正在准备扫码登录…';
  clearMessage();
  showMessage('正在打开 1688 登录窗口，请稍候…', 'info');
  try {
    await postJson('/api/login', {});
    await refreshLoginFlow(true);
    if (state.loginRunning) scheduleLoginPoll();
  } catch (error) {
    state.loginRunning = false;
    byId('login-panel').hidden = true;
    updateLoginButton();
    showMessage(error.message);
  }
}

function normalizeOffers(payload) {
  if (Array.isArray(payload?.offers)) return payload.offers;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.products)) return payload.products;
  return [];
}

function productPrice(offer) {
  const text = offer?.price?.text ?? offer?.priceText ?? '';
  if (text) return String(text);
  const min = offer?.price?.min ?? offer?.priceMin;
  const max = offer?.price?.max ?? offer?.priceMax;
  if (min == null && max == null) return '价格待查看';
  if (min != null && max != null && Number(min) !== Number(max)) return `${min}–${max}`;
  return String(min ?? max);
}

function productSales(offer) {
  const demand = offer?.demand ?? {};
  return demand.orderCountText ?? offer?.turnover ?? (demand.orderCount != null ? `${demand.orderCount} 单` : '暂无销量线索');
}

function salesSource(offer) {
  const field = offer.demand?.orderCountSource;
  if (field) return `1688 搜索响应 · ${field}`;
  if (offer.turnover != null) return '1688 搜索响应 · bookedCount（turnover）';
  return '上游未提供来源字段';
}

function productSupplier(offer) {
  const supplier = offer?.supplier?.name ?? offer?.supplierName ?? '供应商信息待查看';
  const city = offer?.location?.city ?? offer?.location?.province ?? '';
  return city ? `${supplier} · ${city}` : supplier;
}

function productUrl(offer) {
  const supplied = safeHttpsUrl(offer?.url, ['1688.com']);
  if (supplied) return supplied;
  const id = String(offer?.offerId ?? '').replace(/\D/g, '');
  return id ? `https://detail.1688.com/offer/${encodeURIComponent(id)}.html` : '';
}

function renderCard(offer, index) {
  const image = safeHttpsUrl(offer?.image ?? offer?.imageUrl);
  const title = offer?.title ?? offer?.subject ?? '未提供商品标题';
  const id = offer?.offerId ?? offer?.id ?? '';
  const url = productUrl(offer);
  const verified = [
    offer?.verified?.superFactory && '超级工厂线索（superFactory）',
    offer?.verified?.factory && '验厂线索（factoryInspection）',
    offer?.verified?.business && '验商线索（businessInspection）',
  ].filter(Boolean).join(' · ');
  const imageMarkup = image
    ? `<img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer">`
    : '<span class="image-fallback" aria-label="暂无商品图片"><svg class="icon"><use href="#i-image"/></svg></span>';
  const priceText = productPrice(offer).replace(/^[¥￥]\s*/, '');
  const priceMarkup = /\d/.test(priceText) ? `<small>¥</small>${escapeHtml(priceText)}` : escapeHtml(priceText);
  const salesLabel = escapeHtml(productSales(offer));
  return `<article class="product-card${state.selected.has(index) ? ' selected' : ''}">
    <div class="product-image-wrap">
      ${url ? `<a class="product-image-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="查看商品：${escapeHtml(title)}">${imageMarkup}</a>` : imageMarkup}
      <label class="select-product" title="选择导出"><input type="checkbox" data-select-index="${index}" aria-label="选择导出商品 ${index + 1}" ${state.selected.has(index) ? 'checked' : ''}></label>
      ${verified ? `<span class="product-badge" title="1688 搜索响应标识；资质和有效期请到店铺核验">${escapeHtml(verified)}</span>` : ''}
    </div>
    <div class="product-content">
      <h3 class="product-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
      <div class="product-supplier"><span class="supplier-dot"></span><span>${escapeHtml(productSupplier(offer))}</span></div>
      <div class="product-metrics">
        <span class="product-price">${priceMarkup}</span>
        <span class="product-sales" title="${escapeHtml(salesSource(offer))}；周期：${escapeHtml(offer.demand?.orderCountPeriod || '上游未提供')}；不等同于售出件数">销量线索&nbsp; ${salesLabel}</span>
      </div>
      <button class="text-button detail-button" type="button" data-detail-index="${index}">查看起订量 / SKU / 阶梯价</button>
      <div class="product-footer">
        <span class="product-id">${id ? `ID ${escapeHtml(id)}` : '1688 商品'}</span>
        ${url ? `<a class="open-product" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">查看货源<svg class="icon"><use href="#i-external"/></svg></a>` : '<span class="product-id">暂无商品链接</span>'}
      </div>
    </div>
  </article>`;
}

function renderResults() {
  const offers = state.offers;
  const total = offers.length;
  byId('result-count').textContent = String(total);
  resultsGrid.hidden = state.busy || total === 0;
  emptyState.hidden = state.busy || total > 0;
  exportButton.disabled = state.busy || total === 0;
  byId('selection-tools').hidden = total === 0;
  if (total) {
    resultsGrid.innerHTML = offers.map(renderCard).join('');
    renderResultSummary();
    resultsGrid.querySelectorAll('[data-detail-index]').forEach((button) => {
      button.disabled = state.busy;
      button.addEventListener('click', () => loadDetails([offers[Number(button.dataset.detailIndex)]]));
    });
    resultsGrid.querySelectorAll('[data-select-index]').forEach((input) => {
      input.addEventListener('change', () => {
        const index = Number(input.dataset.selectIndex);
        if (input.checked) state.selected.add(index);
        else state.selected.delete(index);
        updateSelectionUi();
      });
    });
    resultsGrid.querySelectorAll('.product-image').forEach((image) => {
      image.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'image-fallback';
        fallback.setAttribute('aria-label', '图片加载失败');
        fallback.innerHTML = '<svg class="icon"><use href="#i-image"/></svg>';
        image.replaceWith(fallback);
      }, { once: true });
    });
  }
  updateSelectionUi();
}

function updateSelectionUi() {
  const total = state.offers.length;
  const count = state.selected.size;
  byId('selection-summary').textContent = `已选 ${count} 件`;
  byId('select-all').checked = total > 0 && count === total;
  byId('select-all').indeterminate = count > 0 && count < total;
  byId('export-label').textContent = count ? `导出已选 Excel (${count}，含图片)` : '导出 Excel（含图片）';
  byId('compare-button').disabled = state.busy || count === 0 || count > 5;
  resultsGrid.querySelectorAll('[data-select-index]').forEach((input) => {
    const selected = state.selected.has(Number(input.dataset.selectIndex));
    input.checked = selected;
    input.closest('.product-card').classList.toggle('selected', selected);
  });
}

function setResultView(view) {
  state.resultView = view === 'list' ? 'list' : 'grid';
  resultsGrid.classList.toggle('list-view', state.resultView === 'list');
  document.querySelectorAll('[data-result-view]').forEach((button) => {
    const active = button.dataset.resultView === state.resultView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function handlePayload(payload, label, requestedMax = 0) {
  const offers = normalizeOffers(payload);
  state.offers = offers;
  state.selected.clear();
  state.searchLabel = label;
  state.searchFailed = false;
  byId('comparison-panel').hidden = true;
  if (!offers.length) {
    byId('empty-title').textContent = '暂时没有匹配结果';
    byId('empty-copy').textContent = '换个关键词或图片再试试。';
    byId('empty-source').textContent = '结果来自 1688 实时搜索';
    showMessage(payload?.message || '1688 没有返回商品结果。', 'info');
  } else {
    const total = Number(payload.total);
    if (Number.isFinite(total) && total > offers.length) {
      showMessage(`当前展示 ${offers.length} 件，本次搜索共返回 ${total} 件。`, 'info');
    } else if (offers.length < requestedMax) {
      const reasons = {
        next_page_unavailable: '未找到可用的下一页按钮',
        next_page_failed: '下一页按钮点击失败',
        capture_timeout: '下一页商品读取超时',
        no_new_offers: '后续页面未返回新的商品',
        end_of_results: '已读取到平台最后一页',
        page_limit: '已达到本次翻页上限',
      };
      const pagination = payload.pagination;
      const reason = reasons[pagination?.stopReason];
      showMessage(reason
        ? `已返回 ${offers.length} 件（最多 ${requestedMax} 件），已读取 ${pagination.pagesFetched} 页。停止原因：${reason}。`
        : `已返回 ${offers.length} 件，少于本次设置的最多 ${requestedMax} 件；实际数量以平台返回、筛选及翻页情况为准。`, 'info');
    } else {
      clearMessage();
    }
    byId('empty-title').textContent = modeContent[state.mode].emptyTitle;
    byId('empty-copy').textContent = modeContent[state.mode].emptyCopy;
    byId('empty-source').textContent = '商品数据来自 1688 实时搜索';
  }
  renderResults();
}

byId('keyword-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const keyword = byId('keyword-input').value.trim();
  if (!keyword) return byId('keyword-input').focus();
  if (!validatePrices()) return;
  const filters = readKeywordFilters();
  if (state.mode === 'bestseller') filters.sort = 'best-selling';
  const label = `${keywordSearchLabel(filters)} · 搜索时间 ${new Date().toLocaleString('zh-CN')}`;
  clearMessage();
  setBusy(true, 'keyword-button-label', state.mode === 'bestseller' ? '查看畅销结果' : '搜索货源');
  byId('result-summary').textContent = '正在连接 1688 搜索…';
  try {
    const payload = await postJson('/api/search', filters);
    handlePayload(payload, label, filters.max);
  } catch (error) {
    searchFailed(error);
  } finally {
    setBusy(false, 'keyword-button-label', state.mode === 'bestseller' ? '查看畅销结果' : '搜索货源');
  }
});

byId('image-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const payload = { max: Number(byId('image-max').value) };
  let label = '';
  let sourceFile;
  if (state.imageMode === 'file') {
    if (!state.file) {
      showMessage('请先选择一张商品图片。', 'info');
      return;
    }
    if (state.file.size > 8 * 1024 * 1024) {
      showMessage('图片不能超过 8 MB。');
      return;
    }
    sourceFile = state.file;
    label = `图片搜索 · ${state.file.name}`;
  } else {
    const imageUrl = byId('image-url').value.trim();
    if (!imageUrl) {
      byId('image-url').focus();
      showMessage('请粘贴一条公开的 HTTPS 图片链接。', 'info');
      return;
    }
    payload.imageUrl = imageUrl;
    label = `图片搜索 · ${imageUrl}`;
  }
  clearMessage();
  setBusy(true, 'image-button-label', '以图找同款');
  byId('result-summary').textContent = '正在识别图片并搜索…';
  try {
    if (sourceFile) payload.imageData = await readAsDataUrl(sourceFile);
    const result = await postJson('/api/image-search', payload);
    handlePayload(result, `${label} · 最多 ${payload.max} 件 · 搜索时间 ${new Date().toLocaleString('zh-CN')}`, payload.max);
  } catch (error) {
    searchFailed(error);
  } finally {
    setBusy(false, 'image-button-label', '以图找同款');
  }
});

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

function setFile(file) {
  if (!file) return false;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    showMessage('图片格式需为 JPEG、PNG 或 WebP。');
    return false;
  }
  if (file.size > 8 * 1024 * 1024) {
    showMessage('图片不能超过 8 MB。');
    return false;
  }
  clearMessage();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = file;
  state.previewUrl = URL.createObjectURL(file);
  byId('upload-preview').src = state.previewUrl;
  byId('upload-preview').hidden = false;
  byId('upload-title').textContent = file.name;
  byId('upload-caption').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · 点击可更换`;
  return true;
}

byId('choose-image').addEventListener('click', () => byId('image-file').click());
byId('upload-preview').addEventListener('click', () => byId('image-file').click());
byId('image-file').addEventListener('change', () => setFile(byId('image-file').files?.[0]));

const uploadZone = byId('file-source');
uploadZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (event) => {
  event.preventDefault();
  uploadZone.classList.remove('drag-over');
  setFile(event.dataTransfer.files?.[0]);
});

document.addEventListener('paste', (event) => {
  if (state.mode !== 'image' || state.imageMode !== 'file' || uploadZone.hidden || state.busy) return;
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const item = Array.from(clipboard.items ?? []).find((entry) => entry.kind === 'file' && entry.type.startsWith('image/'));
  const file = item?.getAsFile() ?? Array.from(clipboard.files ?? []).find((entry) => entry.type.startsWith('image/'));
  if (!file) return;

  event.preventDefault();
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1] || 'img';
  const pastedFile = file.name
    ? file
    : new File([file], `剪贴板图片.${extension}`, { type: file.type, lastModified: Date.now() });
  if (setFile(pastedFile)) showToast('图片已粘贴，可以点击“以图找同款”开始搜索。');
});

document.querySelectorAll('[data-image-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.imageMode = button.dataset.imageMode;
    document.querySelectorAll('[data-image-mode]').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-image-mode]').forEach((item) => {
      item.setAttribute('aria-selected', String(item === button));
      item.tabIndex = item === button ? 0 : -1;
    });
    byId('file-source').hidden = state.imageMode !== 'file';
    byId('url-source').hidden = state.imageMode !== 'url';
    clearMessage();
  });
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-image-mode]')];
    const index = tabs.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].click();
    tabs[next].focus();
  });
});

navItems.forEach((item) => item.addEventListener('click', () => setMode(item.dataset.mode)));
byId('refresh-status').addEventListener('click', refreshStatus);
byId('login-button').addEventListener('click', startLoginFromPage);
byId('notice-login-button').addEventListener('click', () => state.serviceAvailable ? startLoginFromPage() : refreshStatus());
document.querySelectorAll('[data-keyword]').forEach((button) => button.addEventListener('click', () => {
  byId('keyword-input').value = button.dataset.keyword;
  byId('keyword-input').focus();
}));
document.querySelectorAll('[data-result-view]').forEach((button) => button.addEventListener('click', () => setResultView(button.dataset.resultView)));
byId('select-all').addEventListener('change', (event) => {
  state.selected.clear();
  if (event.target.checked) state.offers.forEach((_, index) => state.selected.add(index));
  updateSelectionUi();
});
byId('empty-primary').addEventListener('click', () => {
  if (state.mode === 'image') byId('image-file').click();
  else {
    byId('keyword-input').focus();
    byId('keyword-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
byId('empty-secondary').addEventListener('click', () => setMode(state.mode === 'image' ? 'keyword' : 'image'));

async function loadDetails(offers) {
  if (state.busy || offers.length < 1 || offers.length > 5) return;
  const ids = offers.map((offer) => String(offer.offerId ?? offer.id ?? ''));
  const labelId = state.mode === 'image' ? 'image-button-label' : 'keyword-button-label';
  const idle = state.mode === 'image' ? '以图找同款' : state.mode === 'bestseller' ? '查看畅销结果' : '搜索货源';
  setBusy(true, labelId, idle);
  clearMessage();
  try {
    const payload = await postJson('/api/offer-details', { offerIds: ids });
    const details = payload.mode === 'batch' ? payload.offers : [payload];
    ids.forEach((id) => { state.details.delete(id); state.failures.delete(id); });
    details.forEach((detail) => state.details.set(detail.offerId, detail));
    (payload.failures ?? []).forEach((failure) => state.failures.set(failure.offerId, failure.message));
    renderComparison(offers);
  } catch (error) {
    showMessage(error.message || '采购信息获取失败。');
    byId('comparison-panel').hidden = true;
  } finally {
    setBusy(false, labelId, idle);
  }
}

function renderComparison(offers) {
  const panel = byId('comparison-panel');
  const rows = offers.map((offer) => {
    const id = String(offer.offerId ?? offer.id ?? '');
    const detail = state.details.get(id);
    const unit = detail?.unitName ?? '（单位未提供）';
    const qty = detail?.minOrderQty == null ? '未提供' : `${detail.minOrderQty} ${unit}`;
    const tiers = detail?.priceTiers?.length ? detail.priceTiers.map((tier) => `${tier.minQty} ${unit}起：¥${tier.price}`).join('；') : '未提供';
    const skus = detail?.skus?.length ? `<details><summary>${detail.skus.length} 个 SKU（展开）</summary><ul>${detail.skus.map((sku) => `<li>${escapeHtml(sku.specs || sku.skuId)}：${sku.price == null ? '价格未提供' : `¥${escapeHtml(sku.price)}`}；库存 ${escapeHtml(sku.stock ?? '未提供')}</li>`).join('')}</ul></details>` : '未提供';
    const error = state.failures.get(id) || '详情未返回';
    return `<tr><th scope="row">${escapeHtml(detail?.title || offer.title || id)}<br><small>ID ${escapeHtml(id)}</small></th>${detail ? `<td>${escapeHtml(qty)}</td><td>${escapeHtml(detail.mixOrderQty ?? '未提供')}</td><td>${escapeHtml(tiers)}</td><td>${skus}</td>` : `<td colspan="4">${escapeHtml(error)}</td>`}</tr>`;
  });
  panel.innerHTML = `<h3>采购信息比较</h3><p>来自本次 1688 商品详情；未提供的字段不作推断，成交价和库存以商品页面为准。</p><div class="comparison-scroll"><table><thead><tr><th>商品</th><th>起订量</th><th>混批起订量</th><th>阶梯价</th><th>SKU / 价格 / 库存</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  panel.hidden = false;
}

byId('compare-button').addEventListener('click', () => loadDetails(state.offers.filter((_, index) => state.selected.has(index))));
['price-min', 'price-max'].forEach((id) => byId(id).addEventListener('input', validatePrices));

exportButton.addEventListener('click', async () => {
  if (exportButton.disabled) return;
  const picked = state.selected.size
    ? state.offers.filter((_, index) => state.selected.has(index))
    : state.offers;
  const source = `${state.searchFailed ? '上一次成功搜索的结果；最近一次搜索未完成。' : ''}${state.searchLabel}`;
  const rows = picked.map((offer) => [
    offer.offerId ?? offer.id ?? '',
    offer.title ?? offer.subject ?? '',
    productPrice(offer),
    offer.supplier?.name ?? offer.supplierName ?? '',
    offer.location?.province ?? '',
    offer.location?.city ?? '',
    productSales(offer),
    offer.demand?.repurchaseRateText ?? offer.demand?.repurchaseRate ?? '',
    offer.image ?? offer.imageUrl ?? '',
    productUrl(offer),
    salesSource(offer),
    offer.demand?.orderCountPeriod || '上游未提供统计周期',
  ]);
  {
    clearMessage();
    exportButton.disabled = true;
    byId('export-label').textContent = '正在导出…';
    try {
      // Static assets are read from disk, while the API stays loaded in the
      // running process. Detect an old server before sending the newer rows.
      const healthResponse = await fetch('/api/health', { cache: 'no-store' });
      if (!healthResponse.ok) throw new Error('本地服务暂时不可用，请确认操作台仍在运行后重试。');
      const health = await healthResponse.json();
      if (health.exportSchemaVersion !== 2) {
        throw new Error('工作台服务版本过旧。请在终端停止并重新运行 pnpm ui，再点击导出；当前结果和勾选会保留。');
      }
      const response = await fetch('/api/export-products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 2, rows: rows.map((row) => ['', ...row].map((value) => String(value ?? ''))), source }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || '导出失败，请重试。');
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `1688-products-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      const missing = Number(response.headers.get('x-missing-images')) || 0;
      showToast(missing ? `已导出 ${picked.length} 件商品，其中 ${missing} 张图片加载失败。` : `已导出 ${picked.length} 件商品。`);
    } catch (error) {
      showMessage(error.message || '导出失败，请重试。');
    } finally {
      exportButton.disabled = state.busy || !state.offers.length;
      updateSelectionUi();
    }
    return;
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (state.busy) return;
    setMode('keyword');
    byId('keyword-input').focus();
  }
});

setMode('keyword');
refreshStatus();
refreshLoginFlow();
