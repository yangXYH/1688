import { beforeEach, describe, expect, it, vi } from 'vitest';
const { dispatchMock, emitMock } = vi.hoisted(() => ({ dispatchMock: vi.fn(), emitMock: vi.fn() }));
vi.mock('../src/session/dispatch.js', () => ({ dispatch: dispatchMock }));
vi.mock('../src/session/state.js', () => ({ readState: async () => ({ nick: 'buyer' }) }));
vi.mock('../src/session/wait.js', () => ({ sleep: async () => {} }));
vi.mock('../src/io/output.js', () => ({ emit: emitMock, info: vi.fn(), isJson: () => true }));
import { run as inquire } from '../src/commands/seller-inquire.js';
import { run as messages } from '../src/commands/seller-messages.js';
beforeEach(() => { dispatchMock.mockReset(); emitMock.mockReset(); });
describe('offer-scoped supplier dialogue CLI adapter', () => {
  it('retains the default product card and sends text only for explicit followups', async () => {
    dispatchMock.mockResolvedValue({ ok: true, sentTo: 'seller', sentAt: 'now' });
    await inquire({ offerId: '123', to: 'seller', message: '问题' });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[0][1]).toMatchObject({ offerId: '123', sellerLoginId: 'seller', message: 'https://detail.1688.com/offer/123.html' });
    dispatchMock.mockClear();
    await inquire({ offerId: '123', to: 'seller', message: '后续问题', textOnly: true });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toMatchObject({ offerId: '123', sellerLoginId: 'seller', message: '后续问题' });
    expect(emitMock.mock.calls.at(-1)?.[0].data).toMatchObject({ ok: true, sentTo: 'seller', question: '后续问题', productUrl: 'https://detail.1688.com/offer/123.html' });
  });
  it('adds the resolved supplier identity while preserving existing message fields', async () => {
    dispatchMock.mockResolvedValueOnce({ offerLoginId: 'supplier-123' }).mockResolvedValueOnce({ conversation: '店铺', total: 0, messages: [] });
    await messages({ offer: '123' });
    expect(emitMock.mock.calls[0][0].data).toEqual({ conversation: '店铺', sellerLoginId: 'supplier-123', total: 0, messages: [] });
  });
  it('opens the visible conversation list for inspection without requiring a seller or sending', async () => {
    dispatchMock.mockResolvedValue({ conversation: '旺旺会话列表（人工查看）', total: 0, messages: [] });
    await messages({ inspect: true });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith('seller-messages', expect.objectContaining({ searchNames: [], inspect: true }), { headed: true, profile: undefined });
    await expect(messages({ inspect: true, watch: true })).rejects.toMatchObject({ code: 'BAD_INPUT' });
  });
});
