#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductWorkbook } from './web-export.mjs';
import { root as sessionRoot } from '../dist/session/paths.js';
import { SupplierDialogue } from './supplier-dialogue.mjs';
import { ExtensionBridge, EXTENSION_ID, EXTENSION_ORIGIN } from './extension-bridge.mjs';
import { encodeGbkPercent } from '../dist/util/encoding.js';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const RUNTIME = path.resolve(sessionRoot());
const UPLOADS = path.join(RUNTIME, 'ui-uploads');
const LOGIN_QR = path.join(RUNTIME, 'login-qr.png');
const HOST = '127.0.0.1';
const PORT = Number(process.env.BB1688_UI_PORT ?? 4173);
const MAX_BODY = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LOGIN_TIMEOUT_MS = 330_000;
const EXPORT_SCHEMA_VERSION = 2;
const MAX_RESULTS = 1000;

let cliQueue = Promise.resolve();
let lastStatus = { connected: false, daemonRunning: false, checkedAt: null, sessionPath: RUNTIME };
let loginFlow = {
  state: 'idle',
  message: '',
  startedAt: null,
  finishedAt: null,
};
let loginChild = null;
const inquirySearches = new Map();

function attachInquirySource(data, keyword, filters) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const offers = Array.isArray(data.offers) ? data.offers : [];
  inquirySearches.set(id, { id, keyword, createdAt, filters, offers });
  while (inquirySearches.size > 20) inquirySearches.delete(inquirySearches.keys().next().value);
  return { ...data, inquirySource: { id, keyword, createdAt } };
}

function serializeCli(task) {
  const run = cliQueue.then(task);
  cliQueue = run.catch(() => {});
  return run;
}

function runCli(args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        BB1688_HOME: RUNTIME,
        BB1688_JSON: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('采集命令超时，请稍后重试。'));
    }, timeoutMs);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    }

    child.stdout.on('data', (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > 24 * 1024 * 1024) {
        child.kill();
        finish(new Error('采集结果过大，请减少结果数量。'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= 128 * 1024) stderr.push(chunk);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      finish(null, result);
    });
  });
}

function loginSnapshot() {
  return { ...loginFlow, running: loginFlow.state === 'starting' || loginFlow.state === 'waiting' };
}

async function startLoginFlow() {
  const startedAt = new Date().toISOString();
  loginFlow = {
    state: 'starting',
    message: '正在释放后台会话并打开 1688 登录窗口…',
    startedAt,
    finishedAt: null,
    qrVersion: null,
  };

  try {
    // The persistent daemon owns this profile's lock. Release it before the
    // interactive login opens the same profile; login restarts it on success.
    parseCliJson(await runCli(['daemon', 'stop', '--json']));
    await rm(LOGIN_QR, { force: true });
  } catch (error) {
    loginFlow = { ...loginFlow, state: 'failed', message: errorMessage(error), finishedAt: new Date().toISOString() };
    return;
  }

  const child = spawn(process.execPath, [
    CLI,
    'login',
    '--headed',
    '--force',
    '--timeout',
    '300',
    '--json',
  ], {
    cwd: ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      BB1688_HOME: RUNTIME,
      BB1688_JSON: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  loginChild = child;

  const stdout = [];
  const stderr = [];
  let stdoutSize = 0;
  let stderrSize = 0;
  let settled = false;
  let timedOut = false;
  let progressLine = '';

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, LOGIN_TIMEOUT_MS);

  function finish(state, message) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    loginChild = null;
    loginFlow = {
      state,
      message,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  child.stdout.on('data', (chunk) => {
    stdoutSize += chunk.length;
    if (stdoutSize <= 128 * 1024) stdout.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrSize += chunk.length;
    if (stderrSize <= 128 * 1024) stderr.push(chunk);
    progressLine += chunk.toString('utf8');
    const lines = progressLine.split('\n');
    progressLine = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('QR saved as PNG:')) {
        loginFlow = { ...loginFlow, state: 'waiting', qrVersion: Date.now(), message: '请用 1688 或淘宝 App 扫描下方二维码，并在手机上确认登录。' };
      }
    }
  });
  child.on('error', (error) => finish('failed', errorMessage(error)));
  child.on('close', (code) => {
    const result = {
      code: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    };
    if (timedOut) {
      finish('failed', '扫码等待超时，请点击“扫码登录”重试。');
      return;
    }
    if (code === 0) {
      try {
        parseCliJson(result);
        finish('succeeded', '1688 登录完成，正在刷新会话状态。');
      } catch (error) {
        finish('failed', errorMessage(error));
      }
      return;
    }
    let message = result.stderr.trim() || `登录窗口已结束，退出码 ${code ?? 1}。`;
    try {
      parseCliJson(result);
    } catch (error) {
      message = errorMessage(error);
    }
    finish(code === 130 ? 'canceled' : 'failed', message);
  });
}

function assertLoginNotRunning() {
  if (loginFlow.state === 'starting' || loginFlow.state === 'waiting') {
    throw Object.assign(new Error('请先在弹出的 1688 登录窗口完成扫码。'), { status: 409 });
  }
}

function parseCliJson(result) {
  if (result.code !== 0) {
    // Doctor writes its actionable checks to stdout before exiting with an
    // empty DOCTOR_FAILED error on stderr. Preserve those diagnostics.
    let report;
    try { report = JSON.parse(result.stdout.trim()); } catch { /* not a doctor report */ }
    const failedChecks = report?.ok === false && Array.isArray(report.checks)
      ? report.checks.filter((check) => check.status === 'fail') : [];
    if (failedChecks.length) {
      const message = failedChecks.map((check) => `${check.name}: ${check.message}${check.fix ? `；处理方式：${check.fix}` : ''}`).join('\n');
      throw Object.assign(new Error(`环境自检未通过：\n${message}`), { code: 'DOCTOR_FAILED', exitCode: result.code, details: { checks: failedChecks } });
    }
    // CLI failures are JSON on stderr; stdout may contain partial success data.
    const candidates = [result.stderr.trim(), ...result.stderr.trim().split('\n').reverse(), result.stdout.trim()];
    for (const candidate of candidates) {
      let payload;
      try { payload = JSON.parse(candidate); } catch { continue; }
      const failure = payload?.error && typeof payload.error === 'object' ? payload.error : payload;
      if (failure?.message || failure?.code) {
        throw Object.assign(new Error(failure.message || `命令失败，退出码 ${result.code}。`), { code: failure.code, exitCode: result.code });
      }
    }
    throw Object.assign(new Error(result.stderr.trim() || `命令失败，退出码 ${result.code}。`), { exitCode: result.code });
  }
  const output = result.stdout.trim();
  if (!output) {
    throw new Error(result.stderr.trim() || '1688 没有返回结果。');
  }
  try {
    const payload = JSON.parse(output);
    return payload;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(result.stderr.trim() || '无法读取 1688 返回的数据。');
    }
    throw error;
  }
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function errorMessage(error) {
  const message = String(error?.message ?? error ?? '请求失败。');
  if (error?.code === 'LOCK_BUSY' || /another 1688 command is running/i.test(message)) {
    return '1688 浏览器会话仍被其他任务占用，请结束该任务后重新扫码登录。';
  }
  if (error?.code === 'LOGIN_TIMEOUT' || /login timed out/i.test(message)) {
    return '扫码等待超时，请点击“扫码登录”重新生成二维码。';
  }
  if (error?.code === 'CANCELED' || /login cancel/i.test(message)) {
    return '登录窗口已关闭，扫码登录已取消。';
  }
  if (error?.code === 'NOT_LOGGED_IN' || error?.exitCode === 3 || /not logged in|session expired/i.test(message)) {
    return '1688 登录状态已失效，请点击右上角“扫码登录”，并在弹出的窗口完成扫码。';
  }
  if (error?.exitCode === 4 || /risk.control|slider|verification required/i.test(message)) {
    return '1688 当前要求人工验证，请点击右上角“扫码登录”，并在弹出的 1688 窗口完成验证。';
  }
  return message.slice(0, 1000);
}

function assertLocalRequest(req) {
  const port = server.address()?.port ?? PORT;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = String(req.headers.host ?? '').toLowerCase();
  if (!allowedHosts.has(host)) throw Object.assign(new Error('只允许本机访问。'), { status: 403 });

  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw Object.assign(new Error('请求来源无效。'), { status: 403 });
    }
    if (!allowedHosts.has(originHost)) throw Object.assign(new Error('拒绝跨站请求。'), { status: 403 });
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw Object.assign(new Error('拒绝跨站请求。'), { status: 403 });
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('图片或请求内容过大。'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求内容不是有效 JSON。'), { status: 400 });
  }
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function optionalPrice(value, flag, args) {
  if (value === undefined || value === null || value === '') return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw Object.assign(new Error('价格筛选请输入 0 到 1,000,000 之间的数字。'), { status: 400 });
  }
  args.push(flag, String(number));
}

function appendSearchFilters(body, args) {
  optionalPrice(body.priceMin, '--price-min', args);
  optionalPrice(body.priceMax, '--price-max', args);
  if (body.priceMin !== '' && body.priceMin != null && body.priceMax !== '' && body.priceMax != null && Number(body.priceMin) > Number(body.priceMax)) {
    throw Object.assign(new Error('最低价不能高于最高价。'), { status: 400 });
  }
  for (const field of ['province', 'city']) {
    const value = String(body[field] ?? '').trim();
    if (value.length > 30) throw Object.assign(new Error('地区名称不能超过 30 个字符。'), { status: 400 });
    if (value) args.push(`--${field}`, value);
  }
  if (body.verified && ['factory', 'business', 'super-factory'].includes(body.verified)) {
    args.push('--verified', body.verified);
  }
  if (body.excludeAds === true) args.push('--exclude-ads');
}

function validateImageUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw Object.assign(new Error('请输入有效的图片 URL。'), { status: 400 });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw Object.assign(new Error('图片链接需使用公开的 HTTPS 地址。'), { status: 400 });
  }
  if (/^(localhost|.*\.localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname)) {
    throw Object.assign(new Error('图片地址不能指向本机或内网。'), { status: 400 });
  }
  return url.href;
}

function validateImageBytes(bytes, mime) {
  const jpeg = mime === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = mime === 'image/png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = mime === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) {
    throw Object.assign(new Error('图片格式需为 JPEG、PNG 或 WebP。'), { status: 400 });
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('图片不能超过 8 MB。'), { status: 413 });
  return mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
}

async function createUploadedImage(body) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.imageData ?? ''));
  if (!match) throw Object.assign(new Error('请选择 JPEG、PNG 或 WebP 图片。'), { status: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  const ext = validateImageBytes(bytes, match[1]);
  await mkdir(UPLOADS, { recursive: true });
  const imagePath = path.join(UPLOADS, `${randomUUID()}.${ext}`);
  await writeFile(imagePath, bytes, { flag: 'wx' });
  return imagePath;
}

function sendStatic(res, filename) {
  const types = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'supplier-ui.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8', 'extension-install.html':'text/html; charset=utf-8', 'extension-install.js':'text/javascript; charset=utf-8', 'extension-install.css':'text/css; charset=utf-8' };
  return readFile(path.join(WEB, filename)).then((body) => {
    res.writeHead(200, {
      'content-type': types[filename],
      'content-length': body.length,
      'cache-control': 'no-cache',
      'content-security-policy': "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    res.end(body);
  });
}

const extensionBridge = new ExtensionBridge();
const dialogue = new SupplierDialogue({ directory: RUNTIME, browserReady: async () => extensionBridge.ready(), cli: (args, before, context) => {
  if (dialogue.transport === 'extension') return extensionBridge.call(args, before, context);
  return serializeCli(async () => {
  assertLoginNotRunning();
  if (before) await before();
  return parseCliJson(await runCli(args));
}); } });
await dialogue.init();
if (process.env.BB1688_MODEL_ENDPOINT && process.env.BB1688_MODEL_NAME) {
  dialogue.configure({ endpoint: process.env.BB1688_MODEL_ENDPOINT, model: process.env.BB1688_MODEL_NAME, apiKey: process.env.BB1688_MODEL_KEY ?? '', workers: 2 });
}
const dialogueTimer = setInterval(() => {
  if (dialogue.transport === 'extension' && dialogue.running && !extensionBridge.connected) {
    dialogue.pause('Chrome 插件已断开，自动化暂停。请重新打开插件侧栏。'); extensionBridge.cancelAll();
  }
  dialogue.tick();
}, 1000);
dialogueTimer.unref();

async function startSearchBatch(body, transport = 'cli') {
  if (transport === 'cli' && dialogue.transport === 'extension') throw Object.assign(new Error('已切换为 Chrome 插件模式，请从插件启动，避免混用浏览器。'), { status: 409 });
  if (!dialogue.config) throw Object.assign(new Error('请先配置模型，再启动询盘。'), { status: 400 });
  if (dialogue.running || dialogue.starting || dialogue.active.size) throw Object.assign(new Error('请暂停并等待当前操作结束后再启动。'), { status: 409 });
  const source = inquirySearches.get(body.sourceId);
  if (!source || Date.now() - Date.parse(source.createdAt) > 7200000) throw Object.assign(new Error('搜索结果已过期，请重新搜索或读取当前搜索页。'), { status: 409 });
  if (!Array.isArray(body.offerIds) || body.offerIds.length < 1 || body.offerIds.length > 100 || body.offerIds.some((id) => typeof id !== 'string' || !source.offers.some((o) => String(o.offerId) === id))) throw Object.assign(new Error('询盘对象必须来自本次搜索结果，每批 1 到 100 件。'), { status: 400 });
  if (body.approvedTemplates !== true) throw Object.assign(new Error('请先查看并授权对象和话术。'), { status: 400 });
  const maxSends = body.maxSends ?? 100;
  if (!Number.isInteger(maxSends) || maxSends < 1 || maxSends > 1000) throw Object.assign(new Error('发送上限应为 1 到 1000 条。'), { status: 400 });
  if (transport === 'extension') extensionBridge.ready();
  const targets = [...new Set(body.offerIds)];
  const provenance = { searchId: source.id, keyword: source.keyword, createdAt: source.createdAt, filters: source.filters };
  await dialogue.create({ targets, mode: 'automatic', approvedTemplates: true, needsCertificate: body.needsCertificate !== false, source: provenance, autoClarify: body.approvedClarifications === true });
  const jobs = dialogue.jobs.filter((j) => targets.includes(j.offerId));
  for (const job of jobs) {
    const offer = source.offers.find((o) => String(o.offerId) === job.offerId);
    if (!job.source) job.source = provenance;
    job.mode = 'automatic'; job.autoClarify = body.approvedClarifications === true;
    if (job.phase === 'draft' && job.draft.text === job.questions[job.step]?.text) job.draft.approved = true;
    job.title = String(offer.title ?? '').slice(0, 300);
    job.searchHistory = [...(job.searchHistory ?? []).filter((s) => s.searchId !== source.id), provenance].slice(-10);
    if (job.phase === 'review' && job.outbox?.status === 'sent') await dialogue.action(job.id, { action: 'refresh' });
  }
  await dialogue.persist();
  const jobIds = jobs.map((j) => j.id);
  if (jobs.some((j) => !['qualified', 'rejected', 'duplicate', 'stopped', 'manual'].includes(j.phase))) await dialogue.start(maxSends, jobIds, transport);
  return { ...dialogue.snapshot(), triggeredJobIds: jobIds };
}

async function extensionRequest(req, res, url) {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (![ `127.0.0.1:${server.address().port}`, `localhost:${server.address().port}` ].includes(host) || req.headers.origin !== EXTENSION_ORIGIN) {
    return sendJson(res, 403, { message: '只接受已安装的采货台 Chrome 插件。' });
  }
  res.setHeader('access-control-allow-origin', EXTENSION_ORIGIN);
  res.setHeader('vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-1688-bridge' }); return res.end();
  }
  if (req.method !== 'POST') return sendJson(res, 405, { message: '只接受 POST。' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('无效插件请求。'), { status: 400 });
  if (url.pathname === '/api/extension/connect') {
    if (dialogue.active.size) throw Object.assign(new Error('请等待当前操作结束后连接。'), { status: 409 });
    let expected = null; try { expected = JSON.parse(await readFile(path.join(RUNTIME, 'state.json'), 'utf8')).nick ?? null; } catch { /* fresh home */ }
    const loginId = body.loginId || expected;
    if (expected && loginId !== expected) throw Object.assign(new Error(`为避免混用历史，请登录当前采购账号 ${expected}；其他账号需使用独立会话目录。`), { status: 409 });
    dialogue.pause('已连接 Chrome 插件，请在插件中选择搜索对象并启动。');
    dialogue.transport = 'extension';
    await dialogue.persist();
    return sendJson(res, 200, { ...extensionBridge.connect(loginId), extensionId: EXTENSION_ID });
  }
  extensionBridge.authorize(req.headers['x-1688-bridge']);
  let result;
  switch (url.pathname) {
    case '/api/extension/state': result = { ...dialogue.snapshot(), bridge: extensionBridge.snapshot() }; break;
    case '/api/extension/config': dialogue.configure(body); result = { config: dialogue.snapshot().config }; break;
    case '/api/extension/search-url': {
      const keyword = String(body.keyword ?? '').trim();
      if (!keyword || keyword.length > 100) throw Object.assign(new Error('关键词需要 1 到 100 字。'), { status: 400 });
      result = { url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeGbkPercent(keyword)}` }; break;
    }
    case '/api/extension/register-search': {
      const page = new URL(String(body.url));
      if (page.hostname !== 's.1688.com' || page.protocol !== 'https:' || !page.pathname.includes('offer_search')) throw Object.assign(new Error('请先在 1688 商品搜索页读取结果。'), { status: 400 });
      if (typeof body.keyword !== 'string' || body.keyword.length > 100 || !Array.isArray(body.offers) || !body.offers.length || body.offers.length > 100 || body.offers.some((o) => !/^\d{1,30}$/.test(String(o.offerId)) || typeof o.title !== 'string' || o.title.length > 500)) throw Object.assign(new Error('搜索结果无效。'), { status: 400 });
      result = attachInquirySource({ offers: body.offers.map((o) => ({ offerId: String(o.offerId), title: o.title, supplier: { name: String(o.supplier?.name ?? '').slice(0, 200) } })) }, body.keyword, { transport: 'extension', url: page.href }); break;
    }
    case '/api/extension/start': result = await startSearchBatch(body, 'extension'); break;
    case '/api/extension/pause': dialogue.pause('你已从 Chrome 插件暂停。'); extensionBridge.cancelAll(); await dialogue.persist(); result = { ok: true }; break;
    case '/api/extension/action':
      if (!['takeover', 'resume-browser', 'accept', 'reject', 'refresh', 'approve', 'reply', 'sent', 'not-sent', 'retry'].includes(body.action)) throw Object.assign(new Error('无效会话操作。'), { status: 400 });
      if (body.action === 'takeover') extensionBridge.cancelJob(body.id);
      await dialogue.action(body.id, body); result = { ok: true }; break;
    case '/api/extension/resume':
      await dialogue.start(body.maxSends ?? 100, body.jobIds ?? null, 'extension'); result = { ok: true }; break;
    case '/api/extension/poll': result = { tasks: dialogue.running ? extensionBridge.poll(body.limit) : (extensionBridge.lastSeen = Date.now(), []), running: dialogue.running }; break;
    case '/api/extension/permit': {
      const task = extensionBridge.tasks.get(body.id);
      const job = task && dialogue.jobs.find((j) => j.id === task.jobId);
      result = { allowed: !!(task?.delivered && dialogue.running && job && !job.manual) }; break;
    }
    case '/api/extension/result': {
      const task = extensionBridge.tasks.get(body.id);
      if (body.ok && task?.op === 'messages') {
        const data = body.data;
        if (!data || typeof data.sellerLoginId !== 'string' || data.sellerLoginId.length > 100) throw Object.assign(new Error('卖家身份无效。'), { status: 400 });
        let messages = data.messages;
        if (Array.isArray(data.models)) {
          if (data.models.length > 200) throw Object.assign(new Error('消息过多。'), { status: 400 });
          const { parseOneWsMessage } = await import('../dist/commands/seller-messages.js');
          messages = data.models.map((m) => parseOneWsMessage(m, extensionBridge.loginId)).filter(Boolean).map(({ _sortMs, ...m }) => m);
        }
        if (!Array.isArray(messages) || messages.length > 200 || messages.some((m) => typeof m.content !== 'string' || m.content.length > 10000 || typeof m.isMine !== 'boolean')) throw Object.assign(new Error('消息格式无效。'), { status: 400 });
        body.data = { conversation: data.sellerLoginId, sellerLoginId: data.sellerLoginId, messages, total: messages.length };
      }
      result = { accepted: extensionBridge.finish(body.id, body) }; break;
    }
    case '/api/extension/disconnect': dialogue.pause('Chrome 侧栏已关闭，自动化暂停。'); extensionBridge.disconnect(); result = { ok: true }; break;
    default: return sendJson(res, 404, { message: '插件接口不存在。' });
  }
  return sendJson(res, 200, result);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, exportSchemaVersion: EXPORT_SCHEMA_VERSION, offerDedupeVersion: 1 });
    }
    if (url.pathname.startsWith('/api/extension/')) return await extensionRequest(req, res, url);

    assertLocalRequest(req);
    if (req.method === 'GET' && ['/extension-install.html','/extension-install.js','/extension-install.css'].includes(url.pathname)) return await sendStatic(res, url.pathname.slice(1));
    if (req.method === 'GET' && url.pathname === '/extension.zip') {
      const zip = new JSZip();
      for (const file of ['manifest.json','worker.js','page-hook.js','content.js','content.css','panel.html','panel.js','panel.css','README.md']) zip.file(file, await readFile(path.join(ROOT,'extension',file)));
      const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
      res.writeHead(200,{'content-type':'application/zip','content-length':bytes.length,'content-disposition':'attachment; filename="1688-chrome-extension.zip"','cache-control':'no-store'});return res.end(bytes);
    }
    if (req.method === 'GET' && url.pathname === '/api/extension-info') return sendJson(res, 200, { extensionId: EXTENSION_ID, path: path.join(ROOT, 'extension'), ...extensionBridge.snapshot() });

    if (req.method === 'GET' && url.pathname === '/') return await sendStatic(res, 'index.html');
    if (req.method === 'GET' && url.pathname === '/app.js') return await sendStatic(res, 'app.js');
    if (req.method === 'GET' && url.pathname === '/style.css') return await sendStatic(res, 'style.css');
    if (req.method === 'GET' && url.pathname === '/supplier-ui.js') return await sendStatic(res, 'supplier-ui.js');

    if (req.method === 'GET' && url.pathname === '/api/supplier') return sendJson(res, 200, dialogue.snapshot());
    if (req.method === 'POST' && url.pathname.startsWith('/api/supplier/')) {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { message: '问答请求必须是 JSON 对象。' });
      switch (url.pathname) {
        case '/api/supplier/config': dialogue.configure(body); break;
        case '/api/supplier/test': return sendJson(res, 200, { decision: await dialogue.test() });
        case '/api/supplier/jobs': await dialogue.create(body); break;
        case '/api/supplier/start':
          if (dialogue.transport === 'extension') throw Object.assign(new Error('请在 Chrome 插件中恢复自动化。'), { status: 409 });
          await dialogue.start(body.maxSends, body.jobIds ?? null); break;
        case '/api/supplier/from-search': return sendJson(res, 200, await startSearchBatch(body));
        case '/api/supplier/pause': dialogue.pause(); extensionBridge.cancelAll(); await dialogue.persist(); break;
        case '/api/supplier/action': await dialogue.action(body.id, body); break;
        default: return sendJson(res, 404, { message: '问答接口不存在。' });
      }
      return sendJson(res, 200, dialogue.snapshot());
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (loginFlow.state === 'starting' || loginFlow.state === 'waiting') {
        return sendJson(res, 200, { ...lastStatus, connected: false, login: loginSnapshot() });
      }
      return await serializeCli(async () => {
        if (loginSnapshot().running) {
          return sendJson(res, 200, { ...lastStatus, connected: false, login: loginSnapshot() });
        }
        try {
          const who = parseCliJson(await runCli(['whoami', '--json']));
          const daemon = parseCliJson(await runCli(['daemon', 'status', '--json']));
          lastStatus = {
            sessionPath: RUNTIME,
            connected: who.loggedIn === true,
            daemonRunning: daemon.running === true && daemon.reachable === true,
            checkedAt: new Date().toISOString(),
          };
          return sendJson(res, 200, lastStatus);
        } catch (error) {
          lastStatus = {
            ...lastStatus,
            connected: false,
            checkedAt: new Date().toISOString(),
            message: errorMessage(error),
          };
          return sendJson(res, 200, lastStatus);
        }
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/login') {
      return sendJson(res, 200, loginSnapshot());
    }

    if (req.method === 'GET' && url.pathname === '/api/login/qr') {
      if (!loginSnapshot().running || !loginFlow.qrVersion) {
        return sendJson(res, 404, { message: '当前没有可用的登录二维码。' });
      }
      const body = await readFile(LOGIN_QR);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(body);
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      dialogue.pause('扫码登录期间问答已暂停，登录后请手动启动。');
      return await serializeCli(async () => {
        if (loginFlow.state === 'starting' || loginFlow.state === 'waiting') {
          return sendJson(res, 200, loginSnapshot());
        }
        await startLoginFlow();
        return sendJson(res, loginSnapshot().running ? 202 : 500, loginSnapshot());
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/export-products') {
      const body = await readJson(req);
      if (body.schemaVersion !== undefined && body.schemaVersion !== EXPORT_SCHEMA_VERSION) {
        throw Object.assign(new Error('页面与本地服务的导出版本不一致，请更新并重启操作台后重试。'), { status: 409 });
      }
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > MAX_RESULTS ||
          body.rows.some((row) => !Array.isArray(row) || row.length !== 13 || row.some((value) => typeof value !== 'string' || value.length > 10000)) ||
          typeof body.source !== 'string' || body.source.length > 2000 ||
          (body.dedupeOfferIds !== undefined && typeof body.dedupeOfferIds !== 'boolean')) {
        throw Object.assign(new Error('导出数据无效。'), { status: 400 });
      }
      const { buffer, missingImages, exportedCount } = await createProductWorkbook(body.rows, undefined, { source: body.source, dedupeOfferIds: body.dedupeOfferIds === true });
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-length': buffer.length,
        'cache-control': 'no-store',
        'x-missing-images': String(missingImages),
        'x-exported-count': String(exportedCount),
      });
      return res.end(buffer);
    }

    if (req.method === 'POST' && url.pathname === '/api/offer-details') {
      const body = await readJson(req);
      if (!Array.isArray(body.offerIds) || body.offerIds.length < 1 || body.offerIds.length > 5 ||
          body.offerIds.some((id) => typeof id !== 'string' || !/^\d{1,30}$/.test(id))) {
        throw Object.assign(new Error('请选择 1 到 5 件商品查看采购信息。'), { status: 400 });
      }
      return await serializeCli(async () => {
        assertLoginNotRunning();
        return sendJson(res, 200, parseCliJson(await runCli(['offer', ...new Set(body.offerIds), '--json'])));
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/search') {
      const body = await readJson(req);
      const keyword = String(body.keyword ?? '').trim();
      if (!keyword || keyword.length > 100) throw Object.assign(new Error('请输入 1 到 100 个字符的关键词。'), { status: 400 });
      const sort = ['relevance', 'best-selling', 'price-asc', 'price-desc'].includes(body.sort) ? body.sort : 'relevance';
      const max = boundedInt(body.max, 20, 1, MAX_RESULTS);
      const args = ['search', keyword, '--max', String(max), '--sort', sort, '--json', '--pretty'];
      appendSearchFilters(body, args);
      return await serializeCli(async () => {
        assertLoginNotRunning();
        const data = parseCliJson(await runCli(args, max > 50 ? 330_000 : 180_000));
        return sendJson(res, 200, attachInquirySource(data, keyword, { sort, priceMin: body.priceMin, priceMax: body.priceMax, province: body.province, city: body.city, verified: body.verified, excludeAds: body.excludeAds === true }));
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/image-search') {
      const body = await readJson(req);
      const max = boundedInt(body.max, 20, 1, MAX_RESULTS);
      return await serializeCli(async () => {
        assertLoginNotRunning();
        let uploadedPath;
        try {
          let source;
          if (body.imageData) {
            uploadedPath = await createUploadedImage(body);
            source = uploadedPath;
          } else {
            source = validateImageUrl(body.imageUrl);
          }
          const data = parseCliJson(await runCli(['image-search', source, '--max', String(max), '--json', '--pretty'], max > 50 ? 330_000 : 180_000));
          return sendJson(res, 200, data);
        } finally {
          if (uploadedPath) await rm(uploadedPath, { force: true });
        }
      });
    }

    sendJson(res, 404, { message: '页面或接口不存在。' });
  } catch (error) {
    if (res.headersSent) return res.destroy();
    sendJson(res, Number(error?.status) || 500, { message: errorMessage(error) });
  }
});

server.on('error', (error) => {
  console.error(`1688 本地操作台启动失败：${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`1688 本地操作台已启动：http://${HOST}:${server.address().port}`);
  console.log(`当前会话目录：${RUNTIME}`);
  console.log('服务仅监听本机回环地址。按 Ctrl+C 停止。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(dialogueTimer);
    dialogue.pause();
    extensionBridge.disconnect();
    if (loginChild) loginChild.kill();
    server.close(() => process.exit(0));
  });
}
