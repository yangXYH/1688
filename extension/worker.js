const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let base = 'http://127.0.0.1:4173', token = null, loginId = '', panel = null, pulsing = false, stopped = true;
let tabs = {}, journal = {}, search = null, scope = [];
const active = new Map(), manual = new Set();
const init = (async () => {
  const local = await chrome.storage.local.get(['tabs', 'journal', 'port', 'search', 'scope']);
  const session = await chrome.storage.session.get(['token', 'loginId']);
  tabs = local.tabs ?? {}; journal = local.journal ?? {}; search = local.search ?? null; scope = local.scope ?? [];
  base = `http://127.0.0.1:${local.port || 4173}`; token = session.token ?? null; loginId = session.loginId ?? '';
})();
const fault = (message, code = 'EXTENSION_ERROR', exitCode = 9, safeNotSent = true) => Object.assign(new Error(message), { code, exitCode, safeNotSent });
async function api(route, body = {}, connect = false) {
  const response = await fetch(`${base}/api/extension/${route}`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...(!connect && token ? { 'x-1688-bridge': token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw fault(data.message || `本地服务 HTTP ${response.status}`, 'BRIDGE_ERROR');
  return data;
}
async function frameCall(tabId, frameId, payload) {
  let result;
  try { result = await chrome.tabs.sendMessage(tabId, payload, { frameId }); }
  catch (e) { if (payload.kind === 'SEND') e.safeNotSent = false; throw e; }
  if (!result?.ok) throw Object.assign(new Error(result?.error?.message || '页面尚未准备好。'), result?.error ?? {});
  return result.data;
}
async function frames(tabId) {
  return chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => ({ href: location.href, hasEditor: !!document.querySelector('pre.edit[contenteditable="true"]') }) });
}
async function assign(tabId, jobId) {
  for (const frame of await frames(tabId)) await frameCall(tabId, frame.frameId, { kind: 'ASSIGN', jobId, manual: manual.has(jobId) }).catch(() => {});
}
async function cancel(jobId, mark = true) {
  if (mark) manual.add(jobId);
  const tab = tabs[jobId];
  if (tab) for (const frame of await frames(tab.id).catch(() => [])) await frameCall(tab.id, frame.frameId, { kind: 'CANCEL' }).catch(() => {});
}
async function readyTab(tabId) {
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (/login\.(taobao|1688)\.com/.test(tab.url ?? '')) throw fault('请先在当前 Chrome 登录 1688。', 'NOT_LOGGED_IN', 3);
    if (tab.status === 'complete') return tab;
    await sleep(250);
  }
  throw fault('页面加载超时，请手动检查当前标签页。');
}
async function visibleTab(url) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await sleep(150);
  return await chrome.tabs.update(tab.id, { url, active: true });
}
async function sellerFromProduct(tabId, offerId) {
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline) {
    const binding=Object.entries(tabs).find(([,v])=>v.id===tabId);
    if (binding && manual.has(binding[0])) throw fault('此页已由你接管。','MANUAL_TAKEOVER');
    await frameCall(tabId, 0, { kind: 'META' });
    const [data] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (expected) => {
      if (!location.pathname.includes(`/offer/${expected}.html`)) return null;
      const f = window.FE_GLOBALS ?? {}, context = window.context?.result?.data;
      const identity = f.offerLoginId || (context && f.loginId);
      return identity ? String(identity) : null;
    }, args: [offerId] });
    if (data?.result) return data.result;
    await sleep(500);
  }
  throw fault('商品页没有识别出旺旺卖家账号，请手动查看商品客服。', 'SELLER_UNKNOWN');
}
const imUrl = (seller, offer) => `https://air.1688.com/app/ocms-fusion-components-1688/def_cbu_web_im/index.html?touid=cnalichn${encodeURIComponent(seller)}&siteid=cnalichn&status=1&portalId=&gid=&offerId=${offer}&itemsId=&orderId=#/`;
async function conversation(task) {
  if (manual.has(task.jobId)) throw fault('你已接管此会话。', 'MANUAL_TAKEOVER');
  let stored = tabs[task.jobId], tab = stored && await chrome.tabs.get(stored.id).catch(() => null);
  let seller = task.sellerLoginId || stored?.seller;
  if (!tab) {
    tab = await chrome.tabs.create({ url:'about:blank', active:true });
    stored = tabs[task.jobId] = { id:tab.id, seller, offerId:task.offerId }; await chrome.storage.local.set({tabs});
    await sleep(150);
    await chrome.tabs.update(tab.id,{url:seller?imUrl(seller,task.offerId):`https://detail.1688.com/offer/${task.offerId}.html`,active:true});
    await readyTab(tab.id);
    if (!seller) { seller = await sellerFromProduct(tab.id, task.offerId); if(manual.has(task.jobId))throw fault('此页已由你接管。','MANUAL_TAKEOVER'); await chrome.tabs.update(tab.id, { url: imUrl(seller, task.offerId), active: true }); await readyTab(tab.id); }
    stored = tabs[task.jobId] = { id: tab.id, seller, offerId: task.offerId };
    await chrome.storage.local.set({ tabs });
  } else {
    const url = new URL(tab.url);
    if (!url.hostname.endsWith('.1688.com') || url.searchParams.get('touid') !== `cnalichn${seller}`) { await cancel(task.jobId); throw fault('你已切换了此标签页，请手动接管或重新打开会话。', 'MANUAL_TAKEOVER'); }
  }
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline) {
    if (manual.has(task.jobId)) throw fault('你已接管此会话。', 'MANUAL_TAKEOVER');
    const meta = await frameCall(tab.id, 0, { kind: 'META' });
    const available = await frames(tab.id), core = available.find((f) => f.result?.hasEditor);
    if (meta.text.includes(loginId) && core) {
      const inner = await frameCall(tab.id, core.frameId, { kind: 'META' });
      if (inner.active) { await assign(tab.id, task.jobId); return { tabId: tab.id, frameId: core.frameId, seller }; }
    }
    await sleep(500);
  }
  throw fault('无法确认旺旺当前买家账号或会话。请核对页面顶部账号与插件账号一致。', 'IDENTITY_MISMATCH', 3);
}
async function read(task) {
  const target = await conversation(task);
  // Refresh only the existing read-history request; never reload a user's chat or draft.
  const [refresh] = await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [target.frameId] }, world: 'MAIN', func: () => {
    const capture = window.__C1688_CAPTURE__;
    const previous = capture?.histories?.at(-1)?.at ?? 0;
    return { previous, requested: !!capture?.refresh?.() };
  } });
  const deadline = Date.now() + 10000;
  while (refresh?.result?.requested && Date.now() < deadline) {
    if (manual.has(task.jobId)) throw fault('你已接管此会话。', 'MANUAL_TAKEOVER');
    const captured = await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [target.frameId] }, world: 'MAIN', func: () => window.__C1688_CAPTURE__?.histories?.at(-1) ?? null });
    if (captured[0]?.result?.at > refresh.result.previous) return { sellerLoginId: target.seller, models: captured[0].result.models };
    await sleep(300);
  }
  if (refresh?.result?.requested) throw fault('会话历史同步超时，请手动检查旺旺；页面和草稿已保留。', 'HISTORY_TIMEOUT');
  const result = await frameCall(target.tabId, target.frameId, { kind: 'SNAPSHOT' });
  return { sellerLoginId: target.seller, messages: result.messages };
}
let sendChain = Promise.resolve();
async function send(task) {
  const prior = sendChain; let release;
  sendChain = new Promise((r) => { release = r; });
  await prior;
  try {
    const target = await conversation(task);
    await chrome.tabs.update(target.tabId, { active: true });
    if (task.initial) {
      await frameCall(target.tabId, target.frameId, { kind: 'SEND', operationId: task.id, text: `https://detail.1688.com/offer/${task.offerId}.html` });
      await sleep(1500);
    }
    try { await frameCall(target.tabId, target.frameId, { kind: 'SEND', operationId: task.id, text: task.text }); }
    catch (e) { if (task.initial) e.safeNotSent = false; throw e; }
    return { ok: true, sentTo: target.seller, sentAt: new Date().toISOString() };
  } finally { release(); }
}
async function execute(task) {
  let result;
  const previous = journal[task.id];
  if (previous) result = previous.status === 'done' && previous.result ? previous.result : { ok: false, error: { code: 'SEND_UNCONFIRMED', message: '插件曾执行此操作，禁止重复发送，请核对真实会话。', safeNotSent: false } };
  else {
    journal[task.id] = { status: 'started', at: Date.now() };
    const entries = Object.entries(journal).slice(-100); journal = Object.fromEntries(entries);
    await chrome.storage.local.set({ journal });
    try {
      if (stopped || !panel || manual.has(task.jobId)) throw fault('当前已暂停。', 'MANUAL_TAKEOVER');
      const data = task.op === 'messages' ? await read(task) : await send(task);
      result = { ok: true, data };
    } catch (e) { result = { ok: false, error: { message: e.message, code: e.code, exitCode: e.exitCode || 9, safeNotSent: e.safeNotSent !== false } }; }
    journal[task.id] = { status: 'done', at: Date.now(), ...(task.op === 'inquire' ? { result } : {}) };
    await chrome.storage.local.set({ journal });
  }
  await api('result', { id: task.id, ...result });
}
function publicState(state) {
  return { ...state, jobs: state.jobs.map(({ transcript, seen, pending, ...j }) => j) }; // native chat remains the editor
}
async function pulse() {
  if (pulsing || !panel || !token) return;
  pulsing = true;
  try {
    const poll = await api('poll', { limit: Math.max(0, 2 - active.size) });
    stopped = !poll.running;
    for (const task of poll.tasks) {
      active.set(task.id, task);
      execute(task).catch((e) => panel?.postMessage({ kind: 'ERROR', message: e.message })).finally(() => active.delete(task.id));
    }
    const state = await api('state');
    panel?.postMessage({ kind: 'STATE', state: publicState(state), search });
  } catch (e) { stopped = true; panel?.postMessage({ kind: 'ERROR', message: e.message }); }
  finally { pulsing = false; }
}
async function searchPage(keyword, current = false) {
  let tab;
  if (current) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  else { const { url } = await api('search-url', { keyword }); tab = await visibleTab(url); }
  if (!tab) throw fault('没有活动搜索页。');
  await readyTab(tab.id);
  let capture;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    capture = await frameCall(tab.id, 0, { kind: 'COLLECT' });
    if (capture.offers.length >= 5) break;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.scrollBy(0, 650) });
    await sleep(800);
  }
  if (!capture?.offers.length) throw fault('当前搜索页没有读到商品，请在 Chrome 登录/完成验证后再读取。');
  search = await api('register-search', { keyword, ...capture });
  await chrome.storage.local.set({ search }); return search;
}
async function command(message) {
  await init;
  switch (message.kind) {
    case 'CONNECT': {
      const port = Number(message.port || 4173);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw fault('本地服务端口无效。');
      base = `http://127.0.0.1:${port}`;
      const result = await api('connect', { loginId: message.loginId }, true);
      token = result.token; loginId = result.loginId; stopped = true;
      await chrome.storage.session.set({ token, loginId }); await chrome.storage.local.set({ port });
      return { loginId };
    }
    case 'SEARCH': return await searchPage(message.keyword);
    case 'READ_SEARCH': return await searchPage(message.keyword, true);
    case 'START': {
      const result = await api('start', message.body); scope = result.triggeredJobIds; stopped = false;
      await chrome.storage.local.set({ scope }); return { ...publicState(result), bridge: { connected: true, loginId } };
    }
    case 'PAUSE': stopped = true; await api('pause'); for (const id of Object.keys(tabs)) await cancel(id, false); return { ok: true };
    case 'RESUME': for (const id of scope) { if (!manual.has(id)) continue; await api('action', { id, action: 'resume-browser' }); manual.delete(id); } await api('resume', { jobIds: scope, maxSends: message.maxSends || 100 }); stopped = false; return { ok: true };
    case 'CONFIG': return await api('config', message.body);
    case 'JOB_ACTION': {
      if (message.action === 'takeover') await cancel(message.id);
      const result = await api('action', { id: message.id, action: message.action });
      if (message.action === 'resume-browser') {
        manual.delete(message.id);
        const state = await api('state');
        if (!state.running) await api('resume', { jobIds: scope, maxSends: 100 });
        stopped = false;
      }
      return result;
    }
    case 'APPROVE': return await api('action', { id: message.id, action: 'approve', draftId: message.draftId, text: message.text });
    case 'OPEN_JOB': {
      const state = await api('state'), job = state.jobs.find((j) => j.id === message.id);
      if (!job) throw fault('会话不存在。');
      if (tabs[job.id]) { await chrome.tabs.update(tabs[job.id].id, { active: true }); return { ok: true }; }
      const tab = await visibleTab(job.sellerLoginId ? imUrl(job.sellerLoginId, job.offerId) : job.productUrl);
      tabs[job.id] = { id: tab.id, seller: job.sellerLoginId, offerId: job.offerId }; await chrome.storage.local.set({ tabs });
      await readyTab(tab.id); await assign(tab.id, job.id); return { ok: true };
    }
    case 'STATE': return { state: publicState(await api('state')), search, loginId, scope };
    default: throw fault('未知插件操作。');
  }
}
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'visible-panel' || port.sender?.id !== chrome.runtime.id || !port.sender?.url?.startsWith(`chrome-extension://${chrome.runtime.id}/panel.html`)) return;
  panel = port;
  port.onMessage.addListener((m) => { if (m.kind === 'PULSE') void init.then(pulse); });
  port.onDisconnect.addListener(() => {
    if (panel !== port) return;
    panel = null; stopped = true;
    void init.then(async () => { for (const id of Object.keys(tabs)) await cancel(id, false); if (token) await api('disconnect').catch(() => {}); token = null; await chrome.storage.session.remove('token'); });
  });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    await init;
    const panelSender = sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/panel.html`);
    if (sender.tab && !panelSender) {
      const binding = Object.entries(tabs).find(([, v]) => v.id === sender.tab.id);
      if (!binding) return { allowed: false };
      const [jobId] = binding;
      if (message.kind === 'WHO_AM_I') return { jobId, manual: manual.has(jobId) };
      if (message.kind === 'PERMIT') {
        if (stopped || manual.has(jobId)) return { allowed: false };
        return await api('permit', { id: message.operationId });
      }
      if (message.kind === 'TAKEOVER') { await cancel(jobId); await api('action', { id: jobId, action: 'takeover' }); return { ok: true }; }
      return { allowed: false };
    }
    if (!panelSender) throw fault('只接受插件侧栏的控制请求。');
    return await command(message);
  })().then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: e.message }));
  return true;
});
chrome.tabs.onRemoved.addListener((id) => {
  const entry = Object.entries(tabs).find(([, v]) => v.id === id);
  if (entry) { manual.add(entry[0]); delete tabs[entry[0]]; void chrome.storage.local.set({ tabs }); if (token) void api('action', { id: entry[0], action: 'takeover' }).catch(() => {}); }
});
