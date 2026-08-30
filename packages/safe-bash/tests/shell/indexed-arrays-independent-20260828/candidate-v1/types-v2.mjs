import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authenticate, verifyTree, digest } from '../executor-v1/boundary.mjs';
import { supervise } from '../executor-v1/supervisor.mjs';

export const typeCases = [
  { id: 'public', fixture: 'public-v2.mts.fixture', exitCode: 0, diagnostics: [] },
  { id: 'ast', fixture: '../executor-v1/ast.mts.fixture', exitCode: 0, diagnostics: [] },
  { id: 'negative-option', fixture: '../executor-v1/negative-option.mts.fixture', exitCode: 2,
    diagnostics: ["negative-option.mts(5,3): error TS2353: Object literal may only specify known properties, and 'arrays' does not exist in type 'ShellOptions'."] },
  { id: 'negative-limit', fixture: '../executor-v1/negative-limit.mts.fixture', exitCode: 2,
    diagnostics: ["negative-limit.mts(3,3): error TS2353: Object literal may only specify known properties, and 'arrayWork' does not exist in type 'ShellLimits'."] },
  { id: 'negative-export', fixture: '../executor-v1/negative-export.mts.fixture', exitCode: 2,
    diagnostics: ["negative-export.mts(1,10): error TS2305: Module '\"virtual-bash\"' has no exported member 'ArrayLedger'."] },
  { id: 'option-inverse', fixture: '../executor-v1/option-inverse.mts.fixture', exitCode: 0, diagnostics: [] },
  { id: 'limit-inverse', fixture: '../executor-v1/limit-inverse.mts.fixture', exitCode: 0, diagnostics: [] },
  { id: 'export-inverse', fixture: '../executor-v1/export-inverse.mts.fixture', exitCode: 0, diagnostics: [] },
  { id: 'original-public', fixture: '../executor-v1/public.mts.fixture', exitCode: 2, diagnostics: [
    "original-public.mts(5,39): error TS2322: Type '(context: ShellCommandContext) => Promise<CommandResult>' is not assignable to type 'CommandHandler'.",
    "original-public.mts(6,3): error TS2722: Cannot invoke an object which is possibly 'undefined'."] },
  { id: 'ast-negative', fixture: '../executor-v1/ast-negative.mts.fixture', exitCode: 2,
    diagnostics: ["ast-negative.mts(11,22): error TS2322: Type '{ kind: \"synthetic-unhandled\"; }' is not assignable to type 'never'."] }
];
export async function runTypes(binding) {
  assert.equal(binding.action, 'root-authorized-array-types');
  assert.match(binding.candidate, /^[a-f0-9]{40}$/u); assert.match(binding.rootReceipt, /^[a-f0-9]{40}$/u);
  authenticate(binding.node.path, binding.node.sha256); authenticate(binding.compiler.path, binding.compiler.sha256);
  for (const tree of binding.trees) verifyTree(tree);
  const outcomes = [];
  for (const expected of typeCases) {
    const source = binding.consumers[expected.id];
    authenticate(source.path, source.sha256);
    authenticate(source.path, digest(readFileSync(new URL(expected.fixture, import.meta.url))));
    const run = await supervise(binding.node.path, ['--permission', ...binding.trees.map(tree => `--allow-fs-read=${tree.root}`),
      `--allow-fs-read=${binding.node.path}`, binding.compiler.path, '--strict', '--exactOptionalPropertyTypes', '--noEmit',
      '--skipLibCheck', 'false', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--traceResolution', source.path], {
      cwd: binding.consumerRoot, env: { LC_ALL: 'C', TZ: 'UTC' }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024
    });
    const text = run.stdout + run.stderr;
    const diagnostics = text.split(/\r?\n/u).filter(line => /error TS\d+:/u.test(line));
    let accepted = false; let error = null;
    try {
      assert.ok(run.closeObserved && run.groupAbsent && !run.fault && !run.spawnError && !run.signal);
      assert.equal(run.code, expected.exitCode); assert.deepEqual(diagnostics, expected.diagnostics);
      const rootImport = 'virtual-bash';
      const target = binding.rootDeclaration;
      assert.ok(text.includes(`Module name '${rootImport}' was successfully resolved to '${target}'`), 'actual current declaration binding');
      if (expected.id === 'ast') assert.ok(text.includes(`was successfully resolved to '${binding.parserDeclaration}'`), 'public parseShell return AST is package-bound');
      for (const match of text.matchAll(/was successfully resolved to '([^']+)'/gu)) assert.ok(binding.trees.some(tree => match[1].startsWith(tree.root + '/')), 'no type source fallback');
      accepted = true;
    } catch (reason) { error = String(reason); }
    outcomes.push({ id: expected.id, accepted, error, run });
    if (!run.closeObserved || !run.groupAbsent || run.fault) break;
  }
  for (const tree of binding.trees) verifyTree(tree);
  return outcomes;
}
