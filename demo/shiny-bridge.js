/* Shiny Workbench bridge. Loaded after Shiny's own scripts inside the VS Code Webview.
 * Every Shiny exchange (WebSocket, session HTTP, downloads) leaves through the
 * Extension Host over postMessage; the Webview opens no network connections. */
(() => {
  const vscode = acquireVsCodeApi();
  const script = document.currentScript;
  let binding = null;
  try { binding = JSON.parse(script?.dataset.binding || 'null'); } catch (_) { binding = null; }
  vscode.setState({binding});

  const post = message => vscode.postMessage(message);
  // Webview diagnostics reach the ERAgent Output channel; they carry no data values.
  const log = message => post({type: 'shiny.log', message: String(message).slice(0, 500)});
  window.addEventListener('error', event => log(`Page error: ${event.message || event.error || 'unknown'}`));
  window.addEventListener('unhandledrejection', event => log(`Unhandled rejection: ${event.reason?.message || event.reason}`));
  if (!window.Shiny) {
    post({type: 'shiny.bridgeError', message: 'Shiny scripts did not load in the Workbench.'});
    return;
  }

  const pending = new Map();
  let nextRequest = 0;
  let socket = null;

  // Relative app path for a URL written by Shiny, DT or selectize; null for anything else.
  function appPath(url) {
    const value = String(url || '');
    if (value.startsWith(document.baseURI)) return value.slice(document.baseURI.length);
    return /^([a-z][a-z0-9+.-]*:|\/)/i.test(value) ? null : value;
  }

  class RelaySocket {
    constructor() {
      this.readyState = 0;
      this.binaryType = 'arraybuffer';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      socket = this;
      post({type: 'shiny.socket.open'});
    }

    send(data) {
      if (this.readyState !== 1) throw new Error('The Shiny Workbench is not connected.');
      post({type: 'shiny.socket.send', data: String(data)});
    }

    close() {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      if (socket === this) socket = null;
      post({type: 'shiny.socket.close'});
      this.onclose?.({code: 1000, reason: ''});
    }
  }
  window.Shiny.createSocket = () => new RelaySocket();

  function toBase64(bytes) {
    let text = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(text);
  }

  async function encodeBody(data) {
    if (data === undefined || data === null) return null;
    if (data instanceof Blob) return toBase64(new Uint8Array(await data.arrayBuffer()));
    return toBase64(new TextEncoder().encode(String(data)));
  }

  function decodeText(base64) {
    const binary = atob(base64 || '');
    return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
  }

  // DataTables paging, selectize search and file uploads send XMLHttpRequests to session/
  // URLs. Intercepting XMLHttpRequest itself covers every jQuery copy a widget may load.
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeAbort = XMLHttpRequest.prototype.abort;

  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    const target = appPath(url);
    this.__shinyRelay = target && target.startsWith('session/') ? {method: String(method).toUpperCase(), url: target, headers: {}} : null;
    return nativeOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) {
    if (this.__shinyRelay) this.__shinyRelay.headers[String(name).toLowerCase()] = String(value);
    return nativeSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.abort = function abort() {
    if (this.__shinyRelay) this.__shinyRelay.aborted = true;
    return nativeAbort.call(this);
  };

  function settle(xhr, response) {
    const text = response.error ? response.error : decodeText(response.body);
    const contentType = response.contentType || 'text/plain';
    const values = {
      readyState: 4, status: response.status, statusText: response.statusText || '',
      responseText: text, response: text, responseURL: '',
    };
    for (const [name, value] of Object.entries(values)) Object.defineProperty(xhr, name, {configurable: true, value});
    Object.defineProperty(xhr, 'getAllResponseHeaders', {configurable: true, value: () => `content-type: ${contentType}\r\n`});
    Object.defineProperty(xhr, 'getResponseHeader', {configurable: true, value: name => String(name).toLowerCase() === 'content-type' ? contentType : null});
    for (const type of ['readystatechange', 'load', 'loadend']) {
      xhr.dispatchEvent(type === 'readystatechange' ? new Event(type) : new ProgressEvent(type));
    }
  }

  XMLHttpRequest.prototype.send = function send(body) {
    const relay = this.__shinyRelay;
    if (!relay) return nativeSend.call(this, body);
    const id = ++nextRequest;
    pending.set(id, response => {
      if (relay.aborted) return;
      log(`${relay.method} ${relay.url.replace(/^session\/[^/]+\//, 'session/:id/').split('?')[0]} ${response.status}${response.error ? ` ${response.error}` : ''}`);
      settle(this, response);
    });
    encodeBody(body).then(encoded => post({
      type: 'shiny.http', id, method: relay.method, url: relay.url,
      contentType: relay.headers['content-type'] || '', body: encoded,
    }), error => {
      pending.delete(id);
      settle(this, {status: 400, error: error.message});
    });
  };

  // downloadHandler links are saved by the Extension Host through VS Code.
  document.addEventListener('click', event => {
    const link = event.target?.closest?.('a.shiny-download-link');
    if (!link) return;
    event.preventDefault();
    const target = appPath(link.getAttribute('href'));
    if (target && target.startsWith('session/')) post({type: 'shiny.download', url: target});
  }, true);

  window.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'shiny.socket.open' && socket) {
      socket.readyState = 1;
      socket.onopen?.({});
    } else if (message.type === 'shiny.socket.message' && socket) {
      socket.onmessage?.({data: message.data});
    } else if (message.type === 'shiny.socket.close' && socket) {
      const closed = socket;
      socket = null;
      closed.readyState = 3;
      closed.onclose?.({code: message.code || 1006, reason: message.reason || ''});
    } else if (message.type === 'shiny.http.response' && pending.has(message.id)) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });
})();
