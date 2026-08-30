import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Shell, MemoryFileSystem, MockS3Client, S3FileSystem, WebDavFileSystem, agentCommands, createAgentCommands, networkCommands, createNodeHttpTransport } from '/Users/kjopek/Workspace/safe-bash/src/index.ts';
import { MockDav } from '/Users/kjopek/Workspace/safe-bash/tests/fs/webdav/mock.ts';

const scenario = process.argv[2];
const events = [];
const encode = value => new TextEncoder().encode(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`FAIL: ${label} exceeds unchanged 1200ms gate`)), 1200); })]); }
  finally { clearTimeout(timer); }
}
const entered = deferred();
const pending = deferred();
const cleanup = deferred();
const disconnected = deferred();
const signals = new Map();
let shell, server, execution, signal, returned = 0, finalized = 0, acquired = 0, reads = 0, disposed = 0, activeGets = 0;
let failed = false;
const sockets = new Set();
let fs = new MemoryFileSystem();
const payload = encode('never yielded\n');
function pendingSource() {
  return {
    [Symbol.asyncIterator]() { acquired++; return this; },
    next() { reads++; events.push('source.next.pending-before-first-byte'); entered.resolve(); return pending.promise; },
    return() { returned++; events.push('source.return.requested'); return cleanup.promise; },
  };
}
try {
  if (scenario === 'head-direct') {
    const command = createAgentCommands().find(command => command.name === 'head');
    const result = await bounded(command.execute({ command: 'head', args: ['-n', '0'], stdin: pendingSource(), stdinIsDefault: false,
      stdout: { async write() { throw new Error('unexpected stdout'); } }, stderr: { async write() { throw new Error('unexpected stderr'); } },
      cwd: '/', env: {}, fs, signal: new AbortController().signal }), 'direct head');
    assert.equal(result.exitCode, 0); assert.equal(acquired, 0); assert.equal(reads, 0); assert.equal(returned, 0);
    events.push('head.exit0:source.acquire=0:next=0:return=0');
  } else {
    let source, url;
    if (scenario === 'local-generator' || scenario === 'local-pipefail') {
      const generator = (async function* () {
        try { entered.resolve(); events.push('generator.pending-before-first-yield'); await pending.promise; yield payload; }
        finally { finalized++; events.push('generator.finalized'); }
      })();
      source = { [Symbol.asyncIterator]() { acquired++; return this; }, next() { reads++; return generator.next(); },
        return() { returned++; events.push('generator.return.requested'); return generator.return(); } };
    } else if (scenario === 's3-first' || scenario === 's3-middle') {
      const client = new MockS3Client({ buckets: ['first-read'] });
      await client.putObject({ Bucket: 'first-read', Key: 'input', Body: payload });
      const transport = new Proxy(client, { get(target, key) {
        if (key === 'getObjectStream') return async (_input, options) => {
          signal = options.abortSignal; activeGets++; events.push('S3.GET.start');
          signal.addEventListener('abort', () => { activeGets--; events.push('S3.GET.signal.abort'); }, { once: true });
          return { ContentLength: payload.length, Body: pendingSource() };
        };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
      fs = new S3FileSystem({ bucket: 'first-read', transport });
    } else if (scenario === 'dav-first' || scenario === 'curl-first') {
      const mock = new MockDav(); mock.files.set('/input', payload);
      server = createServer((request, response) => {
        void (async () => {
          events.push(`http.request:${request.method}`);
          if (request.method === 'GET') {
            activeGets++; events.push('HTTP.GET.active');
            response.once('close', () => { activeGets--; events.push('HTTP.GET.response.close'); disconnected.resolve(); });
            request.once('aborted', () => events.push('HTTP.GET.request.aborted'));
            response.writeHead(200, { 'Content-Length': String(payload.length), 'Content-Type': 'application/octet-stream' });
            response.flushHeaders(); return;
          }
          const result = await mock.fetch(`http://${request.headers.host}${request.url}`, { method: request.method, headers: new Headers(request.headers) });
          const body = new Uint8Array(await result.arrayBuffer());
          response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(body);
        })().catch(error => { events.push(`fixture.error:${error.message}`); response.destroy(); });
      });
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket); events.push('http.socket.close'); }); });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      url = `http://127.0.0.1:${server.address().port}/dav/input`;
      if (scenario === 'dav-first') fs = new WebDavFileSystem({ baseUrl: url.replace(/input$/, ''), timeoutMs: 6000,
        fetch: async (input, init) => {
          const result = await fetch(input, init);
          if (init.method === 'GET') { signal = init.signal; signal.addEventListener('abort', () => events.push('DAV.GET.signal.abort'), { once: true }); events.push('DAV.GET.headers-without-body'); entered.resolve(); }
          return result;
        },
      });
    } else throw new Error(`unknown scenario ${scenario}`);
    shell = new Shell({ fs, limits: { pipeHighWaterMark: 1 } }).use(agentCommands());
    if (scenario === 'curl-first') {
      const native = createNodeHttpTransport();
      shell.use(networkCommands({ authorize: request => request.url === url,
        transport: async request => {
          signal = request.signal; signal.addEventListener('abort', () => events.push('curl.GET.signal.abort'), { once: true });
          const response = await native(request);
          const iterator = response.body[Symbol.asyncIterator]();
          return { ...response, body: { [Symbol.asyncIterator]() { return this; }, next() { events.push('curl.body.next.pending'); entered.resolve(); return iterator.next(); },
            return() { returned++; events.push('curl.body.return'); return iterator.return(); } },
            async dispose() { disposed++; events.push('curl.response.dispose'); await response.dispose(); },
          };
        },
      }));
      events.push('curl.explicit-plugin:exact-loopback-authorization');
    }
    shell.use(async (context, next) => {
      signals.set(context.command, context.signal);
      if (context.command === 'head') await entered.promise;
      try { return await next(); }
      finally { events.push(`command.settled:${context.command}`); }
    });
    const script = scenario === 'curl-first' ? `curl ${url} | head -n 0`
      : scenario === 'local-pipefail' ? 'set -o pipefail; cat | head -n 0'
      : scenario === 'local-generator' ? 'cat | head -n 0'
      : scenario === 's3-middle' ? 'cat /input | cat | head -n 0' : 'cat /input | head -n 0';
    events.push(`pipeline:${script}`);
    execution = shell.exec(script, source ? { stdin: source } : {});
    void execution.catch(() => {});
    const result = await bounded(execution, 'no-caller-rescue pipeline settlement');
    events.push(`pipeline.settled:exit=${result.exitCode}`);
    assert.equal(result.exitCode, scenario === 'local-pipefail' ? 141 : 0);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    if (scenario === 'dav-first' || scenario === 'curl-first') await bounded(disconnected.promise, 'GET close BEFORE teardown');
    await turn(); await turn();
    assert.equal(activeGets, 0);
    if (signal) assert.equal(signal.aborted, true);
    if (source || scenario.startsWith('s3')) assert.equal(returned, 1);
    if (scenario === 'curl-first') assert.ok(disposed >= 1);
    events.push(`ACCEPTANCE.before-teardown:activeGETs=${activeGets}:return=${returned}:dispose=${disposed}:callerRescue=none`);
  }
} catch (error) {
  failed = true; process.exitCode = 1;
  events.push(`FAILURE.before-teardown:${error.message}:activeGETs=${activeGets}:return=${returned}:stageAborted=${signal?.aborted ?? [...signals.values()].some(signal => signal.aborted)}`);
  console.error(error.stack);
} finally {
  events.push(`fixture.teardown.begin:failed=${failed}`);
  pending.reject(new Error('late next rejection after acceptance-or-recorded-failure'));
  cleanup.reject(new Error('late return rejection after acceptance-or-recorded-failure'));
  void pending.promise.catch(() => {}); void cleanup.promise.catch(() => {});
  if (server) {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections(); for (const socket of sockets) socket.destroy();
    await closed;
  }
  await turn(); await turn();
  await shell?.dispose();
  events.push(`fixture.teardown.end:sockets=${sockets.size}:activeGETs=${activeGets}:finalized=${finalized}`);
  console.log(JSON.stringify({ scenario, verdict: failed ? 'FAIL' : 'PASS', events }));
}
