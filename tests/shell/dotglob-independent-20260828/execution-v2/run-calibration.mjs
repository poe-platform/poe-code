import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { stageBaseline, ownRoot } from './stage-baseline.mjs';
import { hash, save, inventory } from '../execution-prep-v1/artifacts.mjs';
import { assertInventory } from '../execution-prep-v1/admission.mjs';
import { supervise, classify } from '../execution-prep-v1/protocol.mjs';
import { calibrationIds } from './calibration.mjs';
import { baselineGuards } from './baseline-guards.mjs';

const revision = process.argv[2], label = process.argv[3];
assert.match(revision ?? '', /^[a-f0-9]{40}$/u); assert.match(label ?? '', /^[a-z0-9-]+$/u);
const stage = stageBaseline(revision, label), { binding, manifest } = stage;
const output = join(ownRoot, 'baseline-evidence-v1', label + '.json');
const worker = join(stage.harnessRoot, 'execution-v2/worker.mjs');
const flags = ['--permission', `--allow-fs-read=${stage.moved}`, `--allow-fs-read=${stage.manifestPath}`, `--allow-fs-read=${binding.node.path}`, `--allow-fs-read=${manifest.scratchRoot}`, `--allow-fs-write=${manifest.scratchRoot}`];
const env = { PATH: dirname(binding.node.path), LC_ALL: 'C', TZ: 'UTC', DOTGLOB_MANIFEST: stage.manifestPath, DOTGLOB_MANIFEST_SHA256: stage.manifestSha256 };
const result = { role: 'bounded accepted-STACK calibration only; no DOTGLOB candidate', revision, label, acceptedComposition: binding.acceptedComposition, packageSha256: binding.package.sha256, node: binding.node, stage: { work: stage.work, moved: stage.moved, movedFrom: stage.movedFrom, manifestSha256: stage.manifestSha256 }, runs: [], types: [], cleanup: null };
const before = inventory(stage.moved);
let infrastructureFailure = false;
try {
  const run = await supervise(binding.node.path, [...flags, worker, 'calibrate'], { cwd: stage.moved, env, timeoutMs: 10000, maxBytes: 1024 * 1024 });
  result.runs.push({ role: 'actual-baseline-observations', run, classification: classify(run, calibrationIds, { modulePath: manifest.runtimeModule, moduleSha256: binding.package.members['dist/shell/runtime.js'].sha256 }) });
  if (run.failure || !run.groupAbsent || !run.closeObserved) { infrastructureFailure = true; throw new Error('resource/cleanup failure stops calibration'); }
  for (const mode of ['source-denial', 'smoke']) {
    const child = await supervise(binding.node.path, [...flags, worker, mode, ...(mode === 'smoke' ? ['late-exit-7'] : [])], { cwd: stage.moved, env, timeoutMs: 10000, maxBytes: 1024 * 1024 });
    const classified = classify(child, ['B01-public'], { modulePath: manifest.runtimeModule, moduleSha256: binding.package.members['dist/shell/runtime.js'].sha256 });
    result.runs.push({ role: mode === 'smoke' ? 'actual-package-allPASS-nonzero' : 'source-fallback-denial', run: child, classification: classified });
    if (child.failure || !child.groupAbsent) { infrastructureFailure = true; throw new Error('guard child cleanup/resource failure'); }
  }
  result.guards = await baselineGuards(stage, flags, env, worker);
  const fixtures = [['positive-v2', 'execution-v2/consumer-v2.mts.fixture'], ['negative-option', 'negative-option.mts.fixture'], ['negative-api', 'negative-api.mts.fixture'], ['option-inversion', 'negative-option.mts.fixture'], ['api-inversion', 'negative-api.mts.fixture']];
  for (const [id, name] of fixtures) {
    let text = readFileSync(join(stage.harnessRoot, name), 'utf8');
    if (id === 'option-inversion') text = text.replace(', dotglob: true', '');
    if (id === 'api-inversion') text = text.replaceAll('createShoptCommands', 'Shell');
    const path = join(stage.moved, id + '.mts'); writeFileSync(path, text, { flag: 'wx' });
    const child = await supervise(binding.node.path, ['--permission', `--allow-fs-read=${stage.moved}`, `--allow-fs-read=${binding.node.path}`, join(stage.moved, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--traceResolution', path], { cwd: stage.moved, env: { PATH: dirname(binding.node.path), LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 20000, maxBytes: 2 * 1024 * 1024 });
    result.types.push({ id, fixtureSha256: hash(Buffer.from(text)), run: child, diagnostics: (child.stdout + child.stderr).split(/\r?\n/u).filter(line => /error TS\d+:/u.test(line)) });
    if (child.failure || !child.groupAbsent) { infrastructureFailure = true; throw new Error('compiler resource/cleanup failure'); }
  }
  const after = inventory(stage.moved);
  for (const [name, item] of Object.entries(before)) assert.deepEqual(after[name], item, 'baseline staged input unchanged');
  assert.deepEqual(Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort(), fixtures.map(([id]) => id + '.mts').sort(), 'only five admitted type-consumer additions');
  assertInventory(stage.packageRoot, binding.package.members);
  result.after = after;
} catch (error) { infrastructureFailure ||= error?.infrastructureFailure === true; result.error = String(error?.stack ?? error); if (error?.results) result.guards = error.results; }
finally {
  if (!infrastructureFailure) { rmSync(stage.work, { recursive: true, force: true }); result.cleanup = { exactOwnedRootRemoved: stage.work, absent: !existsSync(stage.work) }; }
  else result.cleanup = { retainedForInspection: stage.work, noFurtherExecution: true };
  save(output, result);
}
console.log(JSON.stringify({ output, observations: result.runs[0]?.classification?.observed, bodyFailures: result.runs[0]?.classification?.failed, typeStatuses: result.types.map(row => [row.id, row.run.code]), error: result.error ?? null, cleanup: result.cleanup }));
process.exitCode = result.error ? 1 : 0;
