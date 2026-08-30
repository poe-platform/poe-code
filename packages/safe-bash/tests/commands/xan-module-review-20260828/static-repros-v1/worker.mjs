import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { installLoader } from '../actual-review-v1/loader.mjs';

const emit = async value => { if (!process.stdout.write(JSON.stringify(value) + '\n')) await once(process.stdout, 'drain'); };
if (process.argv[2] === 'synthetic') {
  await emit({ synthetic: process.argv[3] });
  if (process.argv[3] === 'timeout') setInterval(() => {}, 1000);
  else process.exitCode = process.argv[3] === 'fail' ? 1 : 0;
} else {
  const raw = await readFile(process.argv[2]);
  assert.equal(createHash('sha256').update(raw).digest('hex'), process.argv[3]);
  const job = JSON.parse(raw);
  const loads = installLoader(job.root, job.entries, job.builtinMap);
  const module = await import(pathToFileURL(path.join(job.root, 'dist/commands/xan/index.js')).href);
  const spec = job.spec;
  const controller = new AbortController();
  const reason = Object.freeze({ kind: 'STATIC_REPRO_CANCEL', id: spec.id });
  const events = [];
  const event = (type, detail = {}) => { assert.ok(events.length < 256); events.push({ type, ...detail }); };
  const observation = { id: spec.id, kind: spec.kind, events, naturalSettlement: false, closed: false };
  const begin = performance.now();
  if (spec.kind === 'public') {
    const callbacks = [];
    const input = Buffer.from(spec.inputBase64, 'base64');
    let delivered = false;
    let fsCalls = 0;
    const output = [];
    const diagnostic = [];
    let outputBytes = 0;
    let diagnosticBytes = 0;
    const context = { command: 'xan', args: spec.args, cwd: '/work', env: {}, signal: controller.signal, stdinIsDefault: false,
      fs: new Proxy({}, { get() { fsCalls++; throw new Error('UNEXPECTED_FS_ACCESS'); } }),
      stdin: { [Symbol.asyncIterator]() { event('input-acquire'); return {
        async next() { if (delivered) { event('input-eof'); return { done: true }; } delivered = true; event('input-delivery', { bytes: input.length, base64: spec.inputBase64 }); return { done: false, value: input }; },
        async return() { event('borrowed-return'); return { done: true }; },
      }; } },
      stdout: { async write(bytes) { outputBytes += bytes.length; assert.ok(outputBytes <= 300000); output.push(Buffer.from(bytes)); event('stdout-write', { bytes: bytes.length }); } },
      stderr: { async write(bytes) { diagnosticBytes += bytes.length; assert.ok(diagnosticBytes <= 300000); diagnostic.push(Buffer.from(bytes)); event('stderr-write', { bytes: bytes.length }); } },
      registerCleanup(callback) { event('cleanup-register'); callbacks.push(callback); },
    };
    try { observation.result = await module.createXanCommand({ limits: spec.limits }).execute(context); observation.thrown = false; }
    catch (error) { observation.thrown = true; observation.reason = { name: error?.name, message: error?.message }; }
    event('command-settle'); observation.naturalSettlement = true;
    const closures = await Promise.allSettled(callbacks.map(callback => callback()));
    observation.cleanup = closures.map(item => ({ status: item.status, ...(item.status === 'rejected' ? { reason: String(item.reason) } : {}) }));
    observation.closed = closures.every(item => item.status === 'fulfilled'); event('root-cleanup-drained');
    Object.assign(observation, { stdoutBase64: Buffer.concat(output).toString('base64'), stderrBase64: Buffer.concat(diagnostic).toString('base64'), fsCalls });
  } else {
    const { Budget } = await import(pathToFileURL(path.join(job.root, 'dist/commands/xan/budget.js')).href);
    const { parseSelection } = await import(pathToFileURL(path.join(job.root, 'dist/commands/xan/selector.js')).href);
    const budget = new Budget({ ...module.defaultLimits, ...spec.limits }, controller.signal);
    let observer;
    let cancellation;
    let settled = false;
    let samples = 0;
    const sample = () => {
      if (settled) return;
      const work = budget.totals.get('maxWork') ?? 0;
      event('host-immediate-observation', { work });
      if (work >= 131073) {
        event('cancel-armed', { work });
        cancellation = setImmediate(() => { event('cancel-delivered', { work: budget.totals.get('maxWork'), reason }); controller.abort(reason); });
      } else if (++samples < 16) observer = setImmediate(sample);
    };
    if (spec.cancel) observer = setImmediate(sample);
    event('parse-start', { units: spec.text.length });
    try {
      const selection = await parseSelection(spec.text, budget);
      const endpoint = selection.clauses[0].endpoint;
      observation.endpoint = { name: endpoint.name, bytesBase64: Buffer.from(endpoint.bytes).toString('base64'), index: endpoint.index?.toString() ?? null };
      observation.thrown = false;
    } catch (error) {
      observation.thrown = true; observation.sameReason = error === reason;
      observation.reason = error === reason ? reason : { name: error.name, message: error.message, limit: error.limit };
    } finally {
      settled = true; clearImmediate(observer); clearImmediate(cancellation);
      observation.naturalSettlement = true; observation.closed = true; observation.work = budget.totals.get('maxWork') ?? 0;
      observation.retained = budget.retained; observation.totals = Object.fromEntries(budget.totals); event('parse-settle', { work: observation.work });
    }
  }
  observation.elapsedMs = performance.now() - begin;
  await emit({ stage: 'RAW', nonce: job.nonce, manifest: job.manifest, observation });
  await emit({ stage: 'LOADS', loads });
  await emit({ stage: 'FINAL', id: spec.id, nonce: job.nonce, manifest: job.manifest, complete: true, closed: observation.closed });
  process.exitCode = observation.closed ? 0 : 2;
}
