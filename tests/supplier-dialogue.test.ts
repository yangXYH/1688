import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SupplierDialogue, questionnaire, interpret, modelConfig, validateDecision } from '../scripts/supplier-dialogue.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });
const config = { endpoint: 'https://model.example/v1/chat/completions', model: 'test-model', apiKey: 'test-secret', workers: 2 };
const incoming = (id: string, content = '有的，是同款产品。', kind = 'text') => ({ messageId: id, content, kind, isMine: false, sender: 'seller', time: '2026-11-09 12:00:00' });
const accept = { decision: 'accept', evidence: '有的', reason: '供应商明确回答', reply: '' };
async function harness(decide = vi.fn(async () => accept)) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '1688-dialogue-')); dirs.push(directory);
  let now = Date.now();
  const messages = new Map<string, any[]>();
  const calls: string[][] = [];
  let failure: any = null;
  let queue = Promise.resolve();
  const engine = new SupplierDialogue({ directory, now: () => now, decide,
    cli: (args: string[], before?: () => Promise<void>) => {
      const run = queue.then(async () => {
        if (before) await before();
        calls.push(args);
        if (failure) throw failure;
        if (args[1] === 'messages') { const id = args[args.indexOf('--offer') + 1]; return { sellerLoginId: `seller-${id}`, messages: messages.get(id) || [] }; }
        return { ok: true };
      });
      queue = run.catch(() => {}); return run;
    },
  });
  await engine.init(); engine.configure(config);
  await engine.create({ targets: ['123'], mode: 'automatic', approvedTemplates: true });
  await engine.start();
  return { engine, directory, messages, calls, decide,
    advance: () => { now += 31000; },
    process: async (j = engine.jobs[0]) => { now += 31000; await engine.process(j); },
    fail: (e: any) => { failure = e; },
  };
}

describe('supplier dialogue scheduler', () => {
  it('does not start a doctor or daemon before any targets have been queued', async () => {
    const h = await harness(); h.engine.pause(); h.engine.jobs = [];
    const count = h.calls.length;
    await expect(h.engine.start()).rejects.toThrow('加入问答队列');
    expect(h.calls).toHaveLength(count);
  });
  it('uses the visible browser preflight instead of starting a separate CLI browser',async()=>{
    const h=await harness();h.engine.pause();h.engine.browserReady=async()=>{};
    const before=h.calls.length;await h.engine.start(10,[h.engine.jobs[0].id],'extension');
    expect(h.calls).toHaveLength(before);expect(h.engine.transport).toBe('extension');
  });
  it('preserves a manual takeover while a safely canceled send settles',async()=>{
    const h=await harness();await h.process();const j=h.engine.jobs[0];
    h.engine.cli=async(_args,before)=>{await before();await h.engine.action(j.id,{action:'takeover'});throw Object.assign(new Error('manual'),{safeNotSent:true});};
    await h.process();expect(j.phase).toBe('manual');expect(j.manual).toBe(true);expect(j.outbox.status).toBe('canceled');
    await h.engine.action(j.id,{action:'resume-browser'});expect(j.phase).toBe('draft');expect(j.draft.approved).toBe(false);
  });
  it('retains native Chrome mode and manual takeover across a service restart',async()=>{
    const h=await harness();h.engine.pause();h.engine.transport='extension';
    await h.engine.action(h.engine.jobs[0].id,{action:'takeover'});
    const restored=new SupplierDialogue({directory:h.directory,cli:vi.fn()});await restored.init();
    expect(restored.transport).toBe('extension');expect(restored.running).toBe(false);
    expect(restored.jobs[0].manual).toBe(true);expect(restored.jobs[0].phase).toBe('manual');
    expect(restored.snapshot().config).toBeNull();
  });
  it('reuses an already running healthy daemon instead of failing startup', async () => {
    const h = await harness(); h.engine.pause();
    const cli = vi.fn(async (args) => args[1] === 'status' ? { running: true, reachable: true, versionMatches: true } : { ok: true });
    h.engine.cli = cli; await h.engine.start();
    expect(h.engine.running).toBe(true);
    expect(cli.mock.calls.map(([args]) => args)).toEqual([['doctor', '--no-launch', '--json'], ['daemon', 'status', '--json']]);
  });
  it('handles a concurrent daemon start only after confirming the daemon is reachable', async () => {
    const h = await harness(); h.engine.pause(); let checks = 0;
    h.engine.cli = vi.fn(async (args) => {
      if (args[1] === 'status') return ++checks === 1 ? { running: false } : { running: true, reachable: true, versionMatches: true };
      if (args[1] === 'start') throw Object.assign(new Error('already running'), { code: 'DAEMON_RUNNING' });
      return { ok: true };
    });
    await h.engine.start(); expect(h.engine.running).toBe(true); expect(checks).toBe(2);
  });
  it('completes the questionnaire with isolated evidence and offer-scoped text-only followups', async () => {
    const h = await harness(); const j = h.engine.jobs[0];
    await h.process(); expect(j.phase).toBe('draft');
    expect(h.calls.some((a) => a[1] === 'inquire')).toBe(false);
    for (let step = 0; step < j.questions.length; step++) {
      await h.process(); expect(j.phase).toBe('waiting');
      const send = h.calls.at(-1)!;
      expect(send.slice(0, 3)).toEqual(['seller', 'inquire', '123']);
      expect(send.includes('--text-only')).toBe(step > 0);
      h.messages.set('123', [...(h.messages.get('123') || []), incoming(String(step))]);
      await h.process();
    }
    expect(j.phase).toBe('qualified'); expect(j.answers).toHaveLength(7);
    expect(h.engine.sendCount).toBe(8); // first product link plus seven texts
    expect(h.calls[0]).toEqual(['doctor', '--no-launch', '--json']);
  });

  it('requires exact draft approval by default and rejects stale approvals', async () => {
    const h = await harness(); await h.engine.create({ targets: ['456'] }); const j = h.engine.jobs[1];
    await h.process(j); expect(j.draft.approved).toBe(false);
    h.advance(); h.engine.tick(); await new Promise((r) => setTimeout(r, 15));
    expect(h.calls.filter((a) => a[1] === 'inquire' && a[2] === '456')).toHaveLength(0);
    await expect(h.engine.action(j.id, { action: 'approve', draftId: 'stale', text: '你好' })).rejects.toThrow('草稿已变化');
    await h.engine.action(j.id, { action: 'approve', draftId: j.draft.id, text: '确认是同款吗？' });
    await h.process(j); expect(h.calls.at(-1)).toContain('确认是同款吗？');
  });

  it('does not replay history, own messages or automatic replies', async () => {
    const h = await harness(); h.messages.set('123', [incoming('old')]);
    await h.process(); await h.process();
    h.messages.set('123', [incoming('old'), { ...incoming('mine', h.engine.jobs[0].outbox.text), isMine: true }, incoming('auto', '欢迎光临', 'autoReply')]);
    await h.process(); await h.process(); expect(h.decide).not.toHaveBeenCalled();
    expect(h.engine.jobs[0].step).toBe(0);
  });

  it('routes uncertain answers, attachments and missing IDs to human review', async () => {
    for (const m of [incoming('image', '[image]', 'image'), { ...incoming(''), messageId: undefined }]) {
      const h = await harness(); await h.process(); await h.process(); h.messages.set('123', [m]); await h.process();
      expect(h.engine.jobs[0].phase).toBe('review'); expect(h.decide).not.toHaveBeenCalled();
    }
    const h = await harness(vi.fn(async () => ({ decision: 'review', reason: '反问数量', evidence: '', reply: '请先告知起订量。' })));
    await h.process(); await h.process(); h.messages.set('123', [incoming('new', '要多少？')]); await h.process();
    expect(h.engine.jobs[0]).toMatchObject({ phase: 'review', suggestion: '请先告知起订量。' });
  });

  it('does not turn unsupported model evidence into an accepted answer', async () => {
    const h = await harness(vi.fn(async () => ({ ...accept, evidence: '并不存在的回复' })));
    await h.process(); await h.process(); h.messages.set('123', [incoming('1')]); await h.process();
    expect(h.engine.jobs[0].phase).toBe('review'); expect(h.engine.jobs[0].answers).toHaveLength(0);
  });
  it('ignores welcome messages sent between the product link and the actual question', async () => {
    const h = await harness(); await h.process(); await h.process();
    h.messages.set('123', [incoming('welcome', '您好，在的'), { ...incoming('question', h.engine.jobs[0].outbox.text), isMine: true }]);
    await h.process();
    expect(h.decide).not.toHaveBeenCalled(); expect(h.engine.jobs[0].phase).toBe('waiting');
  });
  it('keeps waiting after a greeting instead of demanding a manual decision', async () => {
    const h = await harness(vi.fn(async () => ({ decision: 'wait', evidence: '您好', reason: '只是问候', reply: '' })));
    await h.process(); await h.process(); h.messages.set('123', [incoming('welcome', '您好')]); await h.process();
    expect(h.engine.jobs[0].phase).toBe('waiting'); expect(h.engine.jobs[0].step).toBe(0);
  });
  it('distinguishes authorized assistant review from a human-confirmed answer', async () => {
    const h = await harness(); const j = h.engine.jobs[0];
    j.phase = 'review'; j.pending = [incoming('reply', '是我们店的同款商品', 'other')];
    await h.engine.action(j.id, { action: 'accept', reviewer: 'assistant' });
    expect(j.answers[0]).toMatchObject({ reviewer: 'assistant', human: false, evidence: '是我们店的同款商品' });
    expect(j.step).toBe(1); expect(j.draft.text).toBe(j.questions[1].text);
  });
  it('automatically asks only one preapproved clarification and never sends model-authored suggestions', async () => {
    const h = await harness(vi.fn(async () => ({ decision: 'review', reason: '需要澄清', evidence: '', reply: '承诺下单一千件' })));
    const j = h.engine.jobs[0]; j.autoClarify = true;
    await h.process(); await h.process(); h.messages.set('123', [incoming('vague', '我们有类似的')]); await h.process();
    expect(j.phase).toBe('draft'); expect(j.draft.text).toBe(j.questions[0].clarification);
    expect(j.draft.text).not.toContain('一千件'); expect(j.step).toBe(0);
    await h.process(); h.messages.set('123', [incoming('still-vague', '需要定制')]); await h.process();
    expect(j.phase).toBe('review'); expect(j.clarifications.product).toBe(1);
  });

  it('persists an uncertain send and never automatically resends after restart', async () => {
    const h = await harness(); await h.process(); h.fail(new Error('send timeout')); await h.process();
    expect(h.engine.running).toBe(false); expect(h.engine.jobs[0].phase).toBe('uncertain');
    const restarted = new SupplierDialogue({ directory: h.directory, cli: vi.fn() }); await restarted.init();
    expect(restarted.running).toBe(false); expect(restarted.jobs[0].phase).toBe('uncertain');
    expect(await fs.readFile(restarted.file, 'utf8')).not.toContain('test-secret');
    await restarted.action(restarted.jobs[0].id, { action: 'not-sent' });
    expect(restarted.jobs[0].draft.approved).toBe(false);
  });

  it.each([3, 4])('stops the whole account on exit %i without retrying', async (exitCode) => {
    const h = await harness(); h.fail(Object.assign(new Error('blocked'), { exitCode })); await h.process();
    expect(h.engine.running).toBe(false); const count = h.calls.length;
    h.engine.tick(); await new Promise((r) => setTimeout(r, 10)); expect(h.calls).toHaveLength(count);
    expect(h.engine.notice).toContain(exitCode === 3 ? '1688 login' : '--headed');
  });

  it('checks pause again inside queued operations before contacting a seller', async () => {
    const h = await harness(); await h.process();
    const operation = h.process(); h.engine.pause(); await operation;
    expect(h.calls.some((a) => a[1] === 'inquire')).toBe(false);
    expect(h.engine.jobs[0].phase).toBe('draft');
  });

  it('honors actual message budget including initial product links', async () => {
    const h = await harness(); h.engine.maxSends = 1; await h.process(); await h.process();
    expect(h.engine.running).toBe(false); expect(h.calls.some((a) => a[1] === 'inquire')).toBe(false);
    expect(h.engine.jobs[0].phase).toBe('draft');
  });

  it('keeps unread model work across pauses and runs two models concurrently', async () => {
    const resolvers: Array<(v: any) => void> = [];
    const decide = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const h = await harness(decide); await h.engine.create({ targets: ['456'], mode: 'automatic', approvedTemplates: true });
    for (const j of h.engine.jobs) { j.phase = 'analyzing'; j.pending = [incoming(j.id)]; }
    h.engine.tick();
    await vi.waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
    expect(h.engine.active.size).toBe(2);
    h.engine.pause(); resolvers.forEach((resolve) => resolve(accept));
    await vi.waitFor(() => expect(h.engine.active.size).toBe(0));
    expect(h.engine.jobs.map((j) => j.phase)).toEqual(['analyzing', 'analyzing']);
    expect(h.engine.jobs.every((j) => j.pending.length === 1)).toBe(true);
  });

  it('deduplicates products, requires template authorization and merges the same supplier', async () => {
    const h = await harness(); await expect(h.engine.create({ targets: ['456'], mode: 'automatic' })).rejects.toThrow('明确授权');
    await h.engine.create({ targets: ['123', 'https://detail.1688.com/offer/456.html'] });
    expect(h.engine.jobs).toHaveLength(2);
    await h.process();
    const j = h.engine.jobs[1];
    // Second job lookup resolves an already-reserved supplier.
    h.engine.jobs[0].sellerLoginId = 'seller-456'; await h.process(j); expect(j.phase).toBe('duplicate');
  });

  it('requires manual recovery for day-long silence and rejects unsafe target input', async () => {
    const h = await harness(); await h.process(); await h.process(); h.engine.jobs[0].waitSince -= 86400001; await h.process();
    expect(h.engine.jobs[0].phase).toBe('timeout');
    await expect(h.engine.create({ targets: ['--help'] })).rejects.toThrow('商品链接');
    expect(questionnaire(false).map((q) => q.id)).toEqual(['product', 'packaging', 'stock', 'dropship', 'invoice']);
  });

  it('alternates new suppliers and existing conversations instead of baselining an entire batch first', async () => {
    const h = await harness();
    await h.engine.create({ targets: Array.from({ length: 30 }, (_, i) => String(500 + i)) });
    const phases: string[] = [];
    h.engine.process = vi.fn(async (j) => { phases.push(j.phase); j.phase = j.phase === 'queued' ? 'draft' : 'waiting'; j.draft = { approved: true }; j.nextAt = Infinity; });
    h.engine.tick(); await vi.waitFor(() => expect(h.engine.active.size).toBe(0));
    h.advance(); h.engine.tick(); await vi.waitFor(() => expect(h.engine.active.size).toBe(0));
    expect(phases).toEqual(['queued', 'queued', 'draft', 'queued']);
  });
  it('only runs the requested search batch and completes it without touching unrelated jobs', async () => {
    const h = await harness(); h.engine.pause();
    await h.engine.create({ targets: ['456'], source: { keyword: '旅行箱', searchId: 'search-1' } });
    const j = h.engine.jobs[1];
    await h.engine.start(10, [j.id]);
    h.engine.process = vi.fn(async (job) => { job.phase = 'qualified'; });
    h.engine.tick(); await vi.waitFor(() => expect(h.engine.active.size).toBe(0));
    h.engine.tick();
    expect(h.engine.process).toHaveBeenCalledTimes(1);
    expect(h.engine.jobs[0].phase).toBe('queued');
    expect(h.engine.running).toBe(false); expect(j.source.keyword).toBe('旅行箱');
  });
});

describe('model adapter', () => {
  it('keeps secrets in request headers, uses a bounded nonredirecting request and validates JSON', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(accept) } }] })));
    const decision = await interpret(config, { questions: questionnaire(), step: 0, answers: [], transcript: [] }, [incoming('1')], fetcher);
    expect(decision).toEqual(accept);
    const opts = fetcher.mock.calls[0][1]; expect(opts.redirect).toBe('error');
    expect(opts.headers.authorization).toBe('Bearer test-secret'); expect(opts.body).not.toContain('test-secret');
  });
  it('rejects unsupported transport, model errors, malformed responses and invented evidence', async () => {
    expect(() => modelConfig({ ...config, endpoint: 'http://public.example/chat' })).toThrow('HTTPS');
    expect(modelConfig({ ...config, endpoint: 'http://127.0.0.1:8000/v1/chat/completions' }).model).toBe('test-model');
    expect(() => validateDecision({ ...accept, evidence: '假的' }, [incoming('1')])).toThrow('供应商原文');
    await expect(interpret(config, { questions: questionnaire(), step: 0, answers: [], transcript: [] }, [], async () => new Response('', { status: 429 }))).rejects.toThrow('HTTP 429');
  });
});
