import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate as turn } from 'node:timers/promises';
import { Shell, CommandRegistry, MemoryFileSystem, structuredCommands, FsError, writeBytes } from 'virtual-bash';
import { networkCommands } from 'virtual-bash/commands/network';
import { cases, count, payload, uploadFile, programs, outputs } from './vectors.mjs';

assert.equal(fileURLToPath(import.meta.resolve('virtual-bash')), process.env.REVIEW_PUBLIC);
assert.equal(fileURLToPath(import.meta.resolve('virtual-bash/commands/network')), process.env.REVIEW_NETWORK);
assert.equal(cases.length, count);

function reusable(bytes, kind, state, options = {}) {
  return (async function* () {
    const slab = kind === 'buffer' ? Buffer.alloc(47, 0x71) : new Uint8Array(47).fill(0x71);
    let offset = 0;
    let index = 0;
    state.opened++;
    try {
      while (offset < bytes.length) {
        slab.fill(0xc3);
        if (index % 3 === 0) { state.empty++; yield slab.subarray(7, 7); slab.fill(0xc3); }
        const length = Math.min([3, 19, 1, 23, 7][index % 5], bytes.length - offset);
        slab.set(bytes.subarray(offset, offset + length), 9);
        state.yields++;
        yield slab.subarray(9, 9 + length);
        slab.fill(0);
        offset += length;
        index++;
        if (options.abort && index === 1) { options.abort(); throw options.reason; }
      }
      if (options.error) throw options.error;
    } finally { slab.fill(0); state.closed++; }
  })();
}
const stateFor = () => ({ opened: 0, closed: 0, yields: 0, empty: 0 });
const hex = bytes => Buffer.from(bytes).toString('hex');
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
const command = args => args.map(quote).join(' ');

async function curlCase(vector, evidence) {
  const fs = new MemoryFileSystem();
  const fileState = stateFor();
  const stdinState = stateFor();
  const controller = new AbortController();
  const reason = new Error('independent-curl-abort');
  const fileSource = () => reusable(uploadFile, vector.kind, fileState);
  fs.readStream = (path, options) => {
    assert.equal(path, '/body');
    assert.ok(options.signal instanceof AbortSignal);
    options.signal.throwIfAborted();
    return fileSource();
  };
  const auth = [];
  const requests = [];
  const disposed = [];
  const active = new Set();
  const abortOptions = vector.guard === 'abort' ? { abort: () => controller.abort(reason), reason } : {};
  const input = reusable(payload, vector.kind, stdinState, abortOptions);
  const expectedBody = vector.input === 'mixed' ? Buffer.concat([payload, Buffer.from('&'), uploadFile]) : payload;
  const limits = { maxBufferBytes: vector.guard === 'replay-limit' ? 256 : 4096, maxUploadBytes: vector.guard === 'upload-limit' ? 128 : 4096, maxTimeMs: 10000 };
  const transport = async request => {
    const index = requests.length;
    const record = { url: request.url, method: request.method, headers: request.headers, hex: '', complete: false };
    requests.push(record);
    active.add(index);
    const chunks = [];
    try {
      for await (const chunk of request.body ?? []) { request.signal.throwIfAborted(); chunks.push(new Uint8Array(chunk)); }
      record.hex = hex(Buffer.concat(chunks));
      record.complete = true;
      const status = index === 0 ? vector.status : 200;
      let target = 'https://alpha.invalid/next';
      if (vector.guard === 'cross-origin') target = 'https://beta.invalid/next';
      if (vector.guard === 'downgrade') target = 'http://alpha.invalid/next';
      if (vector.guard === 'userinfo') target = 'https://user:secret@alpha.invalid/next';
      const headers = status === 503 || status === 200 ? [] : [['location', target]];
      const body = (async function* () { if (status === 200) yield Buffer.from('accepted\n'); })();
      return { status, statusText: 'controlled', headers, body, async dispose() { assert.ok(!disposed.includes(index)); disposed.push(index); } };
    } finally { record.hex = hex(Buffer.concat(chunks)); active.delete(index); }
  };
  const registry = new CommandRegistry([{ name: 'relay', async execute(context) { for await (const bytes of context.stdin) await writeBytes(context.stdout, bytes, context.signal); return { exitCode: 0 }; } }]);
  const shell = new Shell({ fs, commands: registry }).use(networkCommands({ transport, limits, authorize(request) {
    request.signal.throwIfAborted();
    auth.push({ url: request.url, method: request.method, attempt: request.attempt, redirectFrom: request.redirectFrom });
    return !(vector.guard === 'deny-hop' && request.redirectFrom) && !(vector.guard === 'retry-deny' && request.attempt > 0);
  } }));
  const args = ['curl', '-L', '--data-binary', '@-'];
  if (vector.input === 'mixed') args.push('--data-binary', '@/body');
  if (vector.status === 503) args.push('--retry', '1', '--retry-delay', '0.001');
  if (vector.guard === 'cross-origin') args.push('-u', 'alice:secret', '-H', 'X-Private: hidden');
  args.push('https://alpha.invalid/start');
  let result;
  let caught;
  try { result = await shell.exec(`${command(args)} | relay`, { stdin: input, signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await shell.dispose(); await turn(); }
  Object.assign(evidence, { auth, requests, disposed, fileState, stdinState, result: result && { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, caught: caught?.message, active: active.size });
  assert.equal(active.size, 0);
  assert.equal(stdinState.closed, stdinState.opened);
  assert.equal(fileState.closed, fileState.opened);
  if (vector.expect === 'abort') { assert.equal(caught, reason); assert.equal(requests.length, 1); return; }
  assert.equal(caught, undefined);
  const expectedCode = vector.expect;
  if (expectedCode === 0) { assert.equal(result.exitCode, 0); assert.equal(result.stderr, ''); assert.equal(result.stdout, 'accepted\n'); }
  else { assert.equal(result.stdout, ''); assert.ok(result.stderr.startsWith(`curl: (${expectedCode}) `), result.stderr); }
  const requestCount = ['deny-hop', 'downgrade', 'userinfo', 'retry-deny', 'upload-limit'].includes(vector.guard) ? 1 : 2;
  assert.equal(requests.length, requestCount);
  assert.equal(auth.length, ['deny-hop', 'retry-deny'].includes(vector.guard) ? 2 : requestCount);
  if (vector.guard === 'upload-limit') assert.ok(requests[0].hex.length / 2 <= 128);
  else for (const request of requests.filter(item => item.complete)) assert.equal(request.hex, hex(expectedBody));
  assert.equal(disposed.length, requests.filter(item => item.complete).length);
  assert.ok(requests.every(request => request.method === 'POST'));
  assert.equal(fileState.opened, vector.input === 'mixed' && vector.guard !== 'upload-limit' ? 1 : 0);
  if (auth.length > 1) {
    assert.equal(auth[1].attempt, vector.status === 503 ? 1 : 0);
    assert.equal(auth[1].redirectFrom, vector.status === 503 ? undefined : 'https://alpha.invalid/start');
  }
  if (vector.guard === 'cross-origin') {
    assert.ok(requests[0].headers.some(([name]) => name.toLowerCase() === 'authorization'));
    assert.ok(requests[0].headers.some(([name]) => name.toLowerCase() === 'x-private'));
    assert.ok(!requests[1].headers.some(([name]) => ['authorization', 'x-private'].includes(name.toLowerCase())));
  }
}

async function jqCase(vector, evidence) {
  const fs = new MemoryFileSystem();
  const programState = stateFor();
  const inputState = stateFor();
  const controller = new AbortController();
  const reason = new Error('independent-jq-abort');
  const program = Buffer.from(programs[vector.profile]);
  const limits = vector.profile.startsWith('source-') ? { maxSourceBytes: program.length - (vector.profile === 'source-excess' ? 1 : 0) } : vector.profile === 'input-limit' ? { maxInputBytes: 32 } : {};
  const failure = vector.profile === 'reader-error' ? new FsError('EIO', { path: '/filter', syscall: 'read' }) : undefined;
  fs.readStream = (path, options) => {
    assert.equal(path, '/filter');
    assert.ok(options.signal instanceof AbortSignal);
    return reusable(program, vector.kind, programState, { error: failure, ...(vector.profile === 'abort' ? { abort: () => controller.abort(reason), reason } : {}) });
  };
  const inputBytes = Buffer.from(vector.profile === 'raw' ? 'red\nblue\n' : vector.profile === 'input-limit' ? '"' + 'a'.repeat(70) + '"' : '{"amount":29}\n');
  const registry = new CommandRegistry([{ name: 'emit', async execute(context) {
    for await (const bytes of reusable(inputBytes, vector.kind, inputState)) await writeBytes(context.stdout, bytes, context.signal);
    return { exitCode: 0 };
  } }]);
  const shell = new Shell({ fs, commands: registry }).use(structuredCommands({ limits }));
  const args = ['jq', '-r', ...(vector.profile === 'raw' ? ['-R'] : []), ...(vector.profile === 'null' ? ['-n'] : []), '-f', '/filter'];
  let result;
  let caught;
  try { result = await shell.exec((vector.profile === 'pipeline' ? 'emit | ' : '') + command(args), { stdin: reusable(inputBytes, vector.kind, inputState), signal: controller.signal }); }
  catch (error) { caught = error; }
  finally { await shell.dispose(); await turn(); }
  Object.assign(evidence, { programState, inputState, result: result && { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, caught: caught?.message });
  assert.equal(programState.opened, 1);
  assert.equal(programState.closed, 1);
  assert.equal(inputState.opened, inputState.closed);
  if (vector.expect === 'abort') { assert.equal(caught, reason); assert.equal(inputState.opened, 0); return; }
  assert.equal(caught, undefined);
  assert.equal(result.exitCode, vector.expect);
  if (vector.expect === 0) { assert.equal(result.stdout, outputs[vector.profile]); assert.equal(result.stderr, ''); }
  else {
    assert.equal(result.stdout, '');
    if (vector.profile === 'source-excess') assert.equal(result.stderr, 'jq: maxSourceBytes limit exceeded\n');
    if (vector.profile === 'input-limit') assert.ok(result.stderr.includes('maxInputBytes limit exceeded'));
    if (vector.profile === 'utf8') assert.equal(result.stderr, 'jq: program file is not valid UTF-8\n');
    if (vector.profile === 'reader-error') assert.equal(result.stderr, `jq: ${failure.message}\n`);
    if (vector.profile !== 'input-limit') assert.equal(inputState.opened, 0);
  }
  if (vector.profile === 'null') assert.equal(inputState.opened, 0);
}

const results = [];
for (const vector of cases) {
  const evidence = { id: vector.id, vector };
  try { await (vector.family === 'curl' ? curlCase(vector, evidence) : jqCase(vector, evidence)); evidence.pass = true; }
  catch (error) { evidence.pass = false; evidence.failure = { message: error.message, stack: error.stack, actual: error.actual, expected: error.expected }; }
  results.push(evidence);
  process.stdout.write(`${evidence.pass ? 'PASS' : 'FAIL'} ${vector.id}\n`);
}
const report = { count: results.length, passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length, results };
writeFileSync(process.env.REVIEW_RESULTS, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ count: report.count, passed: report.passed, failed: report.failed }) + '\n');
process.exitCode = report.failed ? 1 : 0;
