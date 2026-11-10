/* Separate from sourcing UI so search state and exports remain intact. */
(() => {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labels = { queued: '待读取会话', draft: '待发送审核', waiting: '等待供应商', analyzing: '模型分析中', review: '需要人工判断', qualified: '初筛符合 · 待核验', rejected: '初筛不符合', uncertain: '发送结果待核对', stopped: '已终止', error: '操作失败', timeout: '等待超时', duplicate: '同供应商已合并' };
  let snapshot = null, selected = null, visible = false, refreshing = false, mutation = false;
  let inlineSearchId = null, inlineKeyword = '', inlineJobIds = null, targetFingerprint = '', loadingFlow = false;
  function flowTargets() {
    const picked = state.offers.filter((_, i) => state.selected.has(i));
    const count = Number(el('inquiry-count').value);
    return picked.length ? picked : state.offers.slice(0, Number.isInteger(count) && count >= 1 && count <= 100 ? count : 0);
  }
  function updateFlowTargets() {
    const offers = flowTargets();
    const source = state.inquirySource;
    el('search-inquiry').hidden = !state.offers.length || state.mode === 'image';
    const fingerprint = JSON.stringify([source?.id, offers.map((o) => o.offerId), el('inquiry-cert').checked, el('inquiry-clarify').checked]);
    if (fingerprint !== targetFingerprint) { el('inquiry-consent').checked = false; targetFingerprint = fingerprint; }
    el('inquiry-target-summary').textContent = source
      ? `关键词「${source.keyword}」 · ${state.selected.size ? '已勾选' : '按搜索顺序取前'} ${offers.length} 件商品；同一卖家合并为一个会话。`
      : '请重新进行关键词搜索，以便将询盘与真实搜索结果关联。';
    el('inquiry-targets').innerHTML = offers.map((o) => `<li>${esc(o.title)} · 商品 ${esc(o.offerId)}</li>`).join('');
    if (snapshot) el('inquiry-questions').innerHTML = snapshot.questions.filter((q) => el('inquiry-cert').checked || !['certificate', 'documents'].includes(q.id)).map((q) => `<li>${esc(q.text)}${el('inquiry-clarify').checked && q.clarification ? `<p>必要时追问一次：${esc(q.clarification)}</p>` : ''}</li>`).join('');
    el('inquiry-trigger').disabled = state.busy || state.searchFailed || mutation || !source || !offers.length || offers.length > 100 || !snapshot || !el('inquiry-consent').checked;
    el('inquiry-trigger').textContent = `开始自动询盘（${offers.length} 件）`;
    if (state.offers.length && !snapshot && !loadingFlow) {
      loadingFlow = true;
      request().then((data) => { snapshot = data; updateFlowTargets(); }).catch((e) => showMessage(e.message)).finally(() => { loadingFlow = false; });
    }
  }
  function openInline(config = false) {
    visible = true;
    el('supplier-panel').hidden = false;
    el('supplier-panel').classList.add('flow-inline');
    el('supplier-panel').classList.toggle('flow-config', config);
    el('search-inquiry').after(el('supplier-panel'));
    el('supplier-flow-source').hidden = false;
    el('supplier-flow-source').textContent = config ? '当前页面的模型与问答设置' : `来自关键词「${inlineKeyword}」的自动问答进度`;
  }
  function message(text, isError = false) {
    el('supplier-message').hidden = !text;
    el('supplier-message').textContent = text;
    el('supplier-message').classList.toggle('error', isError);
  }
  async function request(route = '', body) {
    const r = await fetch(`/api/supplier${route}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let data;
    try { data = await r.json(); } catch { throw new Error('本地服务不可用，请重启操作台。'); }
    if (!r.ok) throw new Error(data.message || '问答请求失败');
    return data;
  }
  async function mutate(route, body) {
    if (mutation) return;
    mutation = true;
    try { snapshot = await request(route, body); message('操作已保存。'); render(); }
    catch (e) { message(e.message, true); }
    finally { mutation = false; }
  }
  async function refresh() {
    if (!visible || refreshing || mutation) return;
    refreshing = true;
    try { snapshot = await request(); render(); }
    catch (e) { message(e.message, true); }
    finally { refreshing = false; }
  }
  function render() {
    if (!snapshot) return;
    const nativeBrowser = snapshot.transport === 'extension';
    el('native-browser-notice').hidden = !nativeBrowser;
    el('supplier-panel').classList.toggle('native-browser', nativeBrowser);
    el('supplier-status').textContent = snapshot.notice;
    const jobs = inlineJobIds ? snapshot.jobs.filter((j) => inlineJobIds.includes(j.id)) : snapshot.jobs;
    if (!jobs.some((j) => j.id === selected)) selected = jobs[0]?.id ?? null;
    el('supplier-stats').textContent = `${jobs.length} 个任务 · ${jobs.filter((j) => j.phase === 'waiting').length} 家等待回复 · ${jobs.filter((j) => ['review', 'uncertain'].includes(j.phase)).length} 家待处理 · 本次已发 ${snapshot.sendCount}/${snapshot.maxSends} 条消息`;
    if (!jobs.length) el('supplier-stats').textContent = '请先填入商品并点击“加入问答队列”，再启动问答。';
    el('supplier-start').disabled = nativeBrowser || snapshot.running || snapshot.starting || !jobs.some((j) => !['qualified', 'rejected', 'duplicate', 'stopped'].includes(j.phase));
    el('supplier-config').querySelectorAll('input, button').forEach((field) => { field.disabled = snapshot.running || snapshot.starting; });
    if (snapshot.config) {
      el('supplier-model-status').textContent = `已配置 ${snapshot.config.model} · 并发 ${snapshot.config.workers} · ${snapshot.config.keyConfigured ? '密钥已设置' : '未设置密钥（适用于免密本机服务）'}。`;
      if (!el('supplier-endpoint').value) el('supplier-endpoint').value = snapshot.config.endpoint;
      if (!el('supplier-model').value) el('supplier-model').value = snapshot.config.model;
    }
    el('supplier-questions').innerHTML = snapshot.questions.filter((q) => el('supplier-cert').checked || !['certificate', 'documents'].includes(q.id)).map((q) => `<li>${esc(q.text)}</li>`).join('');
    el('supplier-jobs').innerHTML = jobs.length ? jobs.map((j) => `<button type="button" class="dialogue-job ${j.id === selected ? 'chosen' : ''}" data-job="${esc(j.id)}"><strong>${esc(j.sellerLoginId || `商品 ${j.offerId}`)}</strong><span>${esc(labels[j.phase])}${j.phase === 'draft' && j.draft.approved ? '（已授权）' : ''}</span><small>${esc(j.questions[j.step]?.label || '问答结束')} · 商品 ${esc(j.offerId)}</small></button>`).join('') : '<h2>供应商会话</h2><p>先选择商品或粘贴链接，再加入队列。默认暂停，点击启动后才会读取和处理。</p>';
    el('supplier-jobs').querySelectorAll('[data-job]').forEach((button) => button.addEventListener('click', () => { selected = button.dataset.job; render(); }));
    if (!selected && jobs.length) selected = jobs[0].id;
    if (inlineJobIds) el('inquiry-progress').textContent = `${snapshot.notice} 已确认 ${jobs.reduce((n, j) => n + j.answers.length, 0)} 项 · ${jobs.filter((j) => j.phase === 'qualified').length} 家初筛符合 · ${jobs.filter((j) => j.phase === 'rejected').length} 家不符合 · ${jobs.filter((j) => j.phase === 'review').length} 家需复核`;
    // Preserve typed reviews while background snapshots update.
    if (el('supplier-detail').contains(document.activeElement) && document.activeElement?.matches?.('textarea, input')) return;
    renderDetail();
  }
  function renderDetail() {
    const j = snapshot.jobs.find((v) => v.id === selected);
    if (!j) return;
    const terminal = ['qualified', 'rejected', 'duplicate', 'stopped'].includes(j.phase);
    let controls = '';
    if (j.phase === 'draft') controls = `<label>待发送文本<textarea id="supplier-reply" rows="4" maxlength="500">${esc(j.draft.text)}</textarea></label><p>${j.draft.initial ? '首次发送包含此商品链接及上方文本。' : '仅发送上方文本。'}${j.draft.approved ? '已授权，运行中会自动发送；修改前请先暂停。' : ''}</p><button type="button" class="primary-button" data-action="approve">批准此消息</button>`;
    if (j.phase === 'review') controls = `<div class="dialogue-actions"><button type="button" class="secondary-button" data-action="accept">核对后通过本项</button><button type="button" class="secondary-button" data-action="reject">判为不符合</button></div><label>人工追问（发送后继续判断当前项）<textarea id="supplier-reply" rows="3" maxlength="500">${esc(j.suggestion || '')}</textarea></label><button type="button" class="primary-button" data-action="reply">批准并发送追问</button>`;
    if (j.phase === 'uncertain') controls = '<p>请打开旺旺核对最后一条消息，确认后选择。系统不会自动重发。</p><div class="dialogue-actions"><button type="button" class="secondary-button" data-action="sent">已确认发出，继续等待</button><button type="button" class="secondary-button" data-action="not-sent">确认未发出，重新审核</button></div>';
    if (['error', 'timeout'].includes(j.phase)) controls = '<button type="button" class="secondary-button" data-action="retry">已处理问题，恢复读取</button>';
    if (j.phase === 'review' && j.outbox?.status === 'sent') controls += '<button type="button" class="secondary-button" data-action="refresh">重新读取并分析回复</button>';
    el('supplier-detail').innerHTML = `<div class="dialogue-detail-heading"><div><h2>${esc(j.sellerLoginId || '供应商会话')}</h2><a href="${esc(j.productUrl)}" target="_blank" rel="noopener noreferrer">查看商品 ${esc(j.offerId)}</a></div><span>${esc(labels[j.phase])}</span></div>
      ${j.source ? `<p>搜索来源：${esc(j.source.keyword)} · ${esc(j.title || j.offerId)}</p>` : ''}
      <p>当前：${esc(j.questions[j.step]?.text || '已完成筛选')} · ${j.mode === 'automatic' ? '固定问答自动发送' : '逐条审核'}</p>
      ${j.error ? `<p class="dialogue-error">${esc(j.error)}</p>` : ''}
      <div class="dialogue-review">${controls}</div>
      ${j.pending?.length && j.phase === 'review' ? `<h3>待核对回复</h3><pre>${esc(j.pending.map((m) => m.content).join('\n'))}</pre>` : ''}
      <h3>已记录的筛选依据</h3><ul>${j.answers.map((a) => `<li><strong>${esc(j.questions.find((q) => q.id === a.question)?.label)}：${a.decision === 'accept' ? '自述满足' : '不满足'}${a.human ? '（人工确认）' : a.reviewer === 'assistant' ? '（代理复核）' : ''}</strong><p>${esc(a.reason)}</p><blockquote>${esc(a.evidence)}</blockquote></li>`).join('') || '<li>尚无结论</li>'}</ul>
      <h3>会话记录</h3><div class="dialogue-transcript">${j.transcript.map((m) => `<div class="dialogue-bubble ${m.isMine ? 'mine' : ''}"><small>${m.isMine ? '我方' : '供应商'} · ${esc(m.time || '时间未知')} · ${esc(m.kind)}</small><p>${esc(m.content)}</p></div>`).join('') || '<p>启动后读取历史消息，历史不会触发新问答。</p>'}</div>
      ${!terminal ? '<button type="button" class="secondary-button" data-action="stop">终止此会话</button>' : ''}`;
    el('supplier-detail').querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
      void mutate('/action', { id: j.id, action: b.dataset.action, draftId: j.draft?.id, text: el('supplier-reply')?.value });
    }));
  }
  el('supplier-nav').addEventListener('click', () => {
    visible = true;
    el('result-section').after(el('supplier-panel'));
    inlineJobIds = null; el('supplier-panel').classList.remove('flow-inline', 'flow-config'); el('supplier-flow-source').hidden = true;
    document.querySelector('.search-panel').hidden = true; el('result-section').hidden = true; el('supplier-panel').hidden = false;
    document.querySelectorAll('.main-nav .nav-item').forEach((b) => { b.classList.toggle('active', b.id === 'supplier-nav'); b.setAttribute('aria-current', b.id === 'supplier-nav' ? 'page' : 'false'); });
    el('crumb-title').textContent = '供应商问答'; el('page-title').textContent = '让供应商问答持续推进'; el('page-subtitle').textContent = '连接模型、加入商品，逐条审核或授权固定话术自动发送。';
    void refresh();
  });
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    visible = false; el('supplier-panel').hidden = true; document.querySelector('.search-panel').hidden = false; el('result-section').hidden = false; el('supplier-nav').classList.remove('active');
    if (inlineSearchId && inlineSearchId === state.inquirySource?.id) { openInline(); void refresh(); }
    updateFlowTargets();
  }));
  document.addEventListener('sourcing-selection-changed', updateFlowTargets);
  el('inquiry-count').addEventListener('input', updateFlowTargets);
  el('inquiry-cert').addEventListener('change', updateFlowTargets);
  el('inquiry-clarify').addEventListener('change', updateFlowTargets);
  el('inquiry-consent').addEventListener('change', updateFlowTargets);
  el('inquiry-settings').addEventListener('click', () => { inlineJobIds = null; openInline(true); void refresh(); el('supplier-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el('inquiry-trigger').addEventListener('click', async () => {
    if (mutation || state.busy || state.searchFailed || !el('inquiry-consent').checked || !state.inquirySource) return;
    const offers = flowTargets();
    const source = state.inquirySource;
    mutation = true; updateFlowTargets(); el('inquiry-progress').textContent = '正在核对搜索对象并启动自动问答…';
    try {
      snapshot = await request('/from-search', { sourceId: source.id, offerIds: offers.map((o) => String(o.offerId)), approvedTemplates: true, approvedClarifications: el('inquiry-clarify').checked, needsCertificate: el('inquiry-cert').checked, maxSends: Number(el('supplier-budget').value) });
      inlineSearchId = source.id; inlineKeyword = source.keyword; inlineJobIds = snapshot.triggeredJobIds; selected = inlineJobIds[0] ?? null;
      openInline(); render(); el('supplier-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      el('inquiry-consent').checked = false;
    } catch (e) { el('inquiry-progress').textContent = e.message; showMessage(e.message); }
    finally { mutation = false; updateFlowTargets(); }
  });
  el('supplier-cert').addEventListener('change', () => { el('supplier-consent').checked = false; render(); });
  el('supplier-targets').addEventListener('input', () => { el('supplier-consent').checked = false; });
  el('supplier-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    await mutate('/config', { endpoint: el('supplier-endpoint').value, model: el('supplier-model').value, apiKey: el('supplier-key').value, workers: Number(el('supplier-workers').value) });
    el('supplier-key').value = '';
  });
  el('supplier-test').addEventListener('click', async () => {
    if (mutation) return;
    mutation = true; message('正在用模拟回复测试模型…');
    try { const data = await request('/test', {}); message(`模型测试成功：${data.decision.reason}。`); }
    catch (e) { message(e.message, true); }
    finally { mutation = false; }
  });
  el('supplier-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    await mutate('/jobs', { targets: el('supplier-targets').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), needsCertificate: el('supplier-cert').checked, mode: el('supplier-mode').value, approvedTemplates: el('supplier-consent').checked });
    el('supplier-consent').checked = false;
  });
  el('supplier-import').addEventListener('click', () => {
    const offers = state.offers.filter((_, index) => state.selected.has(index));
    if (!offers.length) { message('请先在搜索结果中勾选商品。', true); return; }
    el('supplier-targets').value = offers.map((o) => o.offerId).filter(Boolean).join('\n'); el('supplier-consent').checked = false;
    message(`已填入 ${offers.length} 件商品，检查后加入队列。`);
  });
  el('supplier-start').addEventListener('click', () => { void mutate('/start', { maxSends: Number(el('supplier-budget').value), ...(inlineJobIds ? { jobIds: inlineJobIds } : {}) }); });
  el('supplier-pause').addEventListener('click', async () => {
    try { snapshot = await request('/pause', {}); message('问答已暂停；正在执行的操作结束后停止。'); render(); }
    catch (e) { message(e.message, true); }
  });
  el('supplier-export').addEventListener('click', () => {
    if (!snapshot?.jobs.length) { message('暂无可导出的问答。'); return; }
    const rows = [['供应商', '商品链接', '状态', '当前问题', '问题', '结论', '判断原因', '供应商原文', '人工核对', '记录时间']];
    for (const j of snapshot.jobs.filter((j) => !inlineJobIds || inlineJobIds.includes(j.id))) {
      for (const a of j.answers.length ? j.answers : [{}]) rows.push([j.sellerLoginId || '', j.productUrl, labels[j.phase], j.questions[j.step]?.label || '', a.question || '', a.decision || '', a.reason || j.error, a.evidence || '', a.human ? '是' : '否', a.at || j.createdAt]);
    }
    const cell = (s) => { let v = String(s ?? ''); if (/^[\s]*[=+@-]/.test(v)) v = `'${v}`; return `"${v.replaceAll('"', '""')}"`; };
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = '供应商问答记录.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  setInterval(() => { void refresh(); }, 3000);
})();
