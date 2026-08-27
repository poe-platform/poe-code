import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { commands, raw, workload, policyNames } from './fixtures.mjs';
import { RequestQueue } from './model.mjs';
import { Client, Capacity } from './.scratch/built/tests/stress/regex-execution/design/client.js';
import { compile, scan } from './.scratch/built/tests/stress/regex-execution/design/matching.js';
import { observations, disposeAdapter } from './.scratch/built/tests/stress/regex-execution/design/validation/adapter.js';
import { Shell } from './.scratch/built/src/shell/shell.js';
import { MemoryFileSystem } from './.scratch/built/src/fs/memory/index.js';
import { grepCommands as currentGrep } from './.scratch/built/src/commands/grep.js';
import { grepCommands as workerGrep } from './.scratch/built/src/commands/validation-grep.js';
import { rgCommand as currentRg } from './.scratch/built/src/commands/search/rg.js';
import { rgCommand as workerRg } from './.scratch/built/src/commands/search/validation-rg.js';

if (!process.send || process.env.NODE_OPTIONS) throw new Error('SUPERVISED_FIXED_CHILD_ONLY');
const [family, id, engine] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clients = [];
function client(descriptors, capacity = new Capacity()) {
  const current = new Client(descriptors, capacity);
  clients.push(current);
  return current;
}
function shell(mode) {
  const current = new Shell({ fs: new MemoryFileSystem(), limits: { pipeHighWaterMark: 1 } });
  current.register((mode === 'current' ? currentGrep : workerGrep)()[0]);
  current.register((mode === 'current' ? currentRg : workerRg)());
  return current;
}
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
async function vectorRun() {
  const vector = commands.find(entry => entry.id === id);
  assert(vector);
  const outputs = {};
  for (const mode of ['current', 'worker']) {
    const current = shell(mode);
    try {
      const output = await current.exec([vector.tool, ...vector.args.map(quote), '-'].join(' '), { stdin: Buffer.from(vector.inputHex, 'hex') });
      outputs[mode] = { stdoutHex: Buffer.from(output.stdoutBytes).toString('hex'), stderrHex: Buffer.from(output.stderrBytes).toString('hex'), status: output.exitCode };
    } finally { await current.dispose(); }
  }
  const expected = vector.expected;
  const matchesExpected = outputs.current.stdoutHex === expected.stdoutHex && outputs.current.status === expected.status;
  const equivalent = JSON.stringify(outputs.current) === JSON.stringify(outputs.worker);
  await disposeAdapter();
  return { id, expected, outputs, matchesExpected, equivalent, pass: matchesExpected && equivalent, adapter: { ...observations } };
}
async function rawRun() {
  const vector = raw.find(entry => entry.id === id);
  assert(vector);
  const descriptors = [{ source: vector.source, flags: vector.flags }];
  const rows = [{ text: vector.text, all: true }];
  const direct = scan(compile(descriptors), rows);
  assert.deepEqual(direct.hits[0].map(hit => hit.captures), vector.captures);
  const current = client(descriptors);
  const isolated = await current.batch(rows);
  assert.deepEqual(isolated, direct);
  await current.dispose();
  assert.equal(current.metrics.created, current.metrics.terminated);
  assert.equal(current.metrics.listenersAfter, 0);
  return { id, pass: true, direct, metrics: current.metrics };
}
async function benchRun() {
  assert(['current', 'worker', 'worker-stream'].includes(engine));
  const input = workload(id);
  const batches = [];
  for (let index = 0; index < input.rows.length; index += input.batchSize) batches.push(input.rows.slice(index, index + input.batchSize));
  const expected = batches.map(rows => scan(compile(input.descriptors), rows));
  const probe = client(input.descriptors);
  for (const [index, rows] of batches.entries()) assert.deepEqual(await probe.batch(rows), expected[index]);
  await probe.dispose();
  const canonical = results => ({ hits: results.flatMap(result => result.hits), execCalls: results.reduce((sum, result) => sum + result.execCalls, 0) });
  if (engine === 'worker-stream') {
    const streamProbe = client(input.descriptors);
    const streamed = [];
    for await (const result of streamProbe.stream((async function* () { yield* input.rows; })(), input.batchSize)) streamed.push(result);
    assert.deepEqual(canonical(streamed), canonical(expected));
  }
  const current = engine !== 'current' ? client(input.descriptors) : undefined;
  const startup = performance.now();
  if (current) await current.ready();
  const compiled = current ? undefined : compile(input.descriptors);
  const startupMs = performance.now() - startup;
  const started = performance.now();
  const actual = [];
  if (engine === 'worker-stream') {
    for await (const result of current.stream((async function* () { yield* input.rows; })(), input.batchSize)) actual.push(result);
  } else for (const rows of batches) actual.push(current ? await current.batch(rows) : scan(compiled, rows));
  const workMs = performance.now() - started;
  assert.deepEqual(canonical(actual), canonical(expected));
  const stopping = performance.now();
  if (current) await current.dispose();
  const cleanupMs = performance.now() - stopping;
  const outputBytes = Buffer.from(JSON.stringify(canonical(actual)));
  const selectedBytes = Buffer.concat(actual.flatMap(batch => batch.hits.flatMap(hits => hits.map(hit => Buffer.from(hit.captures[0] + '\n')))));
  return { id, engine, pass: true, workMs, startupMs, cleanupMs, streamIncludesAutomaticDisposal: engine === 'worker-stream', repetitions: 3, exactOutputGateBeforeTiming: true, inputUtf8Bytes: input.rows.reduce((sum, row) => sum + Buffer.byteLength(row.text), 0), inputUtf16Bytes: input.rows.reduce((sum, row) => sum + row.text.length * 2, 0), rows: input.rows.length, batches: actual.length, protocolHitBytes: actual.reduce((sum, batch) => sum + batch.bytes, 0), hits: actual.reduce((sum, batch) => sum + batch.hits.reduce((count, hits) => count + hits.length, 0), 0), execCalls: actual.reduce((sum, batch) => sum + batch.execCalls, 0), captureValues: actual.reduce((sum, batch) => sum + batch.hits.flat().reduce((count, hit) => count + hit.captures.length, 0), 0), selectedBytes: selectedBytes.length, selectedSha256: hash(selectedBytes), serializedBytes: outputBytes.length, serializedSha256: hash(outputBytes), metrics: current?.metrics, rssAfter: process.memoryUsage().rss };
}
async function policyRun() {
  assert(policyNames.includes(id));
  const descriptors = [{ source: '(a)', flags: 'g' }];
  if (id === 'fifo-release-before-await') {
    const queue = new RequestQueue();
    const names = ['upstream', 'independent', 'downstream'];
    await Promise.all(names.map(name => queue.run(name, async () => {
      const current = client(descriptors);
      try { assert.equal((await current.batch([{ text: 'a', all: true }])).hits[0][0].captures[0], 'a'); }
      finally { await current.dispose(); }
    })));
    assert.deepEqual(queue.trace, names.flatMap(name => [`start:${name}`, `end:${name}`]));
    assert.equal(queue.active, 0);
    await queue.run('after-downstream-await', async () => { assert.equal(queue.active, 1); });
    return { id, pass: true, trace: queue.trace, peak: queue.peak, active: queue.active };
  }
  if (id === 'live-one-record-stream') {
    const current = client(descriptors);
    let acknowledge;
    let pulled = 0;
    let returned = false;
    const source = (async function* () {
      try {
        for (let index = 0; index < 2; index++) {
          const next = new Promise(resolve => { acknowledge = resolve; });
          pulled++;
          yield { text: 'a', all: true };
          await next;
        }
      } finally { returned = true; }
    })();
    let delivered = 0;
    const timer = setTimeout(() => { acknowledge?.(); void current.dispose(); }, 1000);
    try {
      for await (const batch of current.stream(source, 16)) {
        assert.equal(batch.hits.length, 1);
        delivered++;
        assert.equal(pulled, delivered);
        acknowledge();
      }
    } finally { clearTimeout(timer); acknowledge?.(); await current.dispose(); }
    assert.equal(delivered, 2); assert(returned);
    return { id, pass: true, pulled, delivered, returned, metrics: current.metrics };
  }
  if (id === 'concurrent-shell-pipelines') {
    const outputs = await Promise.all([0, 1, 2].map(async () => {
      const current = shell('worker');
      try { return await current.exec("grep -E '(a)' | rg -o '(a)' | grep -Eo '(a)'", { stdin: 'a\na\n' }); }
      finally { await current.dispose(); }
    }));
    for (const output of outputs) { assert.equal(output.stdout, 'a\na\n'); assert.equal(output.stderr, ''); assert.equal(output.exitCode, 0); }
    assert.equal(observations.active, 0); assert.equal(observations.peak, 1);
    await disposeAdapter();
    assert.equal(observations.created, observations.terminated);
    return { id, pass: true, pipelines: 3, stages: 3, outputs: outputs.map(output => ({ stdout: output.stdout, status: output.exitCode })), adapter: observations };
  }
  if (id === 'lease-free-live-shell') {
    const current = shell('worker');
    const trace = [];
    let acknowledge;
    current.register({ name: 'producer', async execute(context) {
      for (let index = 0; index < 2; index++) {
        const received = new Promise(resolve => { acknowledge = resolve; });
        assert.equal(observations.active, 0); trace.push('upstream-lease-free');
        await context.stdout.write(Buffer.from('a\n'));
        await received;
      }
      return { exitCode: 0 };
    } });
    let stdout = '';
    try {
      const result = await current.exec("producer | grep -E '(a)' | rg -o '(a)' | grep -Eo '(a)'", { stdout: { async write(bytes) {
        assert.equal(observations.active, 0); trace.push('downstream-lease-free');
        stdout += Buffer.from(bytes).toString();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(observations.active, 0);
        if (Buffer.from(bytes).includes(10)) acknowledge();
      } } });
      assert.equal(result.stdout, 'a\na\n'); assert.equal(result.exitCode, 0); assert.equal(result.stderr, '');
    } finally { acknowledge?.(); await current.dispose(); await disposeAdapter(); }
    assert.equal(stdout, 'a\na\n');
    return { id, pass: true, trace, stdout, adapter: observations };
  }
  const capacity = new Capacity();
  const first = client(descriptors, capacity);
  const second = client(descriptors, capacity);
  await first.ready();
  let admission;
  try { await second.ready(); admission = 'accepted'; }
  catch (error) { admission = error.message; }
  await first.dispose(); await second.dispose();
  return { id, pass: true, observedAdmission: admission, interpretation: admission === 'CAPACITY_BUSY' ? 'invocation slot pins idle worker; not acceptable product policy' : 'prototype admission changed; inspect source', metrics: clients.map(current => current.metrics) };
}
const heartbeat = setInterval(() => process.send({ type: 'heartbeat', rss: process.memoryUsage().rss }), 250);
process.send({ type: 'ready' });
const [start] = await once(process, 'message');
if (start !== 'go') throw new Error('PROTOCOL');
let result;
try {
  if (family === 'vector') result = await vectorRun();
  else if (family === 'raw') result = await rawRun();
  else if (family === 'bench') result = await benchRun();
  else if (family === 'policy') result = await policyRun();
  else if (family === 'package') result = await (await import('./.scratch/moved/consumer.mjs')).run();
  else throw new Error('FIXED_FAMILY_ONLY');
} catch (error) { result = { pass: false, error: { message: error.message, stack: error.stack } }; }
finally { for (const current of clients) await current.dispose(); await disposeAdapter(); clearInterval(heartbeat); }
process.send({ type: 'done', result });
process.disconnect();
process.exitCode = result.pass ? 0 : 1;
