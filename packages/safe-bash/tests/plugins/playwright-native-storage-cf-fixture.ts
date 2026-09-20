export const storageCloudflareHostSource = `
import { acquire, connect, sessions } from '@cloudflare/playwright';
import { createPlaywrightPrivateTargetTransport, createPlaywrightStorageOriginPreparer } from '@storage/command';
async function acquireStorageBrowser(binding) {
  const { sessionId } = await acquire(binding);
  const sockets = [];
  const nativeSocket = async () => {
    const response = await binding.fetch('http://browser/v1/devtools/browser/' + sessionId, { headers: { Upgrade: 'websocket' } });
    if (!response.webSocket) throw new Error('Native control connection rejected: ' + response.status);
    response.webSocket.accept(); sockets.push(response.webSocket); return response.webSocket;
  };
  const socket = await nativeSocket();
  const pending = new Map(); const listeners = new Set();
  let sequence = 0; let guard;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method) for (const listener of listeners) listener(message);
    if (message.method === 'Target.detachedFromTarget') for (const [id, operation] of pending) {
      if (operation.session !== message.params.sessionId) continue;
      pending.delete(id); clearTimeout(operation.timer); operation.reject(new Error('Native control target detached'));
    }
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id); clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error))); else operation.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error('Native storage control closed')); } pending.clear(); });
  const control = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    send(method, params = {}, session) { return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000);
      pending.set(id, { resolve, reject, timer, session });
      socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    }); },
  };
  const guardedBinding = { async fetch() {
    const native = await nativeSocket();
    const pair = new WebSocketPair(); pair[1].accept(); sockets.push(pair[1]);
    const issued = new Map();
    const identities = new Map(); const recent = [];
    const identity = value => { if (value === undefined) return undefined; if (!identities.has(value)) identities.set(value, 'native-' + (identities.size + 1)); return identities.get(value); };
    const remember = value => { recent.push(value); if (recent.length > 12) recent.shift(); };
    const upstream = { send(message) { issued.set(message.id, { method: message.method, sessionId: message.sessionId }); native.send(JSON.stringify(message)); }, close() { native.close(); } };
    native.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const command = issued.get(message.id);
      if (message.method?.startsWith('Target.')) remember({ event: message.method, envelopeSession: identity(message.sessionId), sessionId: identity(message.params?.sessionId), targetId: identity(message.params?.targetId ?? message.params?.targetInfo?.targetId) });
      if (command && command.sessionId !== message.sessionId) console.error('Native reply identity diagnostic:', JSON.stringify({ command: { id: message.id, method: command.method, sessionId: identity(command.sessionId) }, response: { id: message.id, sessionId: identity(message.sessionId), result: message.result, error: message.error }, recent }));
      if (command) issued.delete(message.id);
      upstream.onmessage?.(message);
    });
    native.addEventListener('close', () => upstream.onclose?.('Native browser connection closed'));
    guard = createPlaywrightPrivateTargetTransport(upstream);
    guard.transport.onmessage = message => pair[1].send(JSON.stringify(message));
    guard.transport.onclose = reason => { console.error('Private transport retirement:', reason); pair[1].close(); };
    pair[1].addEventListener('message', event => guard.transport.send(JSON.parse(event.data)));
    pair[1].addEventListener('close', () => guard.transport.close());
    return new Response(null, { status: 101, webSocket: pair[0] });
  } };
  const browser = await connect(guardedBinding, sessionId);
  const prepareStorageOrigin = createPlaywrightStorageOriginPreparer(control, guard);
  return { browser, prepareStorageOrigin, async release() {
    await browser.close();
    for (const current of sockets) { try { current.close(); } catch {} }
    for (const operation of pending.values()) clearTimeout(operation.timer);
    const response = await binding.fetch('http://browser/v1/devtools/browser/' + sessionId, { method: 'DELETE' });
    if (!response.ok) throw new Error('Browser retirement failed');
    return !(await sessions(binding)).some(session => session.sessionId === sessionId);
  } };
}
`;
