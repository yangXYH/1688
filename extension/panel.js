const $ = (id) => document.getElementById(id);
let state = null, searchData = null, selected = new Set(), lastSearchId = null, busy = false, connected = false;
const labels = { queued:'正在打开商品',draft:'准备发送',waiting:'等待商家回复',analyzing:'模型分析',review:'需要核对',qualified:'初筛符合，待核验',rejected:'不符合',manual:'你已接管',uncertain:'发送结果待核对',error:'操作失败',timeout:'等待超时',duplicate:'同卖家已合并',stopped:'已终止' };
function message(text, error = false) { $('message').textContent = text || ''; $('message').classList.toggle('error', error); }
async function cmd(kind, payload = {}) {
  const response = await chrome.runtime.sendMessage({ kind, ...payload });
  if (!response?.ok) throw new Error(response?.error || '插件未响应，请重新打开侧栏。');
  return response.data;
}
function consentReset() { $('consent').checked = false; updateStart(); }
function updateStart() { $('start').disabled = busy || !connected || !selected.size || !$('consent').checked; }
function offerList(data) {
  if (!data || data.inquirySource?.id === lastSearchId) return;
  searchData = data; lastSearchId = data.inquirySource.id;
  selected = new Set(data.offers.slice(0, Number($('count').value) || 5).map((o) => o.offerId));
  $('offers').replaceChildren();
  for (const o of data.offers) {
    const label = document.createElement('label'); label.className = 'offer';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(o.offerId);
    const copy = document.createElement('span'); copy.textContent = o.title;
    const note = document.createElement('small'); note.textContent = `${o.supplier?.name || '进入商品页识别卖家'} · ${o.offerId}`; copy.append(note);
    check.addEventListener('change', () => { check.checked ? selected.add(o.offerId) : selected.delete(o.offerId); consentReset(); });
    label.append(check, copy); $('offers').append(label);
  }
  consentReset();
}
function button(label, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => work(action)); return b; }
function render() {
  if (!state) return;
  connected = state.bridge?.connected === true;
  $('connection').textContent = connected ? `已连接 · 旺旺账号 ${state.bridge.loginId}` : '未连接，请点击连接插件';
  $('status').textContent = `${state.notice} 本次已发 ${state.sendCount}/${state.maxSends} 条消息。`;
  $('questions').replaceChildren();
  for (const q of state.questions.filter((q) => $('cert').checked || !['certificate','documents'].includes(q.id))) {
    const li = document.createElement('li'); li.textContent = q.text;
    if ($('clarify').checked) { const p = document.createElement('p'); p.textContent = `必要时追问一次：${q.clarification}`; li.append(p); }
    $('questions').append(li);
  }
  $('jobs').replaceChildren();
  const jobs = state.scopeIds ? state.jobs.filter((j) => state.scopeIds.includes(j.id)) : state.jobs;
  for (const j of jobs) {
    const row = document.createElement('article'); row.className = `job${j.manual ? ' manual' : ''}`;
    const title = document.createElement('strong'); title.textContent = j.sellerLoginId || j.title || `商品 ${j.offerId}`;
    const status = document.createElement('small'); status.textContent = `${labels[j.phase] || j.phase} · ${j.questions[j.step]?.label || '问答结束'}`;
    const question = document.createElement('p'); question.textContent = j.phase === 'draft' && j.draft ? `待发送：${j.draft.initial ? j.productUrl + '\n' : ''}${j.draft.text}` : j.questions[j.step]?.text || '查看真实会话核验供应商资料。';
    const actions = document.createElement('div'); actions.className = 'row';
    actions.append(button('打开真实旺旺', () => cmd('OPEN_JOB', { id:j.id })), button(j.manual ? '恢复自动' : '接管此家', () => cmd('JOB_ACTION', { id:j.id, action:j.manual ? 'resume-browser' : 'takeover' })));
    row.append(title,status,question,actions);
    if (j.error) { const error = document.createElement('p'); error.textContent = j.error; row.append(error); }
    if (j.phase === 'review') row.append(button('核对后通过本项', () => cmd('JOB_ACTION',{id:j.id,action:'accept'})), button('判为不符合',()=>cmd('JOB_ACTION',{id:j.id,action:'reject'})),button('重新读取',()=>cmd('JOB_ACTION',{id:j.id,action:'refresh'})));
    if (j.phase === 'draft' && !j.draft.approved) row.append(button('批准当前问题',()=>cmd('APPROVE',{id:j.id,draftId:j.draft.id,text:j.draft.text})));
    if (j.phase === 'uncertain') row.append(button('已确认问题发出',()=>cmd('JOB_ACTION',{id:j.id,action:'sent'})),button('确认未发出',()=>cmd('JOB_ACTION',{id:j.id,action:'not-sent'})));
    if (['error','timeout'].includes(j.phase)) row.append(button('已处理，恢复读取',()=>cmd('JOB_ACTION',{id:j.id,action:'retry'})));
    $('jobs').append(row);
  }
  if (state.config) {
    if (!$('endpoint').value) $('endpoint').value=state.config.endpoint;
    if (!$('model').value) $('model').value=state.config.model;
  }
  updateStart();
}
async function work(fn) {
  if (busy) return;
  busy = true; updateStart();
  try { const result = await fn(); message('操作已完成。'); return result; }
  catch (e) { message(e.message,true); }
  finally { busy=false; updateStart(); }
}
const port = chrome.runtime.connect({name:'visible-panel'});
port.onMessage.addListener((m)=>{if(m.kind==='STATE'){state=m.state;offerList(m.search);render();}else if(m.kind==='ERROR'){message(m.message,true);}});
setInterval(()=>port.postMessage({kind:'PULSE'}),2000);
port.postMessage({kind:'PULSE'});
$('connect').addEventListener('submit',(e)=>{e.preventDefault();work(async()=>{const result=await cmd('CONNECT',{port:Number($('port').value),loginId:$('login').value.trim()});$('login').value=result.loginId;connected=true;$('connection-box').open=false;port.postMessage({kind:'PULSE'});});});
$('search').addEventListener('click',()=>work(async()=>offerList(await cmd('SEARCH',{keyword:$('keyword').value.trim()}))));
$('read-search').addEventListener('click',()=>work(async()=>offerList(await cmd('READ_SEARCH',{keyword:$('keyword').value.trim()}))));
$('count').addEventListener('change',()=>{if(searchData){lastSearchId=null;offerList(searchData);}});
for(const id of ['cert','clarify']) $(id).addEventListener('change',()=>{consentReset();render();});
$('consent').addEventListener('change',updateStart);
$('start').addEventListener('click',()=>work(async()=>{if(!$('consent').checked||!searchData)return;state=await cmd('START',{body:{sourceId:searchData.inquirySource.id,offerIds:[...selected],approvedTemplates:true,approvedClarifications:$('clarify').checked,needsCertificate:$('cert').checked,maxSends:Number($('budget').value)}});$('consent').checked=false;render();}));
$('pause').addEventListener('click',async()=>{try{await cmd('PAUSE');message('已暂停。你可以直接在旺旺页面回复。');}catch(e){message(e.message,true);}});
$('resume').addEventListener('click',()=>work(()=>cmd('RESUME',{maxSends:Number($('budget').value)})));
$('model-form').addEventListener('submit',(e)=>{e.preventDefault();work(async()=>{await cmd('CONFIG',{body:{endpoint:$('endpoint').value,model:$('model').value,apiKey:$('api-key').value,workers:Number($('workers').value)}});$('api-key').value='';});});
