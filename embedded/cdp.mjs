const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function validateSocket(value, port, kind, expectedId) {
  const u = new URL(value);
  const pattern = new RegExp(`^/devtools/${kind}/([A-Za-z0-9_-]+)$`);
  const match = pattern.exec(u.pathname);
  if (u.protocol !== 'ws:' || !LOOPBACK.has(u.hostname) || Number(u.port) !== port ||
      u.username || u.password || u.search || u.hash || !match || (expectedId && match[1] !== expectedId)) {
    throw new Error('Rejected unexpected debugging endpoint');
  }
  return { url: u.href, id: match[1] };
}

export async function fetchDebugJson(port, resource) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !['/json/version','/json/list'].includes(resource)) {
    throw new Error('Invalid debugger discovery request');
  }
  const r = await fetch(`http://127.0.0.1:${port}${resource}`, { redirect:'error', signal:AbortSignal.timeout(1800) });
  if (!r.ok) throw new Error(`Debugger discovery failed: HTTP ${r.status}`);
  const text = await r.text();
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Debugger response too large');
  return JSON.parse(text);
}

export class Cdp {
  #socket; #next = 1; #pending = new Map(); #listeners = new Map();
  constructor(socket) { this.#socket = socket; this.closed = false; }
  static async open(url, { timeoutMs = 2500 } = {}) {
    const socket = new WebSocket(url);
    const session = new Cdp(socket);
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Debugger connection timed out')); }, timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once:true});
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Debugger connection failed')); }, {once:true});
    });
    socket.addEventListener('message', e => session.#receive(e.data));
    socket.addEventListener('close', () => session.#end());
    socket.addEventListener('error', () => session.#end());
    return session;
  }
  #receive(data) {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.id) {
      const waiter = this.#pending.get(msg.id);
      if (!waiter) return;
      clearTimeout(waiter.timer); this.#pending.delete(msg.id);
      if (msg.error) {
        const error=new Error(`CDP ${msg.error.code}: command failed`);
        error.cdpCode=msg.error.code;
        waiter.reject(error);
      }
      else waiter.resolve(msg.result);
    } else if (typeof msg.method === 'string') {
      for (const listener of this.#listeners.get(msg.method) || []) listener(msg.params);
    }
  }
  #end() {
    this.closed = true;
    for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new Error('Debugger disconnected')); }
    this.#pending.clear();
  }
  on(name, listener) {
    const list = this.#listeners.get(name) || []; list.push(listener); this.#listeners.set(name,list);
    return ()=>{const i=list.indexOf(listener);if(i>=0)list.splice(i,1);};
  }
  send(method, params = {}, timeoutMs = 2200) {
    if (this.closed) return Promise.reject(new Error('Debugger disconnected'));
    const id = this.#next++;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); },timeoutMs);
      this.#pending.set(id,{resolve,reject,timer});
      try { this.#socket.send(JSON.stringify({id,method,params})); }
      catch (e) { clearTimeout(timer); this.#pending.delete(id); reject(e); }
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (r.exceptionDetails) throw new Error('Renderer evaluation failed');
    return r.result?.value;
  }
  close() { this.#end(); this.#socket.close(); }
}
