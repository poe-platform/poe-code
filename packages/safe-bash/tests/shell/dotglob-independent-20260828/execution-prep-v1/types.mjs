import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { digestFile, assertInventory } from './admission.mjs';
import { supervise } from './protocol.mjs';
import { frozenRoot } from './plan.mjs';

export function reconcileTypeRun(run, expected) {
  assert.equal(run.closeObserved, true); assert.equal(run.groupAbsent, true);
  assert.equal(run.failure, null); assert.equal(run.spawnError, null); assert.equal(run.signal, null);
  assert.equal(run.code, expected.exitCode);
  const text = run.stdout + run.stderr;
  const diagnostics = text.split(/\r?\n/u).filter(line => /error TS[0-9]+:/u.test(line));
  assert.deepEqual(diagnostics, expected.diagnostics, 'exact bound compiler diagnostic code/location/message');
  for (const binding of expected.requiredTrace ?? []) assert.ok(text.includes(binding), `actual package resolution ${binding}`);
  assert.equal(text.includes('Cannot find module'), false, 'missing dependency is not intended negative API proof');
  return { diagnostics, code: run.code };
}

export async function runTypes(binding) {
  assert.equal(binding.kind, 'dotglob-types-v1');
  digestFile(binding.node.path, binding.node.sha256);
  digestFile(binding.compiler.path, binding.compiler.sha256);
  assertInventory(binding.compilerRoot, binding.compilerFiles);
  assertInventory(binding.packageRoot, binding.packageFiles);
  assert.ok(Array.isArray(binding.readTrees) && binding.readTrees.length > 0, 'bound consumer/tool/declaration trees');
  for (const tree of binding.readTrees) assertInventory(tree.root, tree.files);
  const variants = [
    ['positive', 'consumer.mts.fixture', value => value],
    ['negative-option', 'negative-option.mts.fixture', value => value],
    ['negative-api', 'negative-api.mts.fixture', value => value],
    ['option-inversion', 'negative-option.mts.fixture', value => value.replace(', dotglob: true', '')],
    ['api-inversion', 'negative-api.mts.fixture', value => value.replaceAll('createShoptCommands', 'Shell')],
  ];
  const outcomes = [];
  for (const [id, name, transform] of variants) {
    const target = join(binding.consumerRoot, `${id}.mts`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, transform(readFileSync(join(frozenRoot, name), 'utf8')), { flag: 'wx' });
    const readPaths = [binding.consumerRoot, binding.node.path, ...binding.readTrees.map(tree => tree.root)];
    const run = await supervise(binding.node.path, ['--permission', ...readPaths.map(path => `--allow-fs-read=${path}`), binding.compiler.path, '--strict', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'false', '--traceResolution', target], { cwd: binding.consumerRoot, env: { PATH: dirname(binding.node.path), LC_ALL: 'C', TZ: 'UTC' }, maxBytes: 2 * 1024 * 1024, timeoutMs: 30000 });
    let result;
    try { result = { accepted: true, ...reconcileTypeRun(run, binding.expected[id]) }; }
    catch (error) { result = { accepted: false, error: String(error) }; }
    outcomes.push({ id, run, result });
  }
  assertInventory(binding.packageRoot, binding.packageFiles);
  assertInventory(binding.compilerRoot, binding.compilerFiles);
  for (const tree of binding.readTrees) assertInventory(tree.root, tree.files);
  return outcomes;
}
