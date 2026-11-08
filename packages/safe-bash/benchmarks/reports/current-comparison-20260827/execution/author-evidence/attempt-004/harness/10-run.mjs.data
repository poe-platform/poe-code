import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadBinding, verifyClosure, executionRoot } from './binding.mjs';
import { loadCohorts, planCases } from './cohorts.mjs';
import { limitsFor } from './limits.mjs';
import { assessAttempt } from './assessment.mjs';
import { runAttempt } from './supervise.mjs';
import { hash, within, contained } from './io.mjs';

const [mode = 'PREPARE', ...arguments_] = process.argv.slice(2);
const options = {};
for (let index = 0; index < arguments_.length; index += 2) {
  assert.ok(['--binding', '--root-receipt', '--root-receipt-sha256', '--output'].includes(arguments_[index]) && arguments_[index + 1] && !options[arguments_[index]], 'unknown/duplicate/missing CLI option');
  options[arguments_[index]] = arguments_[index + 1];
}
assert.ok(['PREPARE', 'PREFLIGHT', 'MEASURE'].includes(mode), 'Only PREPARE, PREFLIGHT, MEASURE are supported; no timings or sentinel override');
const cohorts = loadCohorts(), plan = planCases(cohorts);
const counts = { original: 448, aligned: 448, breadth: { observations: 136, targets: 54, controls: 7, diagnostics: 7 }, unionScore: null };
if (mode === 'PREPARE') {
  console.log(JSON.stringify({ status: 'READY_FOR_BINDING_AND_REVIEW', preparationCommit: cohorts.preparationCommit, required: counts, productImports: 0, nativeCalls: 0, score: null }, null, 2));
} else {
  const bound = loadBinding(options['--binding'], options['--root-receipt'], options['--root-receipt-sha256']);
  if (bound.status === 'WAITING_ROOT') { console.log(JSON.stringify(bound, null, 2)); process.exitCode = 2; }
  else if (mode === 'PREFLIGHT') console.log(JSON.stringify({ status: bound.status, bindingSha256: bound.bindingSha256, receiptSha256: bound.receiptSha256, required: counts, productImports: 0, score: null }, null, 2));
  else {
    assert.equal(bound.node.path, realpathSync(process.execPath), 'Run CLI using the approved Node executable');
    const destination = options['--output'];
    assert.ok(destination && isAbsolute(destination) && !destination.split('/').includes('..'));
    const parent = realpathSync(dirname(destination)), canonicalDestination = resolve(parent, destination.split('/').at(-1));
    assert.ok(within(realpathSync('/tmp'), parent) || within(realpathSync(executionRoot), parent), 'output root is not owned');
    contained(parent, parent);
    await mkdir(canonicalDestination, { mode: 0o700 });
    const publish = async (name, value) => writeFile(resolve(canonicalDestination, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await publish('binding-receipt.json', { bindingSha256: bound.bindingSha256, receiptSha256: bound.receiptSha256, candidate: bound.binding.candidate, node: bound.node, profiles: bound.binding.profiles, required: counts, capturedNativeOnly: true });
    await publish('exact-inputs.json', plan.map(({ profile, engine, id, specimen, expected }) => ({ profile, engine, id, specimen, expected, recipeHash: hash(JSON.stringify(specimen)) })));
    const tables = { original: [], aligned: [], breadth: [] };
    let stopped = null;
    for (const [index, selection] of plan.entries()) {
      verifyClosure(bound.binding.runner, false);
      const selected = bound.engines[selection.engine];
      const request = { ...selection, nonce: randomUUID(), synthetic: false, caps: limitsFor(selection.profile, selection.specimen), heapMiB: selection.profile === 'breadth' ? selected.heapMiB : 256, host: bound.host, inputs: cohorts.profiles.breadth, load: { files: { ...bound.runner.files, ...selected.closure.files }, entry: selected.entry, packageName: selected.packageName, packagePath: selected.packagePath } };
      let journal = Promise.resolve();
      const filename = `attempt-${String(index + 1).padStart(4, '0')}`;
      const attempt = await runAttempt(request, { executable: bound.node.path, onEvent: event => { journal = journal.then(() => appendFile(resolve(canonicalDestination, `${filename}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 })); return journal; } });
      await journal;
      const assessment = assessAttempt(request, attempt);
      await publish(`${filename}.json`, { profile: selection.profile, engine: selection.engine, caseId: selection.id, recipeHash: hash(JSON.stringify(selection.specimen)), attempt, assessment });
      tables[selection.profile].push({ id: selection.id, engine: selection.engine, cohort: selection.specimen.cohort ?? selection.specimen.group, assessment, evidence: `${filename}.json` });
      if (!attempt.groupGone) { stopped = { id: selection.id, engine: selection.engine, reason: 'unverified owned group closure; further admission prohibited' }; break; }
    }
    const post = { runner: verifyClosure(bound.binding.runner, false), engines: Object.fromEntries(Object.entries(bound.binding.engines).map(([name, value]) => [name, verifyClosure(value.closure)])) };
    await publish('post-membership.json', post);
    for (const [profile, rows] of Object.entries(tables)) await publish(`${profile}.json`, { required: counts[profile], observations: rows, complete: rows.length === (profile === 'breadth' ? 136 : 448), unionScore: null });
    await publish('summary.json', { status: stopped ? 'STOPPED_UNVERIFIED_CLOSURE' : 'MEASURED_NOT_REVIEWED', actual: Object.fromEntries(Object.entries(tables).map(([profile, rows]) => [profile, rows.length])), required: counts, stopped, timing: 'not performed; functional sleep predicate and lifecycle clocks only', unionScore: null });
    console.log(JSON.stringify({ destination: canonicalDestination, stopped, required: counts, reviewRequired: true }, null, 2));
  }
}
