/* Native Webview transport. The service credential stays in the extension host. */
function canvasFetch(path, options = {}) {
  if (window.canvasHostRequest) return window.canvasHostRequest(path, options);
  return fetch(new URL(path.replace(/^\//, ''), document.baseURI), {
    ...options,
    headers: {Authorization: `Bearer ${token}`, ...options.headers},
  });
}

function canvasHostMessage(event) {
  // VS Code hides the real parent by assigning window.parent = window.
  // Its relay retains the Webview origin; embedded frames are never the host.
  return event.origin === window.origin && ![...document.querySelectorAll('iframe')]
    .some(frame => frame.contentWindow === event.source);
}

(() => {
  if (typeof acquireVsCodeApi !== 'function') return;
  const host = acquireVsCodeApi();
  const pending = new Map();
  window.canvasHostSend = message => host.postMessage(message);
  window.canvasHostRequest = (path, options = {}) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('连接超时，请重新打开 Canvas 后确认操作结果。'));
    }, 125000);
    pending.set(requestId, {resolve, reject, timer});
    try {
      host.postMessage({
        type: 'demo.request', requestId, path,
        method: options.method || 'GET', body: options.body,
      });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(error);
    }
  });
  window.addEventListener('message', event => {
    if (!canvasHostMessage(event)) return;
    const message = event.data;
    if (message?.type !== 'demo.response') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.requestId);
    if (message.error) {
      request.reject(new Error(message.error));
      return;
    }
    try {
      const {status, statusText, contentType, body} = message.response;
      const bytes = Uint8Array.from(atob(body), character => character.charCodeAt(0));
      request.resolve(new Response([204, 205, 304].includes(status) ? null : bytes, {
        status, statusText, headers: {'Content-Type': contentType},
      }));
    } catch (_) {
      request.reject(new Error('服务返回了无法读取的内容，请重新打开 Canvas。'));
    }
  });
  window.addEventListener('pagehide', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Canvas 已关闭，请重新打开。'));
    }
    pending.clear();
  });
})();
