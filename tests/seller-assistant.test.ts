import { describe, expect, it } from 'vitest';
import { parseOneWsMessage } from '../src/commands/seller-messages.js';

// Sanitized shape from the live 360001 seller-assistant reply. No account IDs.
function message(items = [{ type: 'richText', isLink: 'false', imageUrl: '', content: '是店内同款，支持定制。' }], code = 360001) {
  return { message: { messageId: 'reply-1', createAt: 1794200000000,
    content: { contentType: 101, custom: { summary: '是店内同款，支持定制。', title: '是店内同款，支持定制。', type: 2 } },
    extension: { sender_nick: 'cnalichnseller', bizuniqueID: 'cbu_official_assistant_v1#example', biMsgType: `bc_0_${code}_example`,
      dynamic_msg_content: JSON.stringify([{ platform: 1, templateId: code, templateData: { listData: items, footnote: '智能客户专员' } }]) },
  } };
}
describe('verified seller-assistant reply templates', () => {
  it('classifies the observed pure rich-text reply and preserves its AI origin', () => {
    expect(parseOneWsMessage(message(), 'buyer')).toMatchObject({ kind: 'text', origin: 'sellerAssistant', isMine: false, content: '是店内同款，支持定制。' });
  });
  it('keeps mixed images, links, mismatched summaries and unknown templates for review', () => {
    for (const value of [
      message([{ type: 'richText', isLink: 'false', imageUrl: 'https://example.com/certificate.png', content: '是店内同款，支持定制。' }]),
      message([{ type: 'richText', isLink: 'true', imageUrl: '', content: '是店内同款，支持定制。' }]),
      message([{ type: 'richText', isLink: 'false', imageUrl: '', content: '不同内容' }]),
      message(undefined, 999999),
    ]) expect(parseOneWsMessage(value, 'buyer')).toMatchObject({ kind: 'other' });
  });
  it('marks platform sample-coupon notices as nonbusiness auto replies', () => {
    expect(parseOneWsMessage(message(undefined, 389001), 'buyer')).toMatchObject({ kind: 'autoReply', origin: 'platformNotice' });
  });
  it('recognizes the observed mobile smart-reception hold message and platform wait notice', () => {
    const value = message(); value.message.extension.bizuniqueID = 'wireless-wwpush-qcxy#example';
    expect(parseOneWsMessage(value, 'buyer')).toMatchObject({ kind: 'text', origin: 'sellerAssistant' });
    expect(parseOneWsMessage({ message: { content: { contentType: 1, text: { content: '商家长时间没有回复，平台已通知商家，请耐心等待' } } } }, 'buyer')).toMatchObject({ kind: 'autoReply', origin: 'platformNotice' });
  });
});
