(() => {
  if (window.__C1688_CAPTURE__) return;
  const state = window.__C1688_CAPTURE__ = { histories: [] };
  const Native = window.WebSocket;
  let historySocket = null, historyRequest = null;
  state.refresh = () => {
    if (!historySocket || historySocket.readyState !== Native.OPEN || !historyRequest) return false;
    const request = { ...historyRequest, headers: { ...historyRequest.headers, mid: `ext-${Date.now()}-${Math.random().toString(16).slice(2)}` } };
    historySocket.send(JSON.stringify(request));
    return true;
  };
  function selected(model) {
    const m = model.message ?? {}, e = m.extension ?? {}, c = m.content ?? {};
    return { readStatus: model.readStatus, recallFeature: model.recallFeature,
      message: { messageId: m.messageId, createAt: m.createAt, cid: m.cid,
        content: { contentType: c.contentType, text: c.text ? { content: String(c.text.content ?? '').slice(0, 10000) } : undefined,
          custom: c.custom ? { summary: String(c.custom.summary ?? '').slice(0, 10000), title: String(c.custom.title ?? '').slice(0, 10000), type: c.custom.type } : undefined },
        extension: { sender_nick: e.sender_nick, senderNickName: e.senderNickName, bizuniqueID: e.bizuniqueID, biMsgType: e.biMsgType,
          dynamic_msg_content: typeof e.dynamic_msg_content === 'string' && e.dynamic_msg_content.length <= 100000 ? e.dynamic_msg_content : undefined } } };
  }
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      const requests = new Map();
      const send = this.send;
      this.send = (raw) => {
        try {
          const data = JSON.parse(raw);
          if (data.lwp === '/r/MessageManager/listUserMessages') {
            requests.set(String(data.headers?.mid), Array.isArray(data.body) ? data.body[0] : null);
            historySocket = this; historyRequest = data;
          }
          if (requests.size > 100) requests.delete(requests.keys().next().value);
        } catch { /* auth and other socket traffic is not collected */ }
        return send.call(this, raw);
      };
      this.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data), mid = String(data.headers?.mid);
          if (!requests.has(mid) || !Array.isArray(data.body?.userMessageModels)) return;
          const cid = requests.get(mid); requests.delete(mid);
          const models = data.body.userMessageModels.filter((m) => !cid || !m.message?.cid || m.message.cid === cid).slice(-200).map(selected);
          state.histories.push({ cid, at: Date.now(), models }); state.histories = state.histories.slice(-5);
        } catch { /* no raw auth frames, cookies or credentials leave this hook */ }
      });
    }
  };
})();
