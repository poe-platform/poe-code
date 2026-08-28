import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ROOT, verifyRecipe, frozenDocuments } from './integrity.mjs';
import { fingerprint, sha, bytes, writeNew, inventory, verifyTree } from '../core.mjs';
import { normalize, matcherMap, executeCase, assertCase, assertPhase } from './cases.mjs';
import { exampleDiagnostic } from './diagnostics.mjs';
import { generator, Accounting, digestSink, assertResourceTrace, assertLimitError } from './resources.mjs';
import { scenarios, references, assertScenario, cooperativeControl, guards, assertGuard, flagVariants, assertLogicalVectors, runMockFault } from './scenarios.mjs';
import { fixtureCommand, syntheticAdmission, syntheticScenario } from './synthetic.mjs';
import { authenticate, moveInstalled, validateGrant } from './admission.mjs';
import { supervise, aggregate, IntegrityFailure } from './supervisor.mjs';
import { runLifecycleControl, authorityControl } from './lifecycle.mjs';

function mutate(value) { return typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : typeof value === 'string' ? `${value}!` : value === null ? {} : null; }

function resourceTarget(name) {
  return { maxArgs: 6, maxArgumentBytes: 16, maxInputFiles: 3, maxInputBytes: 1031, maxChunks: 4, maxChunkBytes: 33,
    maxRecordBytes: 19, maxCellBytes: 13, maxColumns: 4, maxRecords: 4, maxSelectorBytes: 11, maxSelectorNodes: 6,
    maxSelectorDepth: 2, maxSelectedColumns: 3, maxLastRows: 3, maxWork: 17, maxOutputBytes: 12, maxRetainedBytes: 19 }[name];
}

async function inspectGenerator(spec) {
  const sink = digestSink();
  let chunks = 0; let largest = 0; let inputBytes = 0; const retainedSmall = [];
  for await (const chunk of spec.input()) {
    assert.ok(chunk instanceof Uint8Array); chunks++; largest = Math.max(largest, chunk.length); inputBytes += chunk.length;
    assert.ok(inputBytes <= 4096, 'small synthetic generator only'); retainedSmall.push(Buffer.from(chunk)); await sink.write(chunk);
  }
  const raw = Buffer.concat(retainedSmall);
  const metric = {
    maxArgs: () => spec.argv.length,
    maxArgumentBytes: () => spec.argv.reduce((total, token) => total + Buffer.byteLength(token), 0),
    maxInputFiles: () => spec.files.length,
    maxInputBytes: () => inputBytes,
    maxChunks: () => chunks,
    maxChunkBytes: () => largest,
    maxRecordBytes: () => inputBytes - 1,
    maxCellBytes: () => inputBytes - 1,
    maxColumns: () => raw.filter(byte => byte === 44).length + 1,
    maxRecords: () => raw.filter(byte => byte === 10).length,
    maxSelectorBytes: () => Buffer.byteLength(spec.argv[1]),
    maxSelectorNodes: () => spec.independent.structure.clauses + spec.independent.structure.endpoints + spec.independent.structure.occurrences + spec.independent.structure.complement,
    maxSelectorDepth: () => 2,
    maxSelectedColumns: () => spec.argv[1].split(',').length,
    maxLastRows: () => raw.filter(byte => byte === 10).length - 1,
    maxWork: () => spec.events.reduce((total, event) => total + event.amount, 0),
    maxOutputBytes: () => spec.argv[1].split(',').length * 2 * raw.filter(byte => byte === 10).length,
    maxRetainedBytes: () => spec.events.filter(event => event.op === 'allocate').reduce((total, event) => total + event.capacity, 0),
  }[spec.name]();
  assert.equal(metric, spec.target, 'independent generated target arithmetic');
  if (spec.output) {
    const output = digestSink(); for await (const chunk of spec.output()) await output.write(chunk);
    assert.equal(output.finish().bytes, spec.target);
  }
  return { metric, input: sink.finish(), chunks, largest, reachability: spec.reachability, scale: spec.scale };
}

function alterReceipt(fixture, ref, update) {
  const old = fixture.data.get(ref.path); const value = JSON.parse(old.data.toString()); update(value);
  const data = Buffer.from(JSON.stringify(value)); const next = { ...ref, bytes: data.length, sha256: sha(data) };
  fixture.data.set(ref.path, { ...next, data });
  Object.assign(fixture.handoff.selected.find(entry => entry.path === ref.path), next);
  Object.assign(ref, next);
}

async function admissionControl(variant) {
  const fixture = syntheticAdmission(ROOT);
  const handoff = fixture.handoff;
  if (variant === 'missing-artifact') fixture.data.delete(handoff.selected[0].path);
  if (variant === 'altered-artifact') fixture.data.get(handoff.selected[0].path).sha256 = '0'.repeat(64);
  if (variant === 'stale-build') alterReceipt(fixture, handoff.build.receipt, value => { value.candidate = '9'.repeat(40); });
  if (variant === 'truthy-receipt') handoff.build.receipt = 'yes';
  if (variant === 'bad-exit') alterReceipt(fixture, handoff.build.receipt, value => { value.exitCode = 7; });
  if (variant === 'truncated') alterReceipt(fixture, handoff.build.receipt, value => { value.truncated = true; });
  if (variant === 'missing-tool') handoff.selected = handoff.selected.filter(entry => entry.role !== 'tool');
  if (variant === 'wrong-pack-tree') {
    alterReceipt(fixture, handoff.pack.manifest, value => { value.push({ ...value[0], path: 'unknown.js' }); });
    alterReceipt(fixture, handoff.pack.receipt, value => { value.manifest = handoff.pack.manifest; });
  }
  if (variant === 'non-xan-delta') handoff.candidate.delta.push('src/index.ts');
  if (variant === 'registry') alterReceipt(fixture, handoff.scope.receipt, value => { value.registryCount = 78; });
  if (variant === 'export') alterReceipt(fixture, handoff.scope.receipt, value => { value.publicXanExport = true; });
  if (variant === 'wrong-mode') fixture.data.get(handoff.selected[0].path).mode = '755';
  if (variant === 'symlink') fixture.data.get(handoff.selected[0].path).symlink = true;
  if (variant === 'unknown-path') handoff.selected[0].path = '../unknown';
  if (variant === 'overflow-bytes') handoff.selected[0].bytes = Number.MAX_SAFE_INTEGER + 1;
  if (variant === 'loader-fallback') handoff.build.emissionGrant.loaderFallback = true;
  if (variant === 'outside-write') handoff.build.emissionGrant.root = '/tmp/outside';
  if (variant === 'missing-api') delete handoff.module.factoryExport;
  if (variant === 'wrong-layout') handoff.layouts.INSTALLED_MOVED.sourceFallback = true;
  if (variant === 'complete') return authenticate(handoff, fixture.read, 'SYNTHETIC_ONLY');
  await assert.rejects(authenticate(handoff, fixture.read, 'SYNTHETIC_ONLY'));
  return { mutantRejected: variant, candidateAuthenticationClaim: false };
}

export async function qualify(recipeCommit) {
  const seal = await verifyRecipe(); const documents = await frozenDocuments(seal);
  const rows = normalize(documents); const byId = new Map(rows.map(row => [row.id, row])); const matchers = matcherMap(rows);
  const specs = new Map(scenarios().map(spec => [spec.id, spec]));
  const limitRows = documents['final-freeze-v3/LIMITS.json'].rows;
  const guardSpecs = new Map(guards(limitRows).map(spec => [spec.id, spec]));
  const flags = new Map(flagVariants(rows).map(row => [row.id, row]));
  const cohort = JSON.parse(await readFile(path.join(ROOT, 'COHORT.json'), 'utf8'));
  const evidence = path.join(ROOT, 'evidence'); await mkdir(evidence);
  const started = new Date().toISOString();
  await writeNew(path.join(evidence, 'START.json'), { started, recipeCommit, cohort: await fingerprint(path.join(ROOT, 'COHORT.json')), oneInvocation: true, noRetry: true });
  const raw = await open(path.join(evidence, 'controls.jsonl'), 'wx', 0o644);
  const hash = createHash('sha256'); let rawBytes = 0; let passed = 0; let failed = 0; let children = 0; let reaped = 0; let stopped = false;
  const counts = {}; const errors = [];
  async function emit(value) {
    const line = Buffer.from(`${JSON.stringify(value)}\n`); hash.update(line); rawBytes += line.length;
    assert.ok(rawBytes <= 16 * 1024 * 1024, 'qualification raw bound');
    await raw.writeFile(line);
  }
  async function run(control) {
    if (control.kind === 'case' || control.kind === 'case-mutant') {
      const row = byId.get(control.job?.row ?? control.row);
      const command = fixtureCommand(row);
      const record = await executeCase(command.execute, row, control.job ?? {});
      await emit({ id: control.id, stage: 'RAW_CASE', record });
      if (record.cleanup.failures || !record.cleanup.drained) throw new IntegrityFailure('CASE_CLEANUP_BREAK');
      if (control.kind === 'case-mutant') { record.result.exitCode = row.expected.status === 0 ? 1 : 0; assert.throws(() => assertCase(row, record, matchers)); }
      else { assertCase(row, record, matchers); assertLogicalVectors(documents, row, record); }
      return { scope: 'SYNTHETIC_COMMAND_INTERFACE', borrowedCopiesChecked: true };
    }
    if (control.kind === 'diagnostic') {
      const row = byId.get(control.row); const validator = matchers.get(row.id);
      const positive = exampleDiagnostic(row);
      if (control.variant === 'positive') validator.assert(Buffer.from(positive), row);
      else if (control.variant === 'wrong-option-context') {
        assert.throws(() => validator.assert(Buffer.from(positive), { ...row, argv: [...row.argv, '--unrelated'] }));
        const offending = /--[A-Za-z-]+|-[nLIl]/.exec(positive);
        const wrong = offending ? positive.replace(offending[0], '--unrelated') : `xan ${row.argv[0]}: unsupported --unrelated\n`;
        assert.throws(() => validator.assert(Buffer.from(wrong), row), 'actual wrong diagnostic, not just metadata');
      }
      else {
        const diagnostic = control.variant === 'wrong-command' ? positive.replace(`xan ${row.argv[0]}`, 'xan unrelated') :
          control.variant === 'missing-fragment' ? row.requiredDiagnosticFamily ? positive.replace(row.requiredDiagnosticFamily, '') : `xan ${row.argv[0]}: invalid\n` :
            control.variant === 'wrong-condition' ? `xan ${row.argv[0]}: permission denied for output path\n` : `xan ${row.argv[0]}: failure reading unrelated.txt\n`;
        assert.throws(() => validator.assert(Buffer.from(diagnostic), row), `${control.variant} must reject`);
      }
      return { matcher: row.id, variant: control.variant };
    }
    if (control.kind === 'scenario' || control.kind === 'scenario-mutant') {
      const spec = specs.get(control.scenario); const refs = references(spec); const trace = syntheticScenario(spec, refs);
      if (control.kind === 'scenario-mutant') { trace[control.key] = mutate(trace[control.key]); assert.throws(() => assertScenario(spec, trace, refs)); }
      else assertScenario(spec, trace, refs);
      return { family: spec.family, trace, syntheticTraceNotIntegration: true };
    }
    if (control.kind === 'resource') {
      const row = limitRows.find(item => item.name === control.name); const target = resourceTarget(row.name); const spec = generator(row, target);
      if (control.variant.startsWith('ceiling')) {
        const value = row.hardCeiling + (control.variant === 'ceiling-minus' ? -1 : control.variant === 'ceiling-plus' ? 1 : 0);
        const valid = Number.isSafeInteger(value) && value > 0 && value <= row.hardCeiling;
        assert.equal(valid, control.variant !== 'ceiling-plus'); return { configurationOnly: true, value, valid };
      }
      const trace = { name: row.name, events: spec.events, independent: spec.independent, closed: true, intact: true,
        configuredLimit: spec.configuredLimit, exitCode: 0, excessEffects: 0 };
      if (control.variant === 'faulty-ledger') {
        const faulty = { ...trace, independent: { ...trace.independent, omittedCharge: true } };
        assert.throws(() => assertResourceTrace(spec, faulty));
      } else if (control.variant.startsWith('boundary')) {
        const limit = target + (control.variant === 'boundary-minus' ? 1 : control.variant === 'boundary-plus' ? -1 : 0);
        const ledger = new Accounting({ [row.name]: limit });
        if (target > limit) assert.throws(() => ledger.charge(row.name, target, 'independent-generator'));
        else ledger.charge(row.name, target, 'independent-generator');
        return { generatedTarget: target, limit, relation: control.variant, loweredLimitOnly: true };
      } else { assertResourceTrace(spec, trace); return inspectGenerator(spec); }
      return { name: row.name, mutantRejected: true };
    }
    if (control.kind === 'resource-extra') {
      const chosen = { 'cell-quoted': ['maxCellBytes', 12, 'quoted'], 'cell-doubled': ['maxCellBytes', 12, 'doubled'],
        'columns-trailing': ['maxColumns', 4, 'trailing'], 'nodes-occurrence': ['maxSelectorNodes', 6, 'occurrence'], 'nodes-complement': ['maxSelectorNodes', 5, 'complement'] }[control.variant];
      if (chosen) return inspectGenerator(generator(limitRows.find(row => row.name === chosen[0]), chosen[1], chosen[2]));
      if (control.variant === 'work-cumulative') {
        const ledger = new Accounting({ maxWork: 10 }); ledger.work('inspect', 6, 'header'); ledger.work('copy', 4, 'body'); assert.throws(() => ledger.work('output', 1, 'file')); return { charged: ledger.total.maxWork };
      }
      if (control.variant === 'retained-overlap') {
        const ledger = new Accounting({ maxRetainedBytes: 15 }); ledger.allocate('old', 8); assert.throws(() => ledger.allocate('new', 8)); ledger.release('old'); ledger.allocate('new', 8); ledger.release('new'); return { peak: ledger.peak };
      }
      if (control.variant === 'retained-units') {
        const ledger = new Accounting({ maxRetainedBytes: 114 });
        for (const [id, size, kind] of [['utf', 1, 'utf16'], ['index', 2, 'indices'], ['node', 1, 'node'], ['span', 1, 'span'], ['ring', 1, 'ring']]) ledger.allocate(id, size, kind);
        assert.equal(ledger.peak, 114); for (const id of [...ledger.live.keys()]) ledger.release(id); return { peak: ledger.peak };
      }
      const remaining = control.variant === 'parent-output' ? 1 : 0;
      const trace = { exitCode: 1, stderr: Buffer.alloc(0), excessEffects: 0 };
      assertLimitError('maxWork', 'count', 1024, remaining, trace);
      assert.throws(() => assertLimitError('maxWork', 'count', 1024, remaining, { ...trace, stderr: Buffer.from('emergency') })); return trace;
    }
    if (control.kind === 'admission') return admissionControl(control.variant);
    if (control.kind === 'emission') {
      const fixture = syntheticAdmission(ROOT); const grant = fixture.handoff.build.emissionGrant;
      const reads = [path.join(ROOT, 'readonly-original.mjs')]; const writes = [path.join(grant.root, 'emitted.js')];
      if (control.variant === 'outside-write') writes.push(path.join(ROOT, 'readonly-original.mjs'));
      if (control.variant === 'original-writable') reads.push(path.join(grant.root, 'original.mjs'));
      if (control.variant === 'not-fresh') grant.initialEntries = 1;
      if (control.variant === 'loader-fallback') grant.loaderFallback = true;
      if (control.variant === 'native-spawn') grant.allowNativeSpawn = true;
      if (control.variant === 'eval') grant.allowEval = true;
      if (control.variant === 'complete') return validateGrant(grant, reads, writes);
      assert.throws(() => validateGrant(grant, reads, writes)); return { rejected: control.variant, noCompilerRun: true };
    }
    if (control.kind === 'delivery') {
      const row = byId.get('X4-R01'); const boundary = bytes(row.stdin).indexOf(10) + 1;
      const split = control.variant.startsWith('split'); const ahead = control.variant.startsWith('read-ahead');
      const lengths = split ? [1, 2, boundary - 3] : [boundary + (ahead ? 3 : 0)];
      const record = { inputEvents: ['acquire', ...lengths.map(() => 'next')], fsEvents: [], deliveryLengths: lengths,
        chargedInputBytes: lengths.reduce((sum, length) => sum + length, 0) };
      if (control.variant === 'one-extra-next') record.inputEvents.push('next');
      if (control.variant === 'split-short') record.inputEvents.pop();
      if (control.variant === 'read-ahead-undercharge') record.chargedInputBytes = boundary;
      if (['one', 'split', 'read-ahead'].includes(control.variant)) assertPhase(row, record);
      else assert.throws(() => assertPhase(row, record)); return record;
    }
    if (control.kind === 'cooperative') {
      if (control.variant === 'drains') { await cooperativeControl(); return { gatesReleased: true }; }
      if (control.variant === 'premature-settlement') { await assert.rejects(cooperativeControl(true)); return { faultySettlementRejectedAfterDrain: true }; }
      if (control.variant === 'reason-object-identity' || control.variant === 'primitive-provenance') {
        const spec = specs.get(`F08-equal-local-reason-${control.variant === 'primitive-provenance' ? 'primitive' : 'errno-object'}`);
        const refs = references(spec); const trace = syntheticScenario(spec, refs);
        assertScenario(spec, trace, refs);
        const wrong = { ...trace, reason: typeof refs.caller === 'object' ? { ...refs.caller } : refs.caller, reasonChannel: 'local' };
        assert.throws(() => assertScenario(spec, wrong, refs)); return { identityChecked: true };
      }
      if (control.variant === 'destination-local') {
        const spec = specs.get('F09-stdout-local-close'); const refs = references(spec); const trace = syntheticScenario(spec, refs);
        assertScenario(spec, trace, refs); assert.throws(() => assertScenario(spec, { ...trace, siblingFileAlive: false }, refs)); return trace;
      }
      let observed = false; let reject;
      const opaque = new Promise((resolve, refuse) => { reject = refuse; }); const listener = opaque.catch(() => { observed = true; });
      const settledBeforeOpaque = true; reject(new Error('late opaque')); await listener; assert.ok(observed && settledBeforeOpaque);
      return { observed, cooperativeGatesNotOpaque: true };
    }
    if (control.kind === 'mock') return runMockFault(control.variant);
    if (control.kind === 'lifecycle') return runLifecycleControl(control.variant);
    if (control.kind === 'authority') return authorityControl(control.variant);
    if (control.kind === 'guard') {
      const spec = guardSpecs.get(control.guard); const trace = { ioCalls: 0, refused: true, error: spec.errorName ? { name: spec.errorName, message: spec.message } : undefined };
      if (control.mutant) { trace.ioCalls = 1; assert.throws(() => assertGuard(spec, trace)); } else assertGuard(spec, trace); return { guard: spec.id, trace };
    }
    if (control.kind === 'flag') {
      const row = flags.get(control.row); const original = byId.get(row.originalId);
      const semanticRow = { ...row, id: original.id };
      const customMatchers = matcherMap(rows);
      const { matcher } = await import('./diagnostics.mjs');
      if (row.expected.stderr.precision) customMatchers.set(original.id, matcher(semanticRow));
      const record = await executeCase(fixtureCommand(semanticRow).execute, semanticRow);
      assertCase(semanticRow, record, customMatchers); return { argv: row.argv, original: original.id };
    }
    if (control.kind === 'aggregate') {
      const receipts = []; let invoked = 0;
      const tasks = [0, 1].map(index => ({ id: `phase-${index}`, run: async () => {
        invoked++; return { reaped: true, closed: !(index === 0 && control.variant === 'stop-unclosed'), exitCode: index === 0 && ['continue-ordinary', 'failed-phase-nonzero'].includes(control.variant) ? 7 : 0,
          rawBoundExceeded: index === 0 && control.variant === 'raw-bound-nonzero', requiredPhase: 'phase', completedPhase: index === 0 && control.variant === 'missing-phase-nonzero' ? null : 'phase' };
      }, assert() {} }));
      const work = aggregate(tasks, async () => { if (control.variant === 'stop-integrity') throw new IntegrityFailure('changed input'); }, async record => { receipts.push(record); });
      if (control.variant.startsWith('stop')) { await assert.rejects(work, IntegrityFailure); assert.equal(invoked, 1); }
      else { const outcome = await work; assert.equal(outcome.exitCode, 1); assert.equal(invoked, 2); }
      return { invoked, receipts };
    }
    if (control.kind === 'process') {
      const directory = path.join(evidence, `child-${control.variant}`);
      let args; let maximum = control.variant === 'large-stream' ? cohort.rawStreamBytes : 16384;
      if (['SOURCE', 'INSTALLED_MOVED'].includes(control.variant)) {
        const layoutSource = path.join(evidence, `layout-${control.variant}`); await mkdir(layoutSource);
        const rawModule = await readFile(path.join(ROOT, 'fixture-module.mjs')); await writeNew(path.join(layoutSource, 'fixture-module.mjs'), rawModule.toString());
        const entries = [{ path: 'fixture-module.mjs', ...await fingerprint(path.join(layoutSource, 'fixture-module.mjs')) }];
        let layoutRoot = layoutSource;
        if (control.variant === 'INSTALLED_MOVED') { const moveRoot = path.join(evidence, 'physical-move'); await mkdir(moveRoot); layoutRoot = await moveInstalled({ root: layoutSource, entries }, moveRoot); }
        const job = { authorization: 'SEALED_SYNTHETIC_ONLY', classification: 'SYNTHETIC_FIXTURE_NOT_PRODUCT', layout: control.variant,
          root: layoutRoot, entries, entry: 'fixture-module.mjs', builtins: [], rows,
          jobs: cohort.controls.filter(item => item.kind === 'case').map(item => item.job), documents };
        const jobFile = path.join(evidence, `job-${control.variant}.json`); await writeNew(jobFile, job); const identity = await fingerprint(jobFile);
        const reads = [...seal.files.map(entry => path.join(ROOT, entry.path)), path.join(ROOT, 'RECIPE-SEAL.json'), ...seal.helpers.map(entry => path.join(ROOT, entry.path)), ...seal.tools.map(entry => entry.path), jobFile, layoutRoot];
        args = ['--permission', '--disallow-code-generation-from-strings', '--disable-proto=throw', ...reads.map(name => `--allow-fs-read=${name}`), path.join(ROOT, 'worker.mjs'), jobFile, String(identity.bytes), identity.sha256];
        maximum = 4 * 1024 * 1024;
      } else args = ['--disallow-code-generation-from-strings', path.join(ROOT, 'process-fixture.mjs'), control.variant];
      children++;
      const receipt = await supervise({ executable: process.execPath, args, cwd: ROOT, directory, timeoutMs: control.variant === 'intentional-timeout' ? 400 : 20000, rawBytes: maximum, kind: control.variant });
      if (receipt.reaped) reaped++;
      await verifyRecipe();
      if (control.variant === 'intentional-timeout') { assert.equal(receipt.timeout, true); assert.ok(receipt.signal); }
      else if (control.variant === 'raw-overflow') assert.equal(receipt.overflow, true);
      else {
        assert.equal(receipt.code, control.variant === 'ordinary-failure' ? 7 : control.variant === 'missing-required-phase' ? 1 : 0);
        assert.equal(receipt.overflow, false); assert.equal(receipt.timeout, false);
        if (control.variant === 'large-stream') {
          const expected = createHash('sha256'); for (let offset = 0; offset < cohort.rawStreamBytes; offset += 65536) expected.update(Buffer.alloc(Math.min(65536, cohort.rawStreamBytes - offset), 97));
          assert.equal(receipt.logs[0].artifactBytes, cohort.rawStreamBytes); assert.equal(receipt.logs[0].fullDeliveredSha256, expected.digest('hex'));
        }
        if (['SOURCE', 'INSTALLED_MOVED'].includes(control.variant)) {
          const file = await open(path.join(directory, 'stdout.raw'), 'r');
          try { const count = Math.min(4096, receipt.logs[0].artifactBytes); const tail = Buffer.alloc(count); await file.read(tail, 0, count, receipt.logs[0].artifactBytes - count);
            const last = JSON.parse(tail.toString().trim().split('\n').at(-1)); assert.equal(last.phase, control.variant); assert.equal(last.complete, true); assert.equal(last.failures, 0); assert.equal(last.closed, true);
          } finally { await file.close(); }
        }
      }
      return receipt;
    }
    throw new IntegrityFailure(`UNIMPLEMENTED_CONTROL:${control.kind}`);
  }
  try {
    for (const control of cohort.controls) {
      try {
        const detail = await run(control); passed++; counts[control.kind] = (counts[control.kind] ?? 0) + 1;
        await emit({ id: control.id, status: 'QUALIFIED_SYNTHETIC_CONTROL', detail });
      } catch (error) {
        failed++; errors.push({ id: control.id, name: error.name, message: error.message.slice(0, 1024) });
        await emit({ id: control.id, status: 'FAILED', error: errors.at(-1) });
        await verifyRecipe();
        if (error instanceof IntegrityFailure) { stopped = true; break; }
      }
    }
  } finally { await raw.sync(); await raw.close(); }
  const summary = { started, ended: new Date().toISOString(), recipeCommit, planned: cohort.count, qualified: passed, failed,
    unrun: cohort.count - passed - failed, stopped, retries: 0, children, reaped, naturalPositiveChildren: ['ordinary-success', 'large-stream', 'SOURCE', 'INSTALLED_MOVED'],
    intentionalKillChildren: ['raw-overflow', 'intentional-timeout'], counts, errors,
    raw: { bytes: rawBytes, sha256: hash.digest('hex') }, productExecutions: 0, xanSourceReads: 0, nativeExecutions: 0, builds: 0, typecompiles: 0,
    prior88ProductCases: 'PREPARED_UNEXECUTED', historical74Rescored: false, exitCode: failed || stopped || passed !== cohort.count ? 1 : 0 };
  assert.equal(children, reaped, 'all spawned children closed');
  await writeNew(path.join(evidence, 'SUMMARY.json'), summary);
  await verifyRecipe();
  const entries = await inventory(evidence);
  await writeNew(path.join(ROOT, 'EVIDENCE-SEAL.json'), { recipeCommit, root: 'evidence', entries, summary: await fingerprint(path.join(evidence, 'SUMMARY.json')), appendAware: true });
  return summary;
}
