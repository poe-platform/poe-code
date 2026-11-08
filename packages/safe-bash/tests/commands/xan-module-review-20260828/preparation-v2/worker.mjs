import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { ROOT, verifyRecipe } from './integrity.mjs';
import { exactJson, verifyTree, sha } from '../core.mjs';
import { installGuard } from '../guard.mjs';
import { executeCase, assertCase, matcherMap, beforeIO, headerBoundary } from './cases.mjs';
import { exampleDiagnostic } from './diagnostics.mjs';
import { scenarios, assertScenario, references, guards, assertGuard, assertLogicalVectors, flagVariants } from './scenarios.mjs';
import { matcher } from './diagnostics.mjs';
import { generator, assertResourceTrace, smallTarget } from './resources.mjs';

await verifyRecipe();
const [filename, count, digest] = process.argv.slice(2);
const job = await exactJson(filename, { bytes: Number(count), sha256: digest });
assert.ok(['SOURCE', 'INSTALLED_MOVED'].includes(job.layout));
const synthetic = job.authorization === 'SEALED_SYNTHETIC_ONLY';
if (!synthetic) {
  assert.equal(job.authorization, 'ROOT_ROUTED_CANDIDATE');
  const authority = await exactJson(job.authority.path, job.authority);
  assert.equal(authority.action, 'RUN_DIFFERENT_XAN_REVIEW');
  assert.equal(authority.candidate, job.candidate);
  assert.equal(authority.handoffSha256, job.handoffSha256);
  assert.equal(authority.preparationRecipe, job.recipeCommit);
  assert.equal(authority.sourceInspectionRouted, true);
}
const map = JSON.parse(await readFile(path.join(ROOT, 'CASE-MAP.json'), 'utf8'));
assert.equal(job.rows.length, 138);
for (const row of job.rows) assert.equal(sha(JSON.stringify(row)), map.normalizedRows.find(entry => entry.id === row.id)?.sha256, 'immutable fixture row');
const cohort = JSON.parse(await readFile(path.join(ROOT, 'COHORT.json'), 'utf8'));
assert.deepEqual(job.jobs, cohort.controls.filter(control => control.kind === 'case').map(control => control.job));
assert.equal(sha(JSON.stringify(job.documents)), map.executionDocumentsSha256);
await verifyTree(job.root, job.entries);
installGuard(job.root, job.entries, job.builtins);
const module = await import(pathToFileURL(path.join(job.root, job.entry)).href);
let adapter;
if (synthetic) {
  assert.equal(job.classification, 'SYNTHETIC_FIXTURE_NOT_PRODUCT');
  assert.equal(module.classification, 'SYNTHETIC_FIXTURE_NOT_PRODUCT');
  adapter = module.openFixtureReview();
} else {
  const adapterModule = await import(pathToFileURL(path.join(job.root, job.adapter)).href);
  assert.equal(typeof adapterModule.openReview, 'function');
  adapter = await adapterModule.openReview({ module, factoryExport: job.factoryExport, options: job.options });
  assert.equal(typeof adapter.command?.execute, 'function'); assert.equal(adapter.command.name, 'xan');
  for (const driver of ['runShell', 'runLifecycle', 'runFilesystem', 'runResource', 'runGuard']) assert.equal(typeof adapter[driver], 'function');
}
const matchers = matcherMap(job.rows);
let failures = 0;
async function emit(value) { if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, 'drain'); }
const rows = new Map(job.rows.map(row => [row.id, row]));
for (const control of job.jobs) {
  const row = rows.get(control.row);
  const command = synthetic ? module.createFixtureCommand({ classification: job.classification, row, beforeIO: beforeIO(row),
    headerEndByte: row.phase === 'AFTER_FIRST_RECORD_BEFORE_SELECTED_OUTPUT' ? headerBoundary(row) : null,
    diagnostic: row.expected.stderr.precision ? exampleDiagnostic(row) : null }) : adapter.command;
  const record = await executeCase(command.execute.bind(command), row, control);
  await emit({ id: control.id, stage: 'RAW_RECEIPT', scope: synthetic ? 'SYNTHETIC_NOT_PRODUCT' : 'DIRECT_COMMAND',
    status: record.result?.exitCode, failed: record.failed, stdoutBase64: record.stdout.data.toString('base64'), stderrBase64: record.stderr.data.toString('base64'),
    files: Object.fromEntries(Object.entries(record.files).map(([name, data]) => [name, data.toString('base64')])),
    inputEvents: record.inputEvents, fsEvents: record.fsEvents, cleanup: record.cleanup });
  if (!record.cleanup.drained || record.cleanup.failures) { process.exitCode = 2; throw new Error('CLEANUP_BREAK_STOP_DEPENDENTS'); }
  await verifyTree(job.root, job.entries);
  try { assertCase(row, record, matchers); assertLogicalVectors(job.documents, row, record); await emit({ id: control.id, status: 'ASSERTED' }); }
  catch (error) { failures++; await emit({ id: control.id, status: 'FAILED', error: error.message.slice(0, 1024) }); }
}
for (const variant of flagVariants(job.rows)) {
  const row = { ...variant, id: variant.originalId };
  const command = synthetic ? module.createFixtureCommand({ classification: job.classification, row, beforeIO: beforeIO(row), headerEndByte: null,
    diagnostic: row.expected.stderr.precision ? exampleDiagnostic(row) : null }) : adapter.command;
  const validators = new Map(matchers);
  if (row.expected.stderr.precision) validators.set(row.id, matcher(row));
  const record = await executeCase(command.execute.bind(command), row);
  await emit({ id: variant.id, stage: 'RAW_RECEIPT', status: record.result?.exitCode, stdout: record.stdout.data.toString('base64'), stderr: record.stderr.data.toString('base64'), cleanup: record.cleanup });
  if (!record.cleanup.drained || record.cleanup.failures) throw new Error('FLAG_CLEANUP_BREAK');
  await verifyTree(job.root, job.entries);
  try { assertCase(row, record, validators); await emit({ id: variant.id, status: 'ASSERTED' }); }
  catch (error) { failures++; await emit({ id: variant.id, status: 'FAILED', error: error.message.slice(0, 1024) }); }
}
{
  for (const spec of scenarios()) {
    const refs = references(spec);
    const driver = spec.family === 'F01' ? adapter.runShell : ['F08', 'F07', 'F09'].includes(spec.family) ? adapter.runLifecycle : adapter.runFilesystem;
    const record = await driver.call(adapter, spec, refs);
    await emit({ id: spec.id, stage: 'RAW_RECEIPT', record });
    if (!record.closed || !record.intact) throw new Error('DRIVER_NOT_CLOSED_OR_INTACT');
    await verifyTree(job.root, job.entries);
    try { assertScenario(spec, record, refs); await emit({ id: spec.id, status: 'ASSERTED' }); }
    catch (error) { failures++; await emit({ id: spec.id, status: 'FAILED', error: error.message.slice(0, 1024) }); }
  }
  for (const row of job.documents['final-freeze-v3/LIMITS.json'].rows) {
    const center = synthetic ? smallTarget(row.name) : row.defaultValue;
    for (const target of [center - 1, center, center + 1]) {
      const spec = generator(row, target);
      spec.configuredLimit = center;
      if (spec.reachability.startsWith('NOT_REACHABLE')) { await emit({ id: row.name, target, status: spec.reachability }); continue; }
      const record = await adapter.runResource(spec);
      await emit({ id: row.name, target, stage: 'RAW_RECEIPT', record });
      if (!record.closed || !record.intact) throw new Error('RESOURCE_DRIVER_NOT_CLOSED');
      await verifyTree(job.root, job.entries);
      try { assertResourceTrace(spec, record); await emit({ id: row.name, target, status: 'ASSERTED' }); }
      catch (error) { failures++; await emit({ id: row.name, target, status: 'FAILED', error: error.message.slice(0, 1024) }); }
    }
  }
  for (const spec of guards(job.documents['final-freeze-v3/LIMITS.json'].rows)) {
    const record = await adapter.runGuard(spec);
    await emit({ id: spec.id, stage: 'RAW_RECEIPT', record });
    if (!record.closed || !record.intact) throw new Error('GUARD_DRIVER_NOT_CLOSED');
    try { assertGuard(spec, record); await emit({ id: spec.id, status: 'ASSERTED' }); }
    catch (error) { failures++; await emit({ id: spec.id, status: 'FAILED', error: error.message.slice(0, 1024) }); }
  }
  await adapter.dispose();
}
await verifyTree(job.root, job.entries);
await emit({ phase: job.layout, requiredPhase: job.layout, complete: true, failures, synthetic, directCases: job.jobs.length, closed: true });
process.exitCode = failures ? 1 : 0;
