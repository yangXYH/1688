import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startWebFixture} from './helpers/web-fixture.js';
import {EXTENSION_ORIGIN} from '../scripts/extension-bridge.mjs';
describe('Chrome extension API boundary',()=>{
  let fixture:Awaited<ReturnType<typeof startWebFixture>>,token:string;
  beforeAll(async()=>{fixture=await startWebFixture();});afterAll(async()=>{await fixture?.close();});
  const post=(name:string,body:unknown={},origin=EXTENSION_ORIGIN,credential=token)=>fetch(`${fixture.url}/api/extension/${name}`,{method:'POST',headers:{'content-type':'application/json',origin,...(credential?{'x-1688-bridge':credential}:{})},body:JSON.stringify(body)});
  it('rejects webpage/foreign-extension callers, missing tokens and buyer-account mismatches',async()=>{
    expect((await post('connect',{loginId:'buyer'},'https://evil.example')).status).toBe(403);
    expect((await post('connect',{loginId:'buyer'},'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(403);
    expect((await post('state')).status).toBe(401);
    await fs.writeFile(path.join(fixture.home,'state.json'),JSON.stringify({nick:'buyer'}));
    expect((await post('connect',{loginId:'different'})).status).toBe(409);
    const response=await post('connect',{loginId:'buyer'});expect(response.status).toBe(200);token=(await response.json()).token;
    expect((await post('state',{},EXTENSION_ORIGIN,'wrong')).status).toBe(401);
  });
  it('registers only real 1688 search pages and blocks hidden CLI starts in extension mode',async()=>{
    const state=await (await post('state')).json();expect(state.transport).toBe('extension');expect(state.running).toBe(false);
    const response=await post('search-url',{keyword:'行李箱20寸'});expect((await response.json()).url).toContain('%D0%D0%C0%EE%CF%E4');
    expect((await post('register-search',{url:'https://evil.example/selloffer/offer_search.htm',keyword:'箱',offers:[]})).status).toBe(400);
    const registered=await (await post('register-search',{url:'https://s.1688.com/selloffer/offer_search.htm?keywords=x',keyword:'箱',offers:[{offerId:'123',title:'测试箱'}]})).json();
    expect(registered.inquirySource.keyword).toBe('箱');
    const old=await fetch(`${fixture.url}/api/supplier/start`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});expect(old.status).toBe(409);
    expect((await post('poll',{limit:0})).status).toBe(200);
    const calls=await fixture.calls().catch(()=>[]);expect(calls).toHaveLength(0);
  });
  it('disconnects without exposing a model key',async()=>{
    const state=await (await post('state')).text();expect(state).not.toContain('apiKey');
    expect((await post('disconnect')).status).toBe(200);expect((await post('state')).status).toBe(401);
  });
});
