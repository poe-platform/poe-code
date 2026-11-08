import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestFile, assertInventory } from '../execution-prep-v1/admission.mjs';
import { hash, inventory, packInventory } from '../execution-prep-v1/artifacts.mjs';
import { classify } from '../execution-prep-v1/protocol.mjs';
import { cases } from '../execution-prep-v1/plan.mjs';

export const acceptedComposition = '099455f232870fa1ea59e1a0ae482e003fd170db';
export const mutableSources = ['src/shell/runtime.ts', 'src/shell/shell.ts'];
const mutablePackage = /^dist\/shell\/(?:runtime|shell)\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u;
export const mandatoryGuardIds = ['manifest-digest', 'manifest-missing', 'node-path', 'node-hash', 'node-version', 'kind-candidate', 'composition', 'package-digest', 'module-missing', 'module-tamper', 'declaration-tamper', 'unbound-overlay', 'module-symlink', 'required-file'];

export function sourceDelta(binding, candidateInputs) {
  const ordered = [...candidateInputs].sort((left, right) => left.path.localeCompare(right.path));
  const baseline = [...binding.source].sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(ordered.length, 265);
  assert.deepEqual(ordered.map(row => row.path), baseline.map(row => row.path), 'exact selected source membership, including README');
  const changed = [];
  for (let index = 0; index < baseline.length; index++) {
    const before = baseline[index], after = ordered[index];
    assert.equal(after.mode, before.mode, 'source modes unchanged');
    assert.match(after.sha256, /^[a-f0-9]{64}$/u); assert.match(after.blob, /^[a-f0-9]{40}$/u);
    assert.ok(Number.isSafeInteger(after.bytes) && after.bytes >= 0);
    if (after.sha256 !== before.sha256) { assert.ok(mutableSources.includes(after.path), 'only runtime/shell source overrides'); changed.push(after.path); }
    else { assert.equal(after.blob, before.blob); assert.equal(after.bytes, before.bytes); }
  }
  return changed.sort();
}

export function packageDelta(binding, bytes) {
  const actual = packInventory(bytes), baseline = binding.package.members;
  assert.equal(Object.keys(actual).length, 846, 'whole846 package, not README-less projection');
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(baseline).sort());
  const changed = [];
  for (const [name, entry] of Object.entries(actual)) {
    assert.equal(entry.mode, baseline[name].mode, 'package mode unchanged');
    if (entry.sha256 !== baseline[name].sha256) { assert.match(name, mutablePackage, 'only compiled runtime/shell artifacts'); changed.push(name); }
    else assert.deepEqual(entry, baseline[name]);
  }
  return { members: actual, changed: changed.sort(), sha256: hash(bytes) };
}

function cleanRun(run, code = 0) {
  assert.equal(run.code, code); assert.equal(run.signal, null); assert.equal(run.failure, null);
  assert.equal(run.spawnError, null); assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true);
}

export function checkTypes(rows, packageRoot) {
  const ids = ['positive-v2', 'negative-option', 'negative-api', 'option-inversion', 'api-inversion'];
  assert.deepEqual(rows.map(row => row.id), ids);
  const diagnostics = {
    'negative-option': "negative-option.mts(3,61): error TS2353: Object literal may only specify known properties, and 'dotglob' does not exist in type 'ShellOptions'.",
    'negative-api': 'negative-api.mts(1,10): error TS2724: \'"virtual-bash"\' has no exported member named \'createShoptCommands\'. Did you mean \'createSplitCommands\'?',
  };
  for (const row of rows) {
    cleanRun(row.run, Object.hasOwn(diagnostics, row.id) ? 2 : 0);
    const text = row.run.stdout + row.run.stderr;
    const lines = text.split(/\r?\n/u).filter(line => /error TS\d+:/u.test(line));
    assert.deepEqual(lines, diagnostics[row.id] ? [diagnostics[row.id]] : [], 'exact diagnostic; no unrelated compiler failure');
    assert.ok(text.includes(packageRoot + '/dist/index.d.ts'), 'actual current package declaration resolution');
    assert.equal(text.includes('Cannot find module'), false);
  }
  return ids;
}

export function verifyWorkflow(manifest) {
  assert.ok(manifest.workflow, 'R24 requires real parent receipts; held until actual execution');
  const workflow = JSON.parse(digestFile(manifest.workflow.path, manifest.workflow.sha256));
  assert.equal(workflow.kind, 'dotglob-actual-workflow-v2');
  assert.equal(workflow.candidate, manifest.candidate);
  assert.equal(workflow.acceptedComposition, acceptedComposition);
  assert.equal(workflow.packageSha256, manifest.packageSha256);
  const binding = JSON.parse(readFileSync(new URL('../stack-binding-v1/BINDING.json', import.meta.url)));
  const changed = sourceDelta(binding, workflow.candidateInputs);
  assert.ok(changed.includes('src/shell/runtime.ts'), 'new actual builtin implementation required');
  assert.ok(changed.includes('src/shell/shell.ts'), 'state initialization/clone implementation required');
  const projection = Object.fromEntries(workflow.candidateInputs.map(row => [row.path, { sha256: row.sha256, bytes: row.bytes, mode: parseInt(row.mode, 8) & 0o777 }]));
  assertInventory(workflow.sourceRoot, projection);
  assertInventory(workflow.sourceRoot, workflow.sourceAfter);
  const packed = packageDelta(binding, digestFile(workflow.pack.path, workflow.packageSha256));
  assert.deepEqual(packed.members, workflow.packageInventory);
  cleanRun(workflow.build.run); cleanRun(workflow.install.run);
  assert.equal(workflow.build.command, 'npm run build');
  assert.deepEqual(workflow.install.args, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', workflow.pack.path]);
  assert.equal(workflow.build.candidate, manifest.candidate);
  assert.deepEqual(workflow.build.candidateInputs, workflow.candidateInputs);
  const all = cases(), layoutNames = ['source', 'installed', 'moved'];
  assert.deepEqual(workflow.layouts.map(row => row.layout), layoutNames);
  const actualPaths = new Set();
  for (const layout of workflow.layouts) {
    assert.equal(actualPaths.has(layout.runtimeModule), false, 'three actual different load paths'); actualPaths.add(layout.runtimeModule);
    assert.equal(layout.runtimeSha256, packed.members['dist/shell/runtime.js'].sha256);
    assert.equal(layout.rootSha256, packed.members['dist/index.js'].sha256);
    if (layout.layout !== 'source') assert.deepEqual(layout.members, packed.members);
    assert.deepEqual(layout.before, layout.after, 'append-aware staged product census');
    assert.deepEqual(layout.defaultNames, binding.defaultNames, '77 defaults unchanged');
    assert.deepEqual(layout.exports, workflow.exports);
    assert.deepEqual(layout.dependencies, {});
    for (const cohort of ['commands', 'unsupported', 'globs', 'states', 'overlay', 'procedures']) {
      const expectedIds = all[cohort].filter(row => row.id !== 'R24').map(row => row.id);
      const seen = [];
      for (const record of layout.runs.filter(row => row.cohort === cohort)) {
        const result = classify(record.run, record.ids, { modulePath: layout.runtimeModule, moduleSha256: layout.runtimeSha256 });
        assert.equal(result.accepted, true, `actual ${layout.layout}/${cohort} bodies`);
        assert.ok(result.loads.some(row => row.path === layout.rootModule && row.sha256 === layout.rootSha256));
        seen.push(...record.ids);
      }
      assert.deepEqual(seen.sort(), expectedIds.sort(), 'exact body coverage, no missing/duplicate cases');
    }
    cleanRun(layout.sourceDenial.run, 78);
    assert.ok(layout.sourceDenial.run.stdout.includes('unbound module ' + layout.forbiddenSource), 'specific source fallback refusal');
    const late = classify(layout.late.run, layout.late.ids, { modulePath: layout.runtimeModule, moduleSha256: layout.runtimeSha256 });
    cleanRun(layout.late.run, 7);
    assert.equal(late.passed, 1); assert.equal(late.observed, 1); assert.equal(late.accepted, false);
    assert.deepEqual(late.errors, ['exit status contradicts body outcomes']);
  }
  assert.equal(workflow.move.fromAbsent, true); assert.notEqual(workflow.move.from, workflow.move.to);
  assert.equal(workflow.move.to, workflow.layouts[2].packageRoot);
  assert.deepEqual(workflow.move.before, workflow.move.after);
  const typeIds = checkTypes(workflow.types, workflow.typePackageRoot);
  assert.deepEqual(workflow.guards.map(row => row.id).sort(), [...mandatoryGuardIds].sort());
  for (const guard of workflow.guards) {
    cleanRun(guard.run, 78);
    assert.equal(guard.accepted, true); assert.equal(guard.run.stdout.includes('"load":'), false);
    assert.ok(new RegExp(guard.expected.diagnostic, 'u').test(guard.run.stdout + guard.run.stderr));
  }
  assert.deepEqual(workflow.mutants.map(row => row.id).sort(), ['absent-builtin', 'accepted-stack-reversion']);
  for (const mutant of workflow.mutants) {
    assert.notEqual(mutant.runtimeSha256, packed.members['dist/shell/runtime.js'].sha256);
    const proof = classify(mutant.run, mutant.ids, { modulePath: mutant.runtimeModule, moduleSha256: mutant.runtimeSha256, mutantId: mutant.id, requiredFailed: mutant.requiredFailed });
    assert.equal(proof.mutantKilled, true, 'actual changed module + mechanism hit + designated predicate failed after cleanup');
    assert.deepEqual(mutant.requiredFailed, ['R01']);
    if (mutant.id === 'accepted-stack-reversion') assert.equal(mutant.runtimeSha256, binding.package.members['dist/shell/runtime.js'].sha256);
  }
  return [
    ['selected-source-two-file-delta', changed, [...mutableSources]],
    ['actual-source-installed-moved-loads', workflow.layouts.map(row => row.layout), layoutNames],
    ['types-and-inversions', typeIds, ['positive-v2', 'negative-option', 'negative-api', 'option-inversion', 'api-inversion']],
    ['denied-source-fallback', workflow.layouts.map(row => row.sourceDenial.run.code), [78, 78, 78]],
    ['guard-and-reversion-mutants', workflow.mutants.map(row => row.id).sort(), ['absent-builtin', 'accepted-stack-reversion']],
    ['actual-package-late-nonzero-rejected', workflow.layouts.map(row => row.late.run.code), [7, 7, 7]],
  ];
}
