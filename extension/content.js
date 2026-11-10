(() => {
  if (globalThis.__C1688_CONTENT__) return;
  globalThis.__C1688_CONTENT__ = true;
  let jobId = null, manual = false, inserting = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const problem = (message, code = 'BROWSER_ERROR', exitCode = 9, safeNotSent = true) => Object.assign(new Error(message), { code, exitCode, safeNotSent });
  function health() {
    const text = document.body?.innerText ?? '';
    if (/login\.(1688|taobao)\.com/.test(location.hostname)) throw problem('请在 Chrome 中手动登录。', 'NOT_LOGGED_IN', 3);
    if (/punish|_____tmd_____/.test(location.href) || document.querySelector('#nocaptcha, .nc_scale, #baxia-dialog-content') || /请拖动滑块完成验证|访问过于频繁/.test(text)) throw problem('请在当前标签页手动完成验证。', 'RISK_CONTROL', 4);
    return text;
  }
  function banner() {
    if (window !== top || !jobId) return;
    let box = document.getElementById('c1688-automation');
    if (!box) {
      box = document.createElement('div'); box.id = 'c1688-automation';
      const label = document.createElement('span'); const button = document.createElement('button');
      button.textContent = '暂停并接管'; button.addEventListener('click', () => takeover());
      box.append(label, button); document.documentElement.append(box);
    }
    box.firstChild.textContent = manual ? '你正在手动操作本会话' : '采货台：可见自动问答中';
  }
  function takeover() {
    if (!jobId || manual) return;
    manual = true; banner();
    chrome.runtime.sendMessage({ kind: 'TAKEOVER', jobId }).catch(() => {});
  }
  for (const type of ['pointerdown', 'keydown', 'beforeinput']) document.addEventListener(type, (event) => {
    if (event.isTrusted && !inserting && !event.target?.closest?.('#c1688-automation')) takeover();
  }, true);
  function editor() { return document.querySelector('pre.edit[contenteditable="true"]'); }
  async function send(text, operationId) {
    let clicked = false;
    try {
      health();
      if (manual) throw problem('你已接管此会话。', 'MANUAL_TAKEOVER');
      const input = editor();
      const button = document.querySelector('button.send-btn');
      if (!input || !button || /您尚未选择联系人/.test(document.body.innerText)) throw problem('当前旺旺会话尚未打开。', 'CONVERSATION_NOT_SELECTED');
      if (input.innerText.trim()) { takeover(); throw problem('输入框已有你的草稿，自动化不会覆盖。', 'MANUAL_TAKEOVER'); }
      const count = () => [...document.querySelectorAll('.message-item.self')].filter((m) => m.innerText.includes(text)).length;
      const before = count();
      const permission = await chrome.runtime.sendMessage({ kind: 'PERMIT', operationId });
      if (!permission.data?.allowed || manual) throw problem('操作已暂停。', 'MANUAL_TAKEOVER');
      inserting = true;
      try { input.focus(); document.execCommand('insertText', false, text); }
      finally { inserting = false; }
      await sleep(300);
      const finalPermission = await chrome.runtime.sendMessage({ kind: 'PERMIT', operationId });
      if (manual || !finalPermission.data?.allowed || input.innerText !== text) throw problem('发送前已暂停或输入内容变化，请自行核对草稿。', 'MANUAL_TAKEOVER');
      if (button.disabled) throw problem('发送按钮尚不可用。', 'SEND_DISABLED');
      clicked = true; button.click();
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) { if (count() > before) return { ok: true }; await sleep(200); }
      throw problem('已点击发送，但未确认新的本人消息。请到旺旺核对，禁止自动重发。', 'SEND_UNCONFIRMED', 9, false);
    } catch (e) { e.safeNotSent = !clicked; throw e; }
  }
  function collect() {
    health(); const offers = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      let url; try { url = new URL(a.href); } catch { continue; }
      if (!/^(detail|detail\.m)\.1688\.com$/.test(url.hostname)) continue;
      const match = /^\/offer\/(\d+)\.html/.exec(url.pathname); if (!match) continue;
      const card = a.closest('[data-offer-id], [class*="offer-card"], [class*="offerCard"], [class*="search-offer"]') ?? a.parentElement;
      const title = (a.getAttribute('title') || a.innerText || a.querySelector('img')?.alt || card?.querySelector('img')?.alt || '').trim().slice(0, 500);
      if (!title || offers.has(match[1])) continue;
      offers.set(match[1], { offerId: match[1], title, supplier: { name: (card?.querySelector('[class*="company"], [class*="shopName"], [class*="supplier"]')?.textContent ?? '').trim().slice(0, 200) } });
      if (offers.size >= 100) break;
    }
    return { url: location.href, offers: [...offers.values()] };
  }
  function snapshot() {
    health();
    return [...document.querySelectorAll('.message-item')].slice(-200).map((item) => {
      const raw = item.innerText.trim(), match = raw.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
      const id = item.dataset.messageId || item.dataset.msgId;
      const content = (match ? raw.slice(match.index + match[0].length) : raw).replace(/已读\s*$/, '').trim();
      return { sender: match ? raw.slice(0, match.index).trim().split(':')[0] : '', time: match?.[0] ?? null,
        isMine: item.classList.contains('self'), content, read: /已读\s*$/.test(raw),
        kind: item.querySelector('.im-template-msg, .text-od-wrap') ? 'other' : item.querySelector('.content img') ? 'image' : /https?:\/\/detail\.1688\.com\/offer\/\d+\.html/.test(content) ? 'offerCard' : 'text', ...(id ? { messageId: id } : {}) };
    });
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    (async () => {
      switch (message.kind) {
        case 'ASSIGN': jobId = message.jobId; manual = !!message.manual; banner(); return { ok: true };
        case 'CANCEL': manual = true; banner(); return { ok: true };
        case 'META': return { text: health().slice(0, 12000), editor: !!editor(), manual, active: !/您尚未选择联系人/.test(document.body?.innerText ?? '') };
        case 'COLLECT': return collect();
        case 'SNAPSHOT': return { messages: snapshot() };
        case 'SEND': return await send(String(message.text ?? ''), message.operationId);
        default: throw problem('不支持的插件页面动作。');
      }
    })().then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: { message: e.message, code: e.code, exitCode: e.exitCode, safeNotSent: e.safeNotSent !== false } }));
    return true;
  });
  (async()=>{
    for(let i=0;i<20&&!jobId;i++){
      try{const response=await chrome.runtime.sendMessage({kind:'WHO_AM_I'});if(response?.data?.jobId){jobId=response.data.jobId;manual=!!response.data.manual;banner();return;}}catch{/* worker may still be starting */}
      await sleep(500);
    }
  })();
})();
