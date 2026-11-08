import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArguments, admitPacket, readLoadManifest, assertInventory, digestFile } from './admission.mjs';
import { json, save, packInventory } from './artifacts.mjs';
import { supervise, classify } from './protocol.mjs';
import { cases } from './plan.mjs';
import { runTypes } from './types.mjs';

export async function runReview(options) {
  const packet = admitPacket(options);
  assert.equal(packet.executionAuthorized, true, 'separate root authorization, not preparation');
  assert.equal(packet.preparationReady, true, 'all calibrated adapters/types/source bindings sealed before replay');
  const counts = cases(), reports = [];
  const packageBytes = digestFile(packet.pack.path, packet.pack.sha256);
  assert.deepEqual(packInventory(packageBytes), packet.packageInventory);
  const mandatoryPackageFiles = ['README.md', 'package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/shell/runtime.js'];
  for (const name of mandatoryPackageFiles) assert.ok(packet.packageInventory[name], `full package member ${name}`);
  for (const layout of ['source', 'installed', 'moved']) {
    const location = packet[`${layout}Manifest`];
    assert.ok(location, `required ${layout} binding`);
    const { manifest, allowed } = readLoadManifest(location.path, location.sha256, 'dotglob-product-load-v1');
    assert.equal(manifest.candidate, packet.candidate);
    assert.equal(manifest.acceptedStack, packet.acceptedStack);
    assert.deepEqual(manifest.sourceInputs, packet.candidateInputs);
    const metadata = JSON.parse(digestFile(join(manifest.packageRoot, 'package.json'), allowed.get(join(manifest.packageRoot, 'package.json'))));
    assert.deepEqual(metadata.dependencies ?? {}, {}, 'zero runtime dependencies');
    assert.deepEqual(metadata.exports, packet.publicExports, 'unchanged public exports');
    if (layout !== 'source') assertInventory(manifest.packageRoot, packet.packageInventory);
    const worker = join(manifest.harnessRoot, 'execution-prep-v1/worker.mjs');
    assert.ok(allowed.has(worker), 'bound worker');
    const env = { PATH: dirname(manifest.node.path), LC_ALL: 'C', TZ: 'UTC', DOTGLOB_MANIFEST: location.path, DOTGLOB_MANIFEST_SHA256: location.sha256 };
    const readPaths = [...manifest.trees.map(tree => tree.root), location.path, manifest.node.path];
    const flags = ['--permission', ...readPaths.map(path => `--allow-fs-read=${path}`)];
    const requiredLoad = { modulePath: manifest.runtimeModule, moduleSha256: allowed.get(manifest.runtimeModule) };
    for (const cohort of ['commands', 'unsupported', 'globs', 'states', 'overlay', 'procedures']) {
      for (let first = 0; first < counts[cohort].length; first += 32) {
        const rows = counts[cohort].slice(first, first + 32);
        const run = await supervise(manifest.node.path, [...flags, worker, cohort, String(first), String(rows.length)], { cwd: manifest.harnessRoot, env, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 });
        const result = classify(run, rows.map(row => row.id), requiredLoad);
        reports.push({ layout, cohort, first, run, result });
      }
    }
    const late = await supervise(manifest.node.path, [...flags, worker, 'commands', '0', '1'], { cwd: manifest.harnessRoot, env: { ...env, DOTGLOB_LATE_EXIT_CONTROL: '7' } });
    const rejected = classify(late, [counts.commands[0].id], requiredLoad);
    reports.push({ layout, cohort: 'actual-package-allPASS-nonzero', run: late, result: { ...rejected, controlAccepted: late.code === 7 && rejected.passed === 1 && !rejected.accepted && rejected.errors.includes('exit status contradicts body outcomes') && late.closeObserved && late.groupAbsent } });
    for (const tree of manifest.trees) assertInventory(tree.root, tree.files);
  }
  const typing = await runTypes(packet.typeBinding);
  const accepted = reports.every(report => report.cohort === 'actual-package-allPASS-nonzero' ? report.result.controlAccepted : report.result.accepted) && typing.every(row => row.result.accepted);
  save(packet.output, { kind: 'dotglob-independent-future-run-v1', candidate: packet.candidate, acceptedStack: packet.acceptedStack, counts: json(new URL('./HELD.json', import.meta.url)).denominators, nonAdditive: true, reports, typing, accepted });
  return accepted;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await runReview(parseArguments(process.argv.slice(2))) ? 0 : 1; }
  catch (error) { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = error?.exitCode ?? 78; }
}
