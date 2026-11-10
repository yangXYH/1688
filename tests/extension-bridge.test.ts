import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { ExtensionBridge, EXTENSION_ID } from '../scripts/extension-bridge.mjs';
afterEach(() => vi.useRealTimers());
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
describe('visible Chrome bridge', () => {
  it('binds a token and only delivers each permitted operation once', async () => {
    const bridge = new ExtensionBridge(); const { token }=bridge.connect('buyer');
    expect(()=>bridge.authorize('wrong')).toThrow('失效'); bridge.authorize(token);
    const before=vi.fn(async()=>{});
    const result=bridge.call(['seller','messages','--offer','123'],before,{jobId:'job'}); await flush();
    expect(bridge.poll(0)).toEqual([]); const tasks=bridge.poll(2);
    expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({offerId:'123',jobId:'job',loginId:'buyer'});
    expect(bridge.poll()).toEqual([]); expect(before).toHaveBeenCalledOnce();
    bridge.finish(tasks[0].id,{ok:true,data:{messages:[]}}); expect(await result).toEqual({messages:[]});
    expect(bridge.finish(tasks[0].id,{ok:true,data:{}})).toBe(false); bridge.disconnect();
  });
  it('distinguishes undispatched operations from uncertain in-flight sends', async () => {
    const bridge=new ExtensionBridge(); bridge.connect('buyer');
    const first=bridge.call(['seller','inquire','123','hi','--to','seller'],async()=>{}, {jobId:'first'}).catch(e=>e);
    const second=bridge.call(['seller','messages','--offer','456'],async()=>{}, {jobId:'second'}).catch(e=>e); await flush();
    bridge.poll(1); bridge.disconnect();
    expect((await first).safeNotSent).toBe(false); expect((await second).safeNotSent).toBe(true);
  });
  it('never queues a canceled guard or non-inquiry action', async () => {
    const bridge=new ExtensionBridge(); bridge.connect('buyer');
    await expect(bridge.call(['checkout','confirm','123'],async()=>{})).rejects.toThrow('非询盘');
    await expect(bridge.call(['seller','messages','--offer','123'],async()=>{throw new Error('paused');})).rejects.toThrow('paused');
    expect(bridge.tasks.size).toBe(0); bridge.disconnect();
  });
  it('expires tasks without redelivery after a service-worker interruption', async () => {
    vi.useFakeTimers(); const bridge=new ExtensionBridge({timeoutMs:20}); bridge.connect('buyer');
    const result=bridge.call(['seller','inquire','123','hi','--to','seller'],async()=>{}).catch(e=>e); await flush();
    bridge.poll(1); await vi.advanceTimersByTimeAsync(30);
    expect((await result).safeNotSent).toBe(false); expect(bridge.tasks.size).toBe(0); bridge.disconnect();
  });
});
describe('extension package and capture', () => {
  it('has the expected stable ID and minimal page-control permissions', async()=>{
    const manifest=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
    const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16).toString('hex').replace(/[0-9a-f]/g,x=>String.fromCharCode(97+parseInt(x,16)));
    expect(id).toBe(EXTENSION_ID); expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toEqual(expect.arrayContaining(['cookies','debugger','nativeMessaging']));
    expect(manifest.host_permissions).toEqual(['https://*.1688.com/*','http://127.0.0.1/*']);
    for(const file of ['worker.js','panel.html','panel.js','content.js','page-hook.js']) expect((await fs.readFile(new URL(`../extension/${file}`,import.meta.url),'utf8')).length).toBeGreaterThan(50);
  });
  it('captures only requested conversation history, not auth frames or unrelated conversations', async()=>{
    class Socket { static OPEN=1;readyState=1;listeners:any={};sent:any[]=[];send(value:any){this.sent.push(JSON.parse(value));} addEventListener(type:string,fn:Function){this.listeners[type]=fn;} receive(data:any){this.listeners.message({data:JSON.stringify(data)});} }
    const window:any={WebSocket:Socket};const context=vm.createContext({window,Date,Map,JSON,String});
    vm.runInContext(await fs.readFile(new URL('../extension/page-hook.js',import.meta.url),'utf8'),context);
    const ws=new window.WebSocket();ws.send(JSON.stringify({lwp:'/reg',headers:{mid:'auth'},body:{token:'secret'}}));ws.receive({headers:{mid:'auth'},body:{token:'secret'}});
    expect(window.__C1688_CAPTURE__.histories).toHaveLength(0);
    ws.send(JSON.stringify({lwp:'/r/MessageManager/listUserMessages',headers:{mid:'h'},body:['right']}));
    ws.receive({headers:{mid:'h'},body:{userMessageModels:[{message:{messageId:'1',cid:'right',content:{contentType:1,text:{content:'hello'}},extension:{sender_nick:'cnalichnseller',token:'do-not-copy'}}},{message:{messageId:'2',cid:'other'}}]}});
    const capture=window.__C1688_CAPTURE__.histories[0]; expect(capture.models).toHaveLength(1);
    expect(JSON.stringify(capture)).not.toMatch(/secret|do-not-copy/);expect(capture.models[0].message.messageId).toBe('1');
    expect(window.__C1688_CAPTURE__.refresh()).toBe(true);
    const refreshed=ws.sent.at(-1);expect(refreshed.lwp).toBe('/r/MessageManager/listUserMessages');expect(refreshed.body).toEqual(['right']);expect(refreshed.headers.mid).not.toBe('h');
    ws.readyState=3;expect(window.__C1688_CAPTURE__.refresh()).toBe(false);
  });
});
