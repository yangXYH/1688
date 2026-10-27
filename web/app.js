const state = {
  mode: 'keyword',
  imageMode: 'file',
  offers: [],
  selected: new Set(),
  file: null,
  previewUrl: null,
  busy: false,
  searchLabel: '',
  toastTimer: null,
  loginPollTimer: null,
  loginRequestActive: false,
  loginRunning: false,
  connected: false,
  serviceAvailable: true,
  loginQrVersion: null,
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
    title: '发现好货，从一个关键词开始',
    subtitle: '搜索 1688 商品，查看价格、供应商与销量线索。',
    result: '商品结果',
    kicker: 'SEARCH RESULTS',
    emptyTitle: '开始一次商品搜索',
    emptyCopy: '输入关键词，或切换到图片找同款，结果会显示在这里。',
  },
  image: {
    crumb: '图片找同款',
    title: '让图片帮你发现相似货源',
    subtitle: '上传商品图或粘贴图片链接，在 1688 上查找相似商品。',
    result: '相似商品',
    kicker: 'IMAGE MATCHES',
    emptyTitle: '上传一张商品图片',
    emptyCopy: '选择本地图片或粘贴公开图片地址，开始以图找货。',
  },
  bestseller: {
    crumb: '畅销排序',
    title: '看看哪些商品更受欢迎',
    subtitle: '输入一个关键词，按 1688 搜索结果的畅销顺序浏览。',
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
  if (!modeContent[mode]) return;
  state.mode = mode;
  state.offers = [];
  state.selected.clear();
  clearMessage();
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
  byId('keyword-button-label').textContent = mode === 'bestseller' ? '查看畅销结果' : '开始搜索';
  byId('sort-select').value = mode === 'bestseller' ? 'best-selling' : 'relevance';
  byId('sort-select').disabled = mode === 'bestseller';
  byId('sort-note').textContent = mode === 'bestseller'
    ? '按关键词搜索结果畅销顺序排列；非官方类目榜单'
    : '搜索结果可按价格或畅销程度排序';
  byId('result-summary').textContent = isImage ? '支持本地图片或公开图片链接' : '搜索后会在这里展示商品卡片';
}

function setBusy(value, buttonLabelId, idleLabel) {
  state.busy = value;
  navItems.forEach((item) => { item.disabled = value; });
  document.querySelectorAll('[data-image-mode]').forEach((item) => { item.disabled = value; });
  const button = buttonLabelId === 'keyword-button-label'
    ? document.querySelector('#keyword-form .primary-button')
    : document.querySelector('#image-form .primary-button');
  if (button) button.disabled = value;
  byId(buttonLabelId).textContent = value ? '正在查找…' : idleLabel;
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
    const status = await response.json();
    state.serviceAvailable = true;
    state.connected = status.connected === true;
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
      if (status.message) showMessage(status.message);
    }
  } catch {
    state.serviceAvailable = false;
    label.textContent = '本地服务未连接';
    light.className = 'status-light disconnected';
  }
  updateLoginButton();
}

function updateLoginButton() {
  const button = byId('login-button');
  if (!button) return;
  button.disabled = state.loginRunning || !state.serviceAvailable;
  button.classList.toggle('running', state.loginRunning);
  button.textContent = state.loginRunning
    ? '等待扫码…'
    : state.connected ? '重新扫码登录' : '扫码登录';
  button.title = state.loginRunning
    ? '请在弹出的 1688 浏览器窗口扫码'
    : '打开 1688 登录窗口并扫码更新本机登录态';
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
  const verified = offer?.verified?.superFactory ? '超级工厂'
    : offer?.verified?.factory ? '实力工厂'
      : offer?.verified?.business ? '诚信通商家' : '';
  const imageMarkup = image
    ? `<img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer">`
    : '<span class="image-fallback" aria-label="暂无商品图片">▧</span>';
  const salesLabel = escapeHtml(productSales(offer));
  return `<article class="product-card">
    <div class="product-image-wrap">
      ${imageMarkup}
      <label class="select-product" title="选择导出"><input type="checkbox" data-select-index="${index}" aria-label="选择导出商品 ${index + 1}" ${state.selected.has(index) ? 'checked' : ''}></label>
      ${verified ? `<span class="product-badge">${escapeHtml(verified)}</span>` : ''}
    </div>
    <div class="product-content">
      <h3 class="product-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
      <div class="product-supplier"><span class="supplier-dot"></span><span>${escapeHtml(productSupplier(offer))}</span></div>
      <div class="product-metrics">
        <span class="product-price">${escapeHtml(productPrice(offer))}<small>¥</small></span>
        <span class="product-sales">销量线索&nbsp; ${salesLabel}</span>
      </div>
      <div class="product-footer">
        <span class="product-id">${id ? `ID ${escapeHtml(id)}` : '1688 商品'}</span>
        ${url ? `<a class="open-product" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">查看商品 <span aria-hidden="true">↗</span></a>` : '<span class="product-id">暂无商品链接</span>'}
      </div>
    </div>
  </article>`;
}

function renderResults() {
  const offers = state.offers;
  const total = offers.length;
  byId('result-count').textContent = total ? String(total) : '';
  resultsGrid.hidden = total === 0;
  emptyState.hidden = total > 0;
  exportButton.disabled = total === 0;
  if (total) {
    resultsGrid.innerHTML = offers.map(renderCard).join('');
    byId('result-summary').textContent = state.searchLabel || `已获取 ${total} 件商品`;
    resultsGrid.querySelectorAll('[data-select-index]').forEach((input) => {
      input.addEventListener('change', () => {
        const index = Number(input.dataset.selectIndex);
        if (input.checked) state.selected.add(index);
        else state.selected.delete(index);
      });
    });
    resultsGrid.querySelectorAll('.product-image').forEach((image) => {
      image.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'image-fallback';
        fallback.setAttribute('aria-label', '图片加载失败');
        fallback.textContent = '▧';
        image.replaceWith(fallback);
      }, { once: true });
    });
  }
}

function handlePayload(payload, label) {
  const offers = normalizeOffers(payload);
  state.offers = offers;
  state.selected.clear();
  state.searchLabel = label;
  if (!offers.length) {
    byId('empty-title').textContent = '暂时没有匹配结果';
    byId('empty-copy').textContent = '换个关键词或图片再试试。';
    byId('empty-source').textContent = '结果来自 1688 实时搜索';
    showMessage(payload?.message || '1688 没有返回商品结果。', 'info');
  } else {
    const total = Number(payload.total);
    if (Number.isFinite(total) && total > offers.length) {
      showMessage(`当前展示 ${offers.length} 件，本次搜索共返回 ${total} 件。`, 'info');
    } else {
      clearMessage();
    }
    byId('empty-title').textContent = modeContent[state.mode].emptyTitle;
    byId('empty-copy').textContent = modeContent[state.mode].emptyCopy;
    byId('empty-source').textContent = '仅展示 1688 实时返回的数据，不填充示例商品';
  }
  renderResults();
}

byId('keyword-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const keyword = byId('keyword-input').value.trim();
  if (!keyword) return byId('keyword-input').focus();
  clearMessage();
  setBusy(true, 'keyword-button-label', state.mode === 'bestseller' ? '查看畅销结果' : '开始搜索');
  byId('result-summary').textContent = '正在连接 1688 搜索…';
  try {
    const payload = await postJson('/api/search', {
      keyword,
      sort: state.mode === 'bestseller' ? 'best-selling' : byId('sort-select').value,
      max: Number(byId('max-select').value),
      priceMin: byId('price-min').value,
      priceMax: byId('price-max').value,
      excludeAds: byId('exclude-ads').checked,
    });
    handlePayload(payload, `关键词「${keyword}」 · ${byId('sort-select').selectedOptions[0].textContent}`);
  } catch (error) {
    showMessage(error.message);
    byId('result-summary').textContent = '搜索未完成';
  } finally {
    setBusy(false, 'keyword-button-label', state.mode === 'bestseller' ? '查看畅销结果' : '开始搜索');
  }
});

byId('image-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const payload = { max: Number(byId('image-max').value) };
  let label = '';
  if (state.imageMode === 'file') {
    if (!state.file) {
      showMessage('请先选择一张商品图片。', 'info');
      return;
    }
    if (state.file.size > 8 * 1024 * 1024) {
      showMessage('图片不能超过 8 MB。');
      return;
    }
    payload.imageData = await readAsDataUrl(state.file);
    label = `图片搜索 · ${state.file.name}`;
  } else {
    const imageUrl = byId('image-url').value.trim();
    if (!imageUrl) {
      byId('image-url').focus();
      showMessage('请粘贴一条公开的 HTTPS 图片链接。', 'info');
      return;
    }
    payload.imageUrl = imageUrl;
    label = '图片搜索 · 图片链接';
  }
  clearMessage();
  setBusy(true, 'image-button-label', '以图找同款');
  byId('result-summary').textContent = '正在识别图片并搜索…';
  try {
    const result = await postJson('/api/image-search', payload);
    handlePayload(result, label);
  } catch (error) {
    showMessage(error.message);
    byId('result-summary').textContent = '图片搜索未完成';
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
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    showMessage('图片格式需为 JPEG、PNG 或 WebP。');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showMessage('图片不能超过 8 MB。');
    return;
  }
  clearMessage();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = file;
  state.previewUrl = URL.createObjectURL(file);
  byId('upload-preview').src = state.previewUrl;
  byId('upload-preview').hidden = false;
  byId('upload-title').textContent = file.name;
  byId('upload-caption').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · 点击可更换`;
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

document.querySelectorAll('[data-image-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.imageMode = button.dataset.imageMode;
    document.querySelectorAll('[data-image-mode]').forEach((item) => item.classList.toggle('active', item === button));
    byId('file-source').hidden = state.imageMode !== 'file';
    byId('url-source').hidden = state.imageMode !== 'url';
    clearMessage();
  });
});

navItems.forEach((item) => item.addEventListener('click', () => setMode(item.dataset.mode)));
byId('refresh-status').addEventListener('click', refreshStatus);
byId('login-button').addEventListener('click', startLoginFromPage);

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

exportButton.addEventListener('click', () => {
  const picked = state.selected.size
    ? state.offers.filter((_, index) => state.selected.has(index))
    : state.offers;
  const header = ['offerId', 'title', 'price', 'supplier', 'province', 'city', 'salesSignal', 'repurchaseRate', 'imageUrl', 'productUrl'];
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
  ]);
  const csv = `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = href;
  link.download = `1688-products-${date}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  showToast(`已导出 ${picked.length} 件商品；CSV 包含主图链接。`);
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setMode('keyword');
    byId('keyword-input').focus();
  }
});

setMode('keyword');
refreshStatus();
refreshLoginFlow();
