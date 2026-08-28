import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { executeCase, assertCase, matcherMap } from '../preparation-v2/cases.mjs';
import { assertLogicalVectors, guards, assertGuard } from '../preparation-v2/scenarios.mjs';
import { generator, digestSink } from '../preparation-v2/resources.mjs';
import { mockFS, sink } from '../mocks.mjs';
import { installLoader } from './loader.mjs';
import { runExtra } from './extra.mjs';

const jobRaw = await readFile(process.argv[2]);
assert.equal(createHash('sha256').update(jobRaw).digest('hex'), process.argv[3]);
const job = JSON.parse(jobRaw);
const loads = installLoader(job.root, job.entries, job.builtinMap);
const module = await import(pathToFileURL(path.join(job.root, 'dist/commands/xan/index.js')).href);
const contracts = await import(pathToFileURL(path.join(job.root, 'dist/contracts/index.js')).href);
assert.equal(module.createXanCommand().name, 'xan');
const emit = async value => { if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, 'drain'); };
let status = 'PASS'; let failure; let observation; let closed = true;
try {
  if (job.kind === 'case') {
    const record = await executeCase(module.createXanCommand().execute, job.row, { ...job.control,
      fs: { errorFactory: (code, filename) => new contracts.FsError(code, { path: filename }) } });
    observation = { status: record.result?.exitCode, failed: record.failed, error: record.failed ? { name: record.escaping?.name, message: String(record.escaping?.message ?? record.escaping) } : null,
      stdoutBase64: record.stdout.data.toString('base64'), stderrBase64: record.stderr.data.toString('base64'),
      files: Object.fromEntries(Object.entries(record.files).map(([name, data]) => [name, data.toString('base64')])),
      inputEvents: record.inputEvents, fsEvents: record.fsEvents, cleanup: record.cleanup, deliveryLengths: record.deliveryLengths, chargedInputBytes: record.chargedInputBytes };
    closed = record.cleanup.drained && record.cleanup.failures === 0;
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
    assert.ok(closed, 'cooperative cleanup incomplete');
    assertCase(job.row, record, matcherMap([job.row]));
    assertLogicalVectors(job.documents, job.row, record);
  } else if (job.kind === 'guard') {
    const spec = guards(job.limits)[job.guardIndex]; let ioCalls = 0; let refused = false; let error;
    const context = { command: 'xan', args: spec.value, cwd: '/work', env: {}, signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { ioCalls++; throw new Error('POISON_INPUT'); } },
      fs: new Proxy({}, { get() { ioCalls++; throw new Error('POISON_FS'); } }),
      stdout: { async write() { ioCalls++; } }, stderr: { async write() {} } };
    try { if (spec.kind === 'limit') module.createXanCommand({ limits: { [spec.name]: spec.value } }); else { const result = await module.createXanCommand().execute(context); refused = result.exitCode !== 0; } }
    catch (caught) { refused = true; error = caught; }
    observation = { ioCalls, refused, error: error ? { name: error.name, message: error.message } : null };
    await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation }); assertGuard(spec, observation);
  } else if (job.kind === 'resource') {
    const row = job.limit; const spec = generator(row, job.target, job.variant);
    if (spec.reachability.startsWith('NOT_REACHABLE')) { status = 'BLOCKED'; observation = { reason: spec.reachability, independent: spec.independent }; }
    else if (['maxWork', 'maxRetainedBytes'].includes(row.name)) {
      status = 'BLOCKED'; observation = { reason: 'Frozen synthetic event recipe lacks actual internal event/capacity observability; no fabricated product work counter or private instrumentation', independent: spec.independent, sourceAudit: job.sourceAudit };
    } else {
      const settings = { limits: { [row.name]: row.defaultValue, ...(job.overrides ?? {}) } };
      const output = digestSink(); const stderr = sink(65536, { retain: true }); let inputBytes = 0; let chunks = 0; const cleanups = [];
      const original = spec.input();
      const stdin = { async *[Symbol.asyncIterator]() { for await (const chunk of original) { chunks++; inputBytes += chunk.length; yield chunk; } } };
      const host = mockFS(Object.fromEntries(spec.files.map(file => [file.name, { utf8: file.utf8 }])), { errorFactory: (code, filename) => new contracts.FsError(code, { path: filename }), fileBytes: 65536 });
      let result; let escaping;
      try { result = await module.createXanCommand(settings).execute({ command: 'xan', args: spec.argv, cwd: '/work', env: {}, stdin, stdinIsDefault: false,
        fs: host.fs, stdout: output, stderr, signal: new AbortController().signal, registerCleanup(callback) { cleanups.push(callback); } }); }
      catch (error) { escaping = String(error?.stack ?? error); }
      const drain = await Promise.allSettled(cleanups.map(callback => callback())); closed = drain.every(record => record.status === 'fulfilled');
      const diagnostic = stderr.finish().data; const outputRecord = output.finish();
      observation = { result, escaping, inputBytes, chunks, output: outputRecord, stderrBase64: diagnostic.toString('base64'), independent: spec.independent, settings,
        cleanup: { closed, callbacks: cleanups.length }, scope: 'Actual default-boundary output and delivered input; internal capacity/work not instrumented' };
      await emit({ stage: 'RAW_OBSERVATION', id: job.id, observation });
      assert.ok(closed); assert.equal(escaping, undefined);
      assert.equal(result.exitCode, job.target > row.defaultValue ? 1 : 0);
      if (result.exitCode === 1) {
        const exact = Buffer.from(`xan ${spec.argv[0]}: ${row.name} limit exceeded\n`);
        assert.deepEqual(diagnostic, exact.length <= module.defaultLimits.maxOutputBytes - outputRecord.bytes ? exact : Buffer.alloc(0));
      } else {
        assert.equal(diagnostic.length, 0);
        if (spec.expectedStdout !== undefined) { const expected = Buffer.from(spec.expectedStdout); assert.equal(outputRecord.bytes, expected.length); assert.equal(outputRecord.sha256, createHash('sha256').update(expected).digest('hex')); }
        if (spec.output) { const expected = digestSink(); for await (const chunk of spec.output()) await expected.write(chunk); assert.deepEqual(outputRecord, expected.finish()); }
      }
    }
  } else {
    const result = await runExtra({ job, module, contracts, emit }); observation = result.observation; status = result.status ?? 'PASS'; closed = result.closed !== false;
  }
} catch (error) { status = 'FAIL'; failure = { name: error.name, message: error.message, stack: error.stack }; }
await emit({ stage: 'LOAD_PROOF', id: job.id, loads });
await emit({ stage: 'CASE', id: job.id, status, closed, intact: true, failure, ...(job.kind === 'resource' || job.kind === 'scenario' ? { observation } : {}) });
await emit({ stage: 'FINALIZATION', job: job.job, phase: job.phase, nonce: job.nonce, manifest: job.manifest,
  requiredIds: job.requiredIds, requiredCount: job.requiredIds.length, completedCount: 1, failures: status === 'PASS' ? 0 : 1, complete: true, closed, intact: true });
process.exitCode = status === 'PASS' ? 0 : 1;
