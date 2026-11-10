import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
export const EXTENSION_ID = 'nhngafipdkeamcmjaabcognfdffhgjoi';
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const error = (message, extra = {}) => Object.assign(new Error(message), extra);

export class ExtensionBridge {
  constructor({ now = Date.now, timeoutMs = 90000 } = {}) {
    this.now = now; this.timeoutMs = timeoutMs; this.token = null; this.lastSeen = 0; this.loginId = null;
    this.tasks = new Map(); this.preparation = Promise.resolve();
  }
  get connected() { return !!this.token && this.now() - this.lastSeen < 15000; }
  connect(loginId) {
    if (typeof loginId !== 'string' || !loginId.trim() || loginId.length > 100 || /[\r\n]/.test(loginId)) throw error('请填写 Chrome 旺旺顶部显示的买家账号。', { status: 400 });
    this.disconnect(); this.token = randomBytes(32).toString('hex'); this.loginId = loginId.trim(); this.lastSeen = this.now();
    return { token: this.token, loginId: this.loginId };
  }
  authorize(value) {
    const a = createHash('sha256').update(String(value ?? '')).digest();
    const b = createHash('sha256').update(this.token ?? '').digest();
    if (!this.token || !timingSafeEqual(a, b)) throw error('插件连接已失效，请点击重新连接。', { status: 401 });
  }
  ready() { if (!this.connected) throw error('请先打开并连接 Chrome 插件侧栏，保持侧栏开启。', { status: 409 }); }
  snapshot() { return { connected: this.connected, loginId: this.loginId, lastSeen: this.lastSeen, pending: this.tasks.size }; }
  async call(args, before, context = {}) {
    this.ready();
    const op = args[1];
    const offerId = op === 'messages' ? args[args.indexOf('--offer') + 1] : args[2];
    if (args[0] !== 'seller' || !['messages', 'inquire'].includes(op) || !/^\d{1,30}$/.test(offerId ?? '')) throw error('插件拒绝非询盘浏览器操作。');
    const preparing = this.preparation.then(async () => { this.ready(); if (before) await before(); this.ready(); });
    this.preparation = preparing.catch(() => {}); await preparing;
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const task = { id, op, offerId, jobId: context.jobId, delivered: false,
        ...(op === 'inquire' ? { text: args[3], sellerLoginId: args[args.indexOf('--to') + 1], initial: !args.includes('--text-only') } : {}), resolve, reject };
      task.timer = setTimeout(() => {
        this.tasks.delete(id);
        reject(error('Chrome 插件操作超时。请到真实会话核对发送结果。', { code: 'EXTENSION_TIMEOUT', safeNotSent: !task.delivered }));
      }, this.timeoutMs);
      this.tasks.set(id, task);
    });
  }
  poll(limit = 1) {
    this.lastSeen = this.now();
    if (Number(limit) <= 0) return [];
    const out = [];
    for (const task of this.tasks.values()) {
      if (task.delivered) continue;
      task.delivered = true;
      const { resolve, reject, timer, delivered, ...payload } = task;
      out.push({ ...payload, loginId: this.loginId });
      if (out.length >= Math.min(2, Math.max(1, Number(limit) || 1))) break;
    }
    return out;
  }
  finish(id, result) {
    const task = this.tasks.get(id);
    if (!task || !task.delivered) return false;
    this.tasks.delete(id); clearTimeout(task.timer);
    if (result.ok) task.resolve(result.data);
    else task.reject(error(String(result.error?.message ?? 'Chrome 操作失败。').slice(0, 1000), {
      code: result.error?.code, exitCode: Number(result.error?.exitCode) || 9,
      safeNotSent: result.error?.safeNotSent === true,
    }));
    return true;
  }
  cancelJob(jobId) {
    for (const [id, task] of this.tasks) {
      if (task.jobId !== jobId || task.delivered) continue;
      clearTimeout(task.timer); this.tasks.delete(id);
      task.reject(error('此会话已由你接管。', { code: 'MANUAL_TAKEOVER', safeNotSent: true, status: 409 }));
    }
  }
  cancelAll(message = '自动化已暂停。') {
    for (const task of this.tasks.values()) {
      clearTimeout(task.timer);
      task.reject(error(message, { code: 'EXTENSION_DISCONNECTED', safeNotSent: !task.delivered }));
    }
    this.tasks.clear();
  }
  disconnect() {
    this.cancelAll('Chrome 插件已断开，自动化已暂停。'); this.token = null; this.lastSeen = 0;
  }
}
