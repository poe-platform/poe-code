import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client, Capacity } from './.build/js/tests/stress/regex-execution/design/client.js';
import { compile, scan } from './.build/js/tests/stress/regex-execution/design/matching.js';
import { caps } from './.build/js/tests/stress/regex-execution/design/protocol.js';
import { grepCommands } from './.build/js/src/commands/grep.js';
import { Matcher } from './.build/js/src/commands/search/matcher.js';
import { parse } from './.build/js/src/commands/search/options.js';
import { Pattern } from './.build/js/src/commands/text-programs/regex.js';
import { Budget } from './.build/js/src/commands/text-programs/shared.js';
import { vectors, workloads, workload, risk, expectedWorkerBytes } from './fixtures.mjs';

const [family, name, profile, engine, repetition] = process.argv.slice(2);
if (!process.send || !['vector', 'lifecycle', 'bench', 'risk'].includes(family)) throw new Error('FIXED_CHILD_ONLY');
const capacity = new Capacity();
const clients = [];
const make = (patterns, signal) => { const client = new Client(patterns, capacity, signal); clients.push(client); return client; };
const latin = text => Buffer.from(text).toString('latin1');
const budget = maxSteps => new Budget({ signal: new AbortController().signal }, { maxSteps, maxBufferBytes: 1048576 });
const simplify = hits => hits.map(hit => [hit.start, hit.end, hit.captures]);
const context = (args, input) => {
  const output = { stdout: [], stderr: [] };
  let total = 0;
  const sink = key => ({ write: async chunk => { total += chunk.length; if (total > 131072) throw new Error('TEST_OUTPUT_CAP'); output[key].push(Buffer.from(chunk)); } });
  return { output, command: 'grep', args, cwd: '/', env: {}, fs: Object.freeze({}), signal: new AbortController().signal, stdinIsDefault: false, stdin: (async function* () { yield Buffer.from(input); })(), stdout: sink('stdout'), stderr: sink('stderr') };
};
const grep = async (args, input) => {
  const state = context(args, input);
  const result = await grepCommands()[0].execute(state);
  return { exitCode: result.exitCode, stdout: Buffer.concat(state.output.stdout), stderr: Buffer.concat(state.output.stderr).toString() };
};
const descriptor = (vector, selectedProfile) => ({ source: selectedProfile === 'grep' ? vector.pattern === '[[:digit:]]' ? '[0-9]' : latin(vector.pattern) : `(?:${vector.pattern})`, flags: selectedProfile === 'grep' ? vector.insensitive ? 'gi' : 'g' : vector.insensitive ? 'gui' : 'gu' });
const patternArgs = (patterns, insensitive = false) => parse([...(insensitive ? ['-i'] : []), ...patterns.flatMap(pattern => ['-e', pattern]), '-']);

async function vectorRun() {
  const vector = vectors.find(item => item.name === name);
  assert(vector);
  const expected = vector[`${profile}Expected`] ?? vector.expected;
  const rejected = vector[`${profile}Reject`] === true;
  const entry = descriptor(vector, profile);
  const text = profile === 'grep' ? latin(vector.text) : vector.text;
  let current;
  if (profile === 'grep') {
    current = await grep(['-E', '-o', ...(vector.insensitive ? ['-i'] : []), '-e', vector.pattern, '-'], vector.text + '\n');
    if (rejected) assert.equal(current.exitCode, 2);
    else {
      assert.notEqual(current.exitCode, 2, current.stderr);
      const expectedHex = vector.grepExpectedHex ?? expected.filter(hit => hit[0] !== hit[1]).map(hit => Buffer.from(hit[2][0], 'latin1').toString('hex'));
      const output = Buffer.concat(expectedHex.flatMap(hex => [Buffer.from(hex, 'hex'), Buffer.from('\n')]));
      assert.deepEqual(current.stdout, output);
    }
    current = { ...current, stdout: current.stdout.toString('hex') };
  } else {
    let matcher;
    try { matcher = new Matcher([vector.pattern], patternArgs([vector.pattern], vector.insensitive)); }
    catch (error) { if (!rejected) throw error; current = { rejected: error.message }; }
    if (rejected) assert.equal(matcher, undefined);
    else {
      assert.equal(matcher.regex.source, entry.source);
      assert.equal(matcher.regex.flags, entry.flags === 'gui' ? 'giu' : entry.flags);
      current = matcher.matches(Buffer.from(vector.text), true, true);
      const offsets = expected.map(hit => ({ start: Buffer.byteLength(vector.text.slice(0, hit[0])), end: Buffer.byteLength(vector.text.slice(0, hit[1])) }));
      assert.deepEqual(current, offsets);
    }
  }
  let bounded;
  try {
    const found = new Pattern(latin(vector.pattern), true, vector.insensitive).find(latin(vector.text), budget(10000));
    bounded = { status: 'completed-byte-profile', first: found ?? null };
  } catch (error) { bounded = { status: 'unsupported-or-budget', error: error.message }; }
  if (rejected) return { name, profile, status: 'tool-rejection-preserved-no-worker-regex', current, bounded };
  const input = [{ text, all: true }];
  const direct = scan(compile([entry]), input);
  if (expected) assert.deepEqual(simplify(direct.hits[0]), expected);
  const client = make([entry]);
  const worker = await client.batch(input);
  assert.deepEqual(worker, direct);
  await client.dispose();
  return { name, profile, status: 'exact-native-worker', current, descriptor: entry, direct, bounded, metrics: client.metrics };
}

async function lifecycleRun() {
  const rows = [{ text: 'a', all: true }];
  const entries = [{ source: 'a', flags: 'g' }];
  const results = [];
  const pre = new AbortController(); pre.abort(new Error('PREABORT'));
  const preClient = make([{ source: '[', flags: 'g' }], pre.signal);
  await assert.rejects(preClient.batch(rows), /PREABORT/);
  assert.equal(preClient.metrics.created, 0); assert.equal(preClient.metrics.requests, 0);
  await preClient.dispose(); results.push({ name: 'preabort-zero-work', metrics: preClient.metrics });
  const empty = make(entries);
  for await (const unused of empty.stream((async function* () {})(), 16)) assert.fail(unused);
  assert.equal(empty.metrics.created, 0); results.push({ name: 'empty-stream', metrics: empty.metrics });
  const cap = make(entries);
  await assert.rejects(cap.batch([{ text: 'a'.repeat(10000), all: true }]), /RESULT_CAP/);
  results.push({ name: 'output-cap-explicit-error', metrics: cap.metrics });
  const bad = make([{ source: '[', flags: 'g' }]);
  await assert.rejects(bad.batch(rows), /Invalid regular expression/);
  results.push({ name: 'worker-compile-error', metrics: bad.metrics });
  const inputCap = make(entries);
  await assert.rejects(inputCap.batch([{ text: 'a'.repeat(caps.subjectBytes), all: true }]), /INPUT_CAP/);
  assert.equal(inputCap.metrics.created, 0); results.push({ name: 'input-cap-before-worker', metrics: inputCap.metrics });
  const streaming = make(entries);
  let pulled = 0;
  let closed = false;
  const source = (async function* () { try { for (let index = 0; index < 100; index++) { pulled++; yield rows[0]; } } finally { closed = true; } })();
  for await (const result of streaming.stream(source, 16)) {
    assert.equal(result.hits.length, 16);
    assert.equal(pulled, 16);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(pulled, 16); assert.equal(streaming.metrics.requests, 2);
    break;
  }
  assert(closed); assert.equal(streaming.metrics.terminated, 1);
  results.push({ name: 'backpressure-early-return', pulled, closed, metrics: streaming.metrics });
  const first = make(entries); await first.ready();
  const competing = make(entries); await assert.rejects(competing.ready(), /CAPACITY_BUSY/);
  const pending = first.batch(rows);
  await assert.rejects(first.batch(rows), /BUSY/);
  await pending; await first.dispose();
  results.push({ name: 'capacity-and-inflight-reject-no-queue', metrics: first.metrics, competing: competing.metrics });
  const controller = new AbortController(); const canceled = make(entries, controller.signal); await canceled.ready();
  const cancellation = assert.rejects(canceled.batch(rows), /DURING/);
  await Promise.resolve(); controller.abort(new Error('DURING'));
  await cancellation; await canceled.dispose();
  results.push({ name: 'abort-after-post', metrics: canceled.metrics });
  const idleController = new AbortController(); const idle = make(entries, idleController.signal); await idle.ready();
  idleController.abort(new Error('IDLE')); await idle.dispose();
  results.push({ name: 'idle-abort-disposes', metrics: idle.metrics });
  const remaining = make(entries); await remaining.ready();
  const settlement = assert.rejects(remaining.batch(rows), /DISPOSED/);
  await Promise.resolve(); await remaining.dispose(); await settlement;
  results.push({ name: 'dispose-settles-pending', metrics: remaining.metrics });
  const surrogate = make([{ source: '.', flags: 'gu' }]);
  const surrogateInput = [{ text: '\ud800', all: true }];
  const raw = scan(compile([{ source: '.', flags: 'gu' }]), surrogateInput);
  assert.deepEqual(await surrogate.batch(surrogateInput), raw);
  await surrogate.dispose();
  results.push({ name: 'lone-surrogate-raw-facade-not-UTF8-tool-profile', raw, metrics: surrogate.metrics });
  const special = new Matcher([''], patternArgs(['']));
  const emptyUnicode = special.matches(Buffer.from('😀'), true, true);
  assert.deepEqual(emptyUnicode, [0, 1, 2, 3, 4].map(offset => ({ start: offset, end: offset })));
  const invalid = new Matcher(['.'], patternArgs(['.'])).matches(Uint8Array.from([97, 255, 98]));
  assert.deepEqual(invalid, [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  results.push({ name: 'current-rg-adapter-required-not-raw-facade-parity', emptyUnicode, invalid });
  return results;
}

async function benchmark() {
  const spec = workloads.find(item => item.name === name); assert(spec);
  const data = workload(spec);
  const input = data.rows.map(row => ({ ...row, text: profile === 'grep' ? latin(row.text) : row.text }));
  const entries = profile === 'grep' ? data.patterns.map(source => ({ source, flags: 'g' })) : [{ source: data.patterns.map(source => `(?:${source})`).join('|'), flags: 'gu' }];
  let matches = 0;
  let calls = 0;
  let responseBytes = 0;
  let startupMs = 0;
  let setupMs = 0;
  let steadyMs = 0;
  let metrics;
  let status = 'completed';
  let error;
  const started = performance.now();
  try {
    if (engine === 'current') {
      if (profile === 'grep') {
        const original = RegExp.prototype.exec;
        RegExp.prototype.exec = function (subject) { if (entries.some(entry => entry.source === this.source && entry.flags === this.flags)) calls++; return Reflect.apply(original, this, [subject]); };
        try {
          const found = await grep(['-E', '-c', ...data.patterns.flatMap(pattern => ['-e', pattern]), '-'], data.rows.map(row => row.text).join('\n') + '\n');
          assert.equal(found.stderr, ''); matches = Number(found.stdout.toString()); responseBytes = found.stdout.length;
        } finally { RegExp.prototype.exec = original; }
      } else {
        const matcher = new Matcher(data.patterns, patternArgs(data.patterns));
        setupMs = performance.now() - started;
        for (const row of data.rows) { const found = matcher.matches(Buffer.from(row.text), true); matches += found.length; responseBytes += Buffer.byteLength(JSON.stringify(found)); calls++; }
      }
      steadyMs = performance.now() - started - setupMs;
    } else if (engine === 'bounded') {
      const patterns = data.patterns.map(pattern => new Pattern(latin(pattern)));
      const shared = budget(5000000);
      setupMs = performance.now() - started;
      for (const row of data.rows) for (const pattern of patterns) { calls++; const found = pattern.find(latin(row.text), shared); if (found) { matches++; responseBytes += Buffer.byteLength(JSON.stringify(found)); } }
      steadyMs = performance.now() - started - setupMs;
    } else {
      assert(['worker16', 'worker128'].includes(engine));
      const client = make(entries);
      await client.ready();
      startupMs = client.metrics.startupMs; setupMs = performance.now() - started;
      const steadyStart = performance.now();
      const size = engine === 'worker16' ? 16 : 128;
      for await (const result of client.stream((async function* () { yield* input; })(), size)) { matches += result.hits.reduce((sum, hits) => sum + hits.length, 0); responseBytes += result.bytes; }
      steadyMs = performance.now() - steadyStart - client.metrics.terminationMs;
      metrics = client.metrics; calls = metrics.execCalls;
      assert.equal(responseBytes, expectedWorkerBytes(spec, size));
    }
    assert.equal(matches, spec.expectedMatches);
  } catch (failure) { status = 'error'; error = failure.message; }
  return { name, profile, engine, repetition: Number(repetition), status, error, expectedMatches: spec.expectedMatches, matches, declaredInputBytes: spec.bytes, inputUtf16Bytes: input.reduce((sum, row) => sum + row.text.length * 2, 0), responseBytes, calls, startupMs, setupMs, steadyMs, endToEndMs: performance.now() - started, metrics };
}

let riskClient;
let riskController;
if (family === 'risk') {
  assert(risk.author.includes(name));
  if (name !== 'bounded') {
    riskController = name === 'worker-abort' ? new AbortController() : undefined;
    riskClient = make([{ source: risk.source, flags: 'g' }], riskController?.signal);
    await riskClient.ready();
  }
}
process.send({ type: 'ready', family, name });
const [message] = await once(process, 'message');
assert.equal(message, 'go');
const start = performance.now();
let heartbeats = 0;
let maxGap = 0;
let lastBeat = start;
let peakRss = process.memoryUsage().rss;
const heartbeat = setInterval(() => {
  const now = performance.now(); maxGap = Math.max(maxGap, now - lastBeat); lastBeat = now; heartbeats++;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (family === 'risk') process.send({ type: 'heartbeat', elapsed: now - start, rss: peakRss });
}, 5);
let result;
let failure;
try {
  if (family === 'vector') result = await vectorRun();
  else if (family === 'lifecycle') result = await lifecycleRun();
  else if (family === 'bench') result = await benchmark();
  else {
    let abortAt;
    const timer = riskController ? setTimeout(() => { abortAt = performance.now() - start; riskController.abort(new Error('EXPLICIT_ABORT')); }, 20) : undefined;
    const entered = performance.now();
    process.send({ type: 'enter', subjectBytes: risk.bytes, source: risk.source, profile: name });
    try {
      const outcome = name === 'bounded' ? new Pattern(risk.source).find(risk.text, budget(10000)) : await riskClient.batch([{ text: risk.text, all: false }]);
      result = { status: 'completed', outcome: outcome ?? null };
    } catch (error) { result = { status: 'error', error: error.message }; }
    finally { clearTimeout(timer); if (riskClient) await riskClient.dispose(); }
    result = { ...result, elapsedMs: performance.now() - entered, abortAt, metrics: riskClient?.metrics };
  }
} catch (error) { failure = { message: error.message, stack: error.stack?.slice(0, 4096) }; }
finally {
  for (const client of clients) await client.dispose();
  clearInterval(heartbeat);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
assert(clients.every(client => client.metrics.created === client.metrics.terminated && client.metrics.listenersAfter === 0));
process.send({ type: 'done', result, failure, wallMs: performance.now() - start, heartbeats, maxGap, peakRss, memory: process.memoryUsage(), flags: process.execArgv, cleanup: clients.map(client => client.metrics) }, () => process.disconnect());
