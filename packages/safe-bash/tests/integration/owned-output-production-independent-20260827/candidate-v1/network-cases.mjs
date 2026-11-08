import assert from 'node:assert/strict';
import { createServer, ClientRequest } from 'node:http';
import { setImmediate as turn } from 'node:timers/promises';
import { Shell, MemoryFileSystem, agentCommands, FsError, toByteSource } from 'virtual-bash';
import { createCurlCommand, networkCommands } from 'virtual-bash/commands/network';
import { cases, deferred, outcome, capture, fixture, makeShell } from './core-cases.mjs';
const response = (body = '', dispose = async () => {}, status = 200, headers = []) => ({ status, statusText: status === 200 ? 'OK' : 'test', headers, body: typeof body === 'string' ? toByteSource(body) : body, dispose });

cases.D01 = async (events, values) => {
  const host = fixture(events), fs = new MemoryFileSystem(), closed = new AbortController(), reason = new FsError('EPIPE'), error = capture();
  await fs.mkdir('/work'); closed.abort(reason); let authorizationCalls = 0, transportCalls = 0, responseDisposals = 0, transportCloses = 0, owned = 0, transportAbortedByStdout = false;
  const command = createCurlCommand({ authorize() { authorizationCalls++; return true; }, async transport(request) {
    transportCalls++; owned++; transportAbortedByStdout ||= request.signal.aborted && request.signal.reason === reason;
    request.signal.addEventListener('abort', () => { transportAbortedByStdout ||= request.signal.reason === reason; }, { once: true });
    request.registerCleanup(() => { transportCloses++; owned--; });
    if (request.body) for await (const bytes of request.body) assert.equal(Buffer.from(bytes).toString(), 'upload');
    return response(toByteSource(Buffer.from('00ff410a4200fe0a', 'hex')), async () => { responseDisposals++; }, 200, [['X-Complete', 'yes']]);
  } });
  const context = { ...host.context, command: 'curl', args: ['-T', '-', '-o', '/work/body', '-D', '/work/headers', '-w', '%{http_code}\n', 'http://first.invalid/'], cwd: '/', env: {}, fs, stdin: toByteSource('upload'), stderr: error.sink, stdout: { async write() { throw reason; }, ownedOutput: { consumerClosed: closed.signal, async write() { throw reason; } } } };
  await outcome(command.execute(context)); for (const cleanup of host.hooks) await cleanup();
  await context.stderr.write(Buffer.from('independent'));
  Object.assign(values, { authorizationCalls, transportCalls, transportAbortedByStdout, bodyHex: Buffer.from(await fs.readFile('/work/body')).toString('hex'), headersComplete: Buffer.from(await fs.readFile('/work/headers')).toString().endsWith('X-Complete: yes\r\n\r\n'), stderrIndependent: error.hex().endsWith(Buffer.from('independent').toString('hex')), responseDisposals, transportCloses, ownedResourcesAfter: owned });
};
cases.D02 = async (events, values) => {
  const shell = makeShell(), closed = new AbortController(), gate = deferred(), closing = deferred(); let responseDisposals = 0, requests = 0, writes = 0, postClosePayloadWrites = 0;
  shell.use(networkCommands({ authorize: () => true, async transport(request) {
    requests++; request.registerCleanup(async () => { closing.resolve(); await gate.promise; requests--; events.push('request-close'); });
    return response((async function* () { yield Buffer.from('a'); yield Buffer.from('b'); })(), async () => { responseDisposals++; closing.resolve(); await gate.promise; events.push('response-dispose-finish'); });
  } }));
  const sink = { async write() { if (closed.signal.aborted) postClosePayloadWrites++; writes++; if (writes === 1) closed.abort(new FsError('EPIPE')); } };
  const pending = outcome(shell.exec('curl http://first.invalid/', { stdout: { ...sink, ownedOutput: { ...sink, consumerClosed: closed.signal } } })).then(result => { events.push('public-settle'); return result; });
  await closing.promise; await turn(); assert(!events.includes('public-settle')); gate.resolve(); await pending; await shell.dispose(); events.push('shell-dispose-settle');
  Object.assign(values, { responseDisposals, postClosePayloadWrites, ownedRequestsAfter: requests });
};
cases.D04 = async (events, values) => {
  const fs = new MemoryFileSystem(), shell = new Shell({ fs }).use(agentCommands()), closed = new AbortController(); let releases = 0, opens = 0, reads = 0, owned = 0;
  await fs.writeFile('/one', Buffer.from('one')); await fs.writeFile('/two', Buffer.from('two'));
  fs.readStream = path => { if (path === '/two') opens++; owned++; return (async function* () { try { reads++; yield Buffer.from('a'); reads++; yield Buffer.from('b'); } finally { releases++; owned--; } })(); };
  const sink = { async write() { closed.abort(new FsError('EPIPE')); } };
  await outcome(shell.exec('cat /one /two', { stdout: { ...sink, ownedOutput: { ...sink, consumerClosed: closed.signal } } })); await shell.dispose();
  Object.assign(values, { firstSourceReleases: releases, secondOperandOpens: opens, extraProbeReads: reads - 1, ownedResourcesAfter: owned });
};
cases.N01 = async (events, values) => {
  const shell = makeShell(), gate = deferred(), backing = Buffer.alloc(12), upload = capture(); let transports = 0, sourceOpens = 0;
  const stdin = { [Symbol.asyncIterator]() { sourceOpens++; return (async function* () { Buffer.from('4100ff0a', 'hex').copy(backing, 4); yield backing.subarray(4, 8); await gate.promise; events.push('upload-second-released'); Buffer.from('4200fe0a', 'hex').copy(backing, 4); yield backing.subarray(4, 8); backing.fill(0xcc); events.push('upload-eof'); })(); } };
  shell.use(networkCommands({ authorize: () => true, async transport(request) { transports++; let chunks = 0; for await (const bytes of request.body) { await upload.sink.write(bytes); if (++chunks === 1) { events.push('upload-first-observed'); gate.resolve(); } } return response(); } }));
  const result = await shell.exec('curl -T - http://first.invalid/', { stdin }); assert.equal(result.exitCode, 0); await shell.dispose();
  Object.assign(values, { uploadHex: upload.hex(), transportCalls: transports, uploadReplays: sourceOpens - 1 });
};
cases.N02 = async (events, values) => {
  const shell = makeShell(); let calls = 0, returns = 0, earlyOuterReturns, duplicates = 0;
  const stdin = { [Symbol.asyncIterator]() { return { async next() { calls++; return { done: false, value: Buffer.from(calls === 1 ? 'sent' : 'tail\n') }; }, async return() { if (++returns > 1) duplicates++; return { done: true }; } }; } };
  shell.use(networkCommands({ authorize: () => true, async transport(request) { const iterator = request.body[Symbol.asyncIterator](); const first = await iterator.next(); assert.equal(Buffer.from(first.value).toString(), 'sent'); return response('', async () => { await iterator.return?.(); earlyOuterReturns = returns; }); } }));
  shell.register({ name: 'read-tail', async execute(context) { const next = await context.stdin[Symbol.asyncIterator]().next(); await context.stdout.write(next.value); return { exitCode: 0 }; } });
  const result = await shell.exec('curl -T - http://first.invalid/; read-tail', { stdin }); await shell.dispose();
  Object.assign(values, { followingCommandHex: Buffer.from(result.stdoutBytes).toString('hex'), earlyOuterReturns, outerReturnsAfterInvocation: returns, duplicateReturns: duplicates });
};
cases.N03 = async (events, values) => {
  const shell = makeShell(), controller = new AbortController(), reason = {}, acquired = deferred(), entered = deferred(), releasing = deferred(), gate = deferred(); let payloadWrites = 0, responseDisposals = 0, requestCloses = 0;
  shell.use(networkCommands({ authorize: () => true, async transport(request) { request.registerCleanup(async () => { await gate.promise; requestCloses++; events.push('request-close'); }); entered.resolve(); await acquired.promise; return response('never', async () => { responseDisposals++; releasing.resolve(); await gate.promise; events.push('response-dispose-finish'); }); } }));
  const pending = outcome(shell.exec('curl http://first.invalid/', { signal: controller.signal, stdout: { async write() { payloadWrites++; } } })).then(result => { events.push('public-settle'); return result; });
  await entered.promise; controller.abort(reason); await turn(); assert(!events.includes('public-settle')); acquired.resolve(); await releasing.promise; assert(!events.includes('public-settle')); gate.resolve(); const result = await pending; await shell.dispose();
  Object.assign(values, { callerReasonIdentity: !result.fulfilled && result.reason === reason, payloadWrites, responseDisposals, requestCloses });
};
cases.N04 = async (events, values) => {
  const shell = makeShell(); let authorizationCalls = 0, transportCalls = 0, target = 0, opens = 0, responseDisposals = 0;
  const stdin = { [Symbol.asyncIterator]() { opens++; return toByteSource('upload')[Symbol.asyncIterator](); } };
  shell.use(networkCommands({ limits: { maxRedirects: 0, maxRetries: 0 }, authorize(request) { authorizationCalls++; if (request.url.includes('second.invalid')) target++; return true; }, async transport(request) { transportCalls++; for await (const _chunk of request.body) {} return response('', async () => { responseDisposals++; }, 302, [['Location', 'http://second.invalid/']]); } }));
  const result = await shell.exec('curl -L -T - http://first.invalid/', { stdin }); await shell.dispose();
  Object.assign(values, { authorizationCalls, transportCalls, redirectTargetCalls: target, uploadReplays: opens - 1, exitCode: result.exitCode, responseDisposals });
};
cases.N05 = async (events, values) => {
  const shell = makeShell(); let authorizationCalls = 0, transportCalls = 0, opens = 0, responseDisposals = 0, retryTimers = 0;
  const original = globalThis.setTimeout;
  globalThis.setTimeout = function(callback, delay, ...args) { if (delay === 7000) retryTimers++; return original(callback, delay, ...args); };
  try {
    const stdin = { [Symbol.asyncIterator]() { opens++; return toByteSource('upload')[Symbol.asyncIterator](); } };
    shell.use(networkCommands({ limits: { maxRedirects: 0, maxRetries: 0 }, authorize() { authorizationCalls++; return true; }, async transport(request) { transportCalls++; for await (const _chunk of request.body) {} return response('', async () => { responseDisposals++; }, 503, [['Retry-After', '7']]); } }));
    const result = await shell.exec('curl -f --retry 3 -T - http://first.invalid/', { stdin }); await shell.dispose();
    Object.assign(values, { authorizationCalls, transportCalls, uploadReplays: opens - 1, retryTimers, exitCode: result.exitCode, responseDisposals });
  } finally { globalThis.setTimeout = original; }
};
cases.N06 = async (events, values) => {
  const shell = makeShell(); let authorizationCalls = 0, transportCalls = 0, denied = 0, secrets = 0, disposals = 0;
  shell.use(networkCommands({ authorize(request) { authorizationCalls++; return !request.url.includes('third.invalid'); }, async transport(request) {
    transportCalls++; if (request.url.includes('third.invalid')) denied++;
    if (request.url.includes('second.invalid')) secrets += request.headers.filter(([name]) => ['authorization', 'cookie', 'x-secret'].includes(name.toLowerCase())).length;
    return response('', async () => { disposals++; }, 302, [['Location', request.url.includes('first.invalid') ? 'http://second.invalid/' : 'http://third.invalid/']]);
  } }));
  const result = await shell.exec("curl -L -H 'Authorization: Bearer synthetic' -H 'Cookie: test=synthetic' -H 'X-Secret: synthetic' http://first.invalid/"); await shell.dispose();
  Object.assign(values, { authorizationCalls, transportCalls, deniedTransportCalls: denied, crossOriginSecretHeaders: secrets, publicSuccess: result.exitCode === 0, responseDisposals: disposals });
};
cases.N07 = async (events, values) => {
  const shell = makeShell(), sockets = new Set(), intervals = new Set(); let requests = 0, payloadAfterClose = 0, closed = false;
  const emit = ClientRequest.prototype.emit;
  ClientRequest.prototype.emit = function(name, ...args) { if (name === 'socket') requests++; if (name === 'close') { requests--; events.push('owned-client-close'); closed = true; } return emit.call(this, name, ...args); };
  const server = createServer((_request, response) => { response.writeHead(200); response.write('a'); const interval = setInterval(() => response.write('b'), 5); intervals.add(interval); response.on('close', () => { clearInterval(interval); intervals.delete(interval); }); });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    shell.use(networkCommands({ authorize: request => request.url === url }));
    const result = await shell.exec(`curl ${url} | head -c 1`, { stdout: { async write() { if (closed) payloadAfterClose++; } } }); events.push('public-settle'); assert.equal(result.stdout, 'a'); await shell.dispose();
  } finally {
    for (const interval of intervals) clearInterval(interval);
    const connectionsClosed = Promise.all([...sockets].map(socket => new Promise(resolve => socket.once('close', resolve))));
    const stopping = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await stopping; await connectionsClosed;
    ClientRequest.prototype.emit = emit;
  }
  Object.assign(values, { payloadAfterClose, ownedClientRequestsAfter: requests, ownedServerConnectionsAfterCleanup: sockets.size, ownedServersAfterCleanup: Number(server.listening) });
};
