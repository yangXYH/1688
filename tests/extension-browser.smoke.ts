import { chromium } from 'playwright';
// Optional Chrome for Testing integration check. Never contacts live 1688 or models.
import { startWebFixture } from './helpers/web-fixture.ts';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const fixture=await startWebFixture();
const directory=path.resolve('work',`extension-qa-${Date.now()}`);
const ext=path.resolve('extension');
const browser=await chromium.launchPersistentContext(directory,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const errors=[];
const nativeRequests=[];
let modelCalls=0, activeModels=0, peakModels=0;
const model=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const incoming=JSON.parse(JSON.parse(raw).messages[1].content);
  modelCalls++;activeModels++;peakModels=Math.max(peakModels,activeModels);
  await new Promise(r=>setTimeout(r,7000));activeModels--;
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({decision:incoming.question.id==='product'?'accept':'wait',reason:'模拟供应商同款确认',evidence:'有的，是同款产品。',reply:''})}}]}));
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
browser.on('serviceworker',w=>w.on('console',m=>{if(m.type()==='error')errors.push(m.text());}));
const html = (body,script='') => `<!doctype html><html><head><meta charset="utf-8"><title>Isolated extension fixture</title></head><body>${body}<script>${script}</script></body></html>`;
await browser.route('https://**.1688.com/**',async route=>{
  const url=new URL(route.request().url());
  nativeRequests.push(url.pathname);
  if(url.pathname.includes('offer_search'))return route.fulfill({contentType:'text/html',body:html(Array.from({length:5},(_,i)=>`<div data-offer-id="${123+i}"><a href="https://detail.1688.com/offer/${123+i}.html">模拟商品 ${123+i}</a><span class="company">模拟供应商 ${i}</span></div>`).join(''))});
  if(url.hostname==='detail.1688.com')return route.fulfill({contentType:'text/html',body:html('<h1>模拟商品</h1>',`window.FE_GLOBALS={offerLoginId:"fixture-seller-${url.pathname.match(/\d+/)[0]}"};`)});
  if(url.pathname.includes('def_cbu_web_im_core'))return route.fulfill({contentType:'text/html',body:html('<div id="messages"></div><pre class="edit" contenteditable="true"></pre><button class="send-btn">发送</button>',`let sequence=0;function append(text,mine){const m=document.createElement('div');m.className='message-item'+(mine?' self':'');m.dataset.messageId='fixture-'+location.search+'-'+(++sequence);m.innerText=(mine?'fixture-buyer':'fixture-seller')+' 2026-11-10 01:00:00 '+text;document.querySelector('#messages').append(m);}document.querySelector('button').onclick=()=>{const e=document.querySelector('pre');const text=e.innerText;append(text,true);e.innerText='';if(text.includes('是否同款'))append('有的，是同款产品。',false);};`)});
  return route.fulfill({contentType:'text/html',body:html(`<h1>fixture-buyer</h1><iframe style="width:100%;height:650px" src="https://air.1688.com/def_cbu_web_im_core/fixture.html?offer=${url.searchParams.get('offerId')}"></iframe>`)});
});
const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
  const cfg=await fetch(`${fixture.url}/api/supplier/config`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:`http://127.0.0.1:${model.address().port}/v1/chat/completions`,model:'mock-model',workers:8})});assert.equal(cfg.status,200);
  await page.goto('chrome-extension://nhngafipdkeamcmjaabcognfdffhgjoi/panel.html');
  await page.locator('#port').fill(new URL(fixture.url).port);await page.locator('#login').fill('fixture-buyer');await page.locator('#connect button').click();
  await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('已连接'),null,{timeout:15000});
  await page.locator('#keyword').fill('行李箱');await page.locator('#count').fill('5');await page.locator('#search').click();
  await page.locator('#offers input').first().waitFor();assert.equal(await page.locator('#offers input').count(),5);
  await page.locator('#consent').check();await page.locator('#start').click();
  let sent=false;
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){const s=await(await fetch(`${fixture.url}/api/supplier`)).json();sent=s.jobs.length===5&&s.jobs.every(j=>j.step===1&&j.outbox?.status==='sent'&&j.outbox.text.includes('外销包装'));if(sent)break;if(s.jobs.some(j=>['error','uncertain','review'].includes(j.phase)))throw new Error(JSON.stringify(s.jobs.map(j=>({phase:j.phase,error:j.error}))));await new Promise(r=>setTimeout(r,500));}
  assert.ok(sent,'all five suppliers must advance from the model answer to the second native question');
  const conversations=browser.pages().filter(p=>p.url().includes('def_cbu_web_im/index.html'));assert.equal(conversations.length,5);
  for(const p of conversations)assert.equal(await p.frameLocator('iframe').locator('.message-item.self').count(),3);
  assert.equal(nativeRequests.filter(p=>p.includes('def_cbu_web_im/index.html')).length,5,'chat histories must not be refreshed by reloading editable pages');
  assert.ok(modelCalls>=5);assert.ok(peakModels>=2,'model interpretation must overlap across suppliers');
  const im=conversations[0];const frame=im.frameLocator('iframe');
  const edit=frame.locator('pre.edit');await edit.click();await edit.fill('这是手动草稿，不得覆盖');
  const stopDeadline=Date.now()+10000;let manual=false;
  while(Date.now()<stopDeadline){const s=await(await fetch(`${fixture.url}/api/supplier`)).json();manual=s.jobs[0].manual===true;if(manual)break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(manual,true);assert.equal(await edit.innerText(),'这是手动草稿，不得覆盖');assert.equal(await frame.locator('.message-item.self').count(),3);
  const live=await(await fetch(`${fixture.url}/api/supplier`)).json();assert.equal(live.running,true);assert.equal(live.jobs.filter(j=>j.manual).length,1);
  await frame.locator('button.send-btn').click();assert.equal(await frame.locator('.message-item.self').count(),4,'native manual reply remains usable');
  await page.screenshot({path:'work/chrome-extension-panel.png',fullPage:true});await im.screenshot({path:'work/chrome-extension-native.png'});
  await page.close();await new Promise(r=>setTimeout(r,300));
  assert.equal((await(await fetch(`${fixture.url}/api/supplier`)).json()).running,false);
  assert.deepEqual(errors,[]);
  console.log(`MV3 extension smoke passed: five native supplier tabs, 15 automatic native messages, ${modelCalls} model calls (peak ${peakModels}), manual draft takeover/native reply and side-panel disconnect. All 1688 pages and models were isolated fixtures; no real sellers contacted.`);
}catch(e){console.error(await page.locator('body').innerText().catch(()=>''));throw e;}
finally{await browser.close();await fixture.close();await new Promise(r=>model.close(r));if(!directory.startsWith(path.resolve('work')+path.sep+'extension-qa-'))throw new Error('unsafe temp directory');await fs.rm(directory,{recursive:true,force:true});}
