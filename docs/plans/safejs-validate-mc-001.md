# MC-001 independent validation

## Decision

**READY for coordinator integration review.** No MC-001 blocker found. This is not commit/push authorization, a whole-SafeJS pass, or a release receipt. Validate any subsequently changed production diff again before serial publication.

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-fixes`, `main`, HEAD `9ef2e738dc177eb2ac96358b1e1a0f9f40fe97dc`.
- Fix author Mencius is separate from this independent validator. Frozen MC-001 source, author tests and issue-plan hashes remained unchanged between initial inspection and final checks.
- Production diff inspected against HEAD: exactly two declarative names, `Infinity` and `NaN`, added to `KNOWN_RUNTIME_GLOBALS`. Both values already exist in runtime math globals. `AS003` resolves lexical bindings before known globals; typo candidates use the same list. The change does not disable unknown-name validation or shadow warnings.
- Independent unit tests cover ordinary nested references, const/let/parameter/destructured/block shadowing, imported bindings, typo suggestions and source spans, nonleaking `allowedGlobals`, plain versus computed keys, existing Math warnings, warning-only harness acceptance, and unknown-name rejection before host callbacks.
- This validator owns only the dedicated validation test, this plan, and the evidence directory. No production/README/master-plan/author-plan edits, original-worktree writes, staging, commit, push, branch or dependency changes were performed.

## Original case and independent result

Original source (read-only): `../poe-code/out/safejs-audit-2026-08-27/module-composition-review/examples/graph-compatible.safejs`, relative to the clean repository root. The unchanged 134-line source SHA-256 is `f6717b8018d0e438867796c24ffa102dafca5fedb714b7707af73071d6c1c70e`.

Before any audit payload read, bootstrap the exact 38 unique paths from `inventory-verification.json#/archiveReadPolicy/excludedPaths`; additionally exclude the whole security directory and the outside-cohort provenance directory. No archived payloads or security probes were read/executed. Historical fixture/results/anchor data were read by explicit allowed paths, not a recursive audit scan; no historical driver was executed.

Independent execution used the current TypeScript lint, actual `runHarness`, runtime factories and Budget directly from `src`, not SafeJS dist. Fresh object/object registries reproduce original export aliases, copied frontmatter/title edits and the four metric fixtures. Metric callbacks return strings in memory: no guest LLM, filesystem, network or process capability is provided.

| Check | Isolated old-whitelist control, twice | Current whitelist, twice |
| --- | --- | --- |
| Exact original source | Unchanged | Unchanged |
| Lint errors | AS003 Infinity at 85:44 and 92:35 | None |
| Remaining warning | AS-UNUSED-IMPORT betaPlan at 5:8 | Same warning |
| Actual harness | LintError before execution; no metric calls | ok:true, 4,302 node visits |
| Alpha distances / adjusted | Not executed | [0,6,2,8] / [1,7,3,9] |
| Beta distances / adjusted | Not executed | [0,9,6,15] / [2,11,8,17] |
| Final routes | Not executed | Alpha [a,c,b,d]; beta [s,u,t,v] |
| Metric calls | 0 | alpha-scale, beta-scale, alpha-bias, beta-bias; counters 1,1,2,2 |

The old-whitelist control is a **counterfactual in an isolated child process**, not a checked-out/reverted repository or a claim the audit was newly run on its historical revision. Only the two names are temporarily removed from that process's imported array and restored in finally; disk source is unchanged. This reproduces the original gate failure while holding runtime patches constant.

Two fresh native ESM evaluations independently match the complete historical expected output and call ledger. TypeScript AST location changes only the final top-level return into export default; all graph/import/function/await statements remain intact. Cached SyntheticModules retain native namespace identity. Hand-checked shortest paths independently yield alpha 0/6/2/8 and beta 0/9/6/15.

**MC-002 remains:** current SafeJS returns `imports.namespaceContainerSame: false`; native returns true. Every other JSON-normalized output field, every node's route, labels, titles, alias flags and all four calls match. Normalization intentionally ignores object-prototype representation; no whole-native/prototype parity is claimed. The separate MC-003 Number runtime patch is present but this exact graph contains no `Number.` use and uses global Infinity. Its success is not credited to numeric-property repair.

Limits: 100,000 steps; depth 64; string length 32,768; array length 4,096; data size 2,097,152; 2.5-second Budget deadline; 3-second abort signal; native VM timeout 2 seconds; outer child timeout 20 seconds. Entire graph command completed in 1881 ms.

## Commands and results

Run from the clean fix repository; no full SafeJS suite was run while COLL cursor work is being handled separately.

| Command | Actual result |
| --- | --- |
| `node_modules/.bin/vitest run packages/safejs/src/lint/known-globals-mc-001-validation.test.ts --reporter=verbose` | 22/22 independent tests passed; 1.67 s |
| `node_modules/.bin/vitest run packages/safejs/src/lint packages/safejs/src/lint.test.ts packages/safejs/src/runner/run-harness.test.ts packages/safejs/src/interp/globals/math.test.ts --reporter=dot` | 39 files, 573/573 tests passed; 7.61 s Vitest duration |
| `node_modules/.bin/vitest run packages/safejs/src/lint/known-globals-mc-001-validation.test.ts packages/safejs/src/lint/known-globals-mc-001.test.ts --reporter=verbose` | Final formatted test: 2 files, 36/36 passed; 1.37 s |
| `node_modules/.bin/eslint packages/safejs/src/lint` | Exit 0 |
| `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit` | Exit 0; production package roots |
| Focused TypeScript API command below | Exit 0; production roots plus both MC-001 test files, zero diagnostics, no emit |
| `node_modules/.bin/prettier --check packages/safejs/src/lint/rules/known-globals.ts packages/safejs/src/lint/known-globals-mc-001.test.ts packages/safejs/src/lint/known-globals-mc-001-validation.test.ts` | Final exit 0; initial check found only formatting in validator-owned test, corrected via apply_patch |

Raw command stdout/stderr, durations, complete graph outputs, diagnostic records and hashes are retained in `out/safejs-remediation/mc-001-validation/results.json`. This is a validation receipt, not a QA script. The procedural command recipes below belong in this Markdown plan. No screenshot campaign was run: there are no CLI presentation/layout edits in this validation scope.

## Validated hashes and changed paths

| Frozen author path | SHA-256 at start and finish |
| --- | --- |
| `packages/safejs/src/lint/rules/known-globals.ts` | `d46ffec37691edf3a01a8a2a4d8bc8a8f91bac59f0f55737b3350eb89167917a` |
| `packages/safejs/src/lint/known-globals-mc-001.test.ts` | `f1fad52344f50800cb2bca55fae83d5271c818040bebdfea42d7c771e5ffa78f` |
| `docs/plans/safejs-fix-mc-001.md` | `9f5e169f187c9ae5e5f73d08125f55ad620d8751a748d1a3af24c8c72037bfef` |

- Validator-added test: `packages/safejs/src/lint/known-globals-mc-001-validation.test.ts`, SHA-256 `a4e3c2f6e4c949b3c94168827d64f0e001f3eb572173ace3b92cf8c5717396ae`.
- Validator-added plan: `docs/plans/safejs-validate-mc-001.md`.
- Validator-added evidence: `out/safejs-remediation/mc-001-validation/results.json`; keep ignored audit/validation outputs out of commits.
- Runtime dependency fingerprints, including separately owned MC-003 object-array code, are in the receipt. They identify the shared worktree at handoff; only the three frozen author files have start/end equality certification.
- The coordinator owns integration and publication in the clean serial publish checkout after approval. No publish readiness claim can substitute for the actual release/version receipt.

## Exact original-case command

The validator executed this stdin command in a fresh child with a 20-second host timeout. Re-run only within the same bounded remediation authorization:

```sh
node --experimental-vm-modules --import tsx --input-type=module <<'MC001'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { lint } from './packages/safejs/src/lint/index.ts';
import { KNOWN_RUNTIME_GLOBALS } from './packages/safejs/src/lint/rules/known-globals.ts';
import { createLintModulesFromRuntimeRegistry } from './packages/safejs/src/lint/runtime-modules.ts';
import { runHarness } from './packages/safejs/src/runner/run-harness.ts';
import { makeHarnessModule } from './packages/safejs/src/modules/harness.ts';
import { makeMetricModule } from './packages/safejs/src/modules/metric.ts';
import { Budget } from './packages/safejs/src/interp/budget.ts';
const original = '/Users/kjopek/Workspace/poe-code';
const audit = original + '/out/safejs-audit-2026-08-27';
const metadata = JSON.parse(readFileSync(audit + '/inventory-verification.json', 'utf8'));
const excluded = new Set(metadata.archiveReadPolicy.excludedPaths.map(relative => resolve(original, relative)));
assert.equal(excluded.size, 38);
function readAllowed(relative) {
  const target = resolve(audit, relative);
  assert.ok(target.startsWith(audit + '/'));
  assert.ok(!excluded.has(target));
  assert.ok(!target.startsWith(audit + '/security/'));
  assert.ok(!target.startsWith(audit + '/dynamic-deflate-provenance-review/'));
  return readFileSync(target, 'utf8');
}
const sourceRelative = 'module-composition-review/examples/graph-compatible.safejs';
const source = readAllowed(sourceRelative);
const sourceHash = createHash('sha256').update(source).digest('hex');
assert.equal(sourceHash, 'f6717b8018d0e438867796c24ffa102dafca5fedb714b7707af73071d6c1c70e');
assert.equal(source.includes('Number.'), false);
const fixture = JSON.parse(readAllowed('module-composition-review/fixtures.json'));
const historical = JSON.parse(readAllowed('module-composition-review/results.json')).cases.find(item => item.id === 'graph-compatible');
const anchor = JSON.parse(readAllowed('module-composition-review/anchors.json')).cases.find(item => item.caseId === 'graph-compatible');
assert.deepEqual(historical.expected, anchor.returnValue);
const normalize = value => JSON.parse(JSON.stringify(value));
function registry() {
  const calls = [];
  const plans = {};
  const metrics = {};
  for (const [index, name] of ['alpha', 'beta'].entries()) {
    const setup = fixture.factorySetup[name];
    const frontmatter = {tasks: [structuredClone(fixture.datasets[index])], agents: [], principles: [...setup.principles], constraints: [...setup.constraints]};
    const plan = makeHarnessModule(frontmatter, {kind: fixture.factorySetup.kind, version: fixture.factorySetup.version, filepath: setup.filepath});
    frontmatter.tasks[0].title = fixture.factorySetup.postConstructionTitleEdits[index];
    plans[name] = {...plan, default: plan.tasks, records: plan.tasks, decorate: plan.applyConstraints};
    let count = 0;
    const metric = makeMetricModule(async script => {
      assert.ok(Object.hasOwn(fixture.metricStdout[name], script));
      calls.push({instance: name, script, call: ++count});
      return fixture.metricStdout[name][script];
    });
    metrics[name] = {...metric, default: metric.run};
  }
  return {calls, modules: {planA: plans.alpha, planB: plans.beta, metricA: metrics.alpha, metricB: metrics.beta}};
}
const receipt = {startedAt: new Date().toISOString(), sourceHash, excludedPaths: excluded.size, guestCapabilities: 'only in-memory graph/metric fixtures; no guest FS/network/process/LLM', counterfactual: [], current: [], native: []};
const acceptedGlobals = [...KNOWN_RUNTIME_GLOBALS];
try {
  KNOWN_RUNTIME_GLOBALS.splice(0, KNOWN_RUNTIME_GLOBALS.length, ...acceptedGlobals.filter(name => name !== 'Infinity' && name !== 'NaN'));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const setup = registry();
    const diagnostics = lint(source, {modules: createLintModulesFromRuntimeRegistry(setup.modules)});
    const errors = diagnostics.filter(item => item.severity === 'error');
    assert.deepEqual(errors.map(item => [item.code, item.line, item.column]), [['AS003', 85, 44], ['AS003', 92, 35]]);
    const budget = new Budget({maxSteps: 100000, deadline: Date.now() + 2500});
    await assert.rejects(runHarness(audit + '/' + sourceRelative, {modulesFor: () => setup.modules, budget, signal: AbortSignal.timeout(3000)}), error => error.name === 'LintError' && error.diagnostics.length === 2);
    assert.deepEqual(setup.calls, []);
    receipt.counterfactual.push({attempt, diagnostics, outcome: 'LintError before execution', calls: setup.calls});
  }
} finally {
  KNOWN_RUNTIME_GLOBALS.splice(0, KNOWN_RUNTIME_GLOBALS.length, ...acceptedGlobals);
}
assert.deepEqual(KNOWN_RUNTIME_GLOBALS, acceptedGlobals);
for (let attempt = 1; attempt <= 2; attempt++) {
  const setup = registry();
  const diagnostics = lint(source, {modules: createLintModulesFromRuntimeRegistry(setup.modules)});
  assert.deepEqual(diagnostics.map(item => [item.code, item.severity, item.line, item.column]), [['AS-UNUSED-IMPORT', 'warning', 5, 8]]);
  const result = await runHarness(audit + '/' + sourceRelative, {modulesFor: () => setup.modules, budget: new Budget({maxSteps: 100000, maxCallDepth: 64, stringLength: 32768, arrayLength: 4096, dataSize: 2097152, deadline: Date.now() + 2500}), signal: AbortSignal.timeout(3000)});
  assert.equal(result.ok, true);
  const actual = normalize(result.returnValue);
  assert.equal(actual.imports.namespaceContainerSame, false);
  assert.deepEqual({...actual, imports: {...actual.imports, namespaceContainerSame: true}}, historical.expected);
  assert.deepEqual(setup.calls, historical.expectedCalls);
  assert.deepEqual(actual.alpha.map(row => row.distance), [0, 6, 2, 8]);
  assert.deepEqual(actual.beta.map(row => row.distance), [0, 9, 6, 15]);
  assert.deepEqual(actual.alpha.at(-1).route, ['a', 'c', 'b', 'd']);
  assert.deepEqual(actual.beta.at(-1).route, ['s', 'u', 't', 'v']);
  receipt.current.push({attempt, diagnostics, ok: result.ok, stats: result.stats, actual, calls: setup.calls, fullNativeParity: false, soleNormalizedDifference: 'imports.namespaceContainerSame: false versus true (MC-002)'});
}
const parsed = ts.createSourceFile('graph-compatible.safejs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const finalReturn = parsed.statements.findLast(statement => ts.isReturnStatement(statement));
assert.ok(finalReturn?.expression);
const nativeSource = source.slice(0, finalReturn.getStart(parsed)) + 'export default ' + source.slice(finalReturn.expression.getStart(parsed));
for (let attempt = 1; attempt <= 2; attempt++) {
  const setup = registry();
  const context = vm.createContext({});
  const cache = new Map();
  const guest = new vm.SourceTextModule(nativeSource, {context});
  await guest.link(name => {
    assert.ok(Object.hasOwn(setup.modules, name));
    if (!cache.has(name)) {
      const exports = setup.modules[name];
      cache.set(name, new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, {context, identifier: name}));
    }
    return cache.get(name);
  });
  await guest.evaluate({timeout: 2000});
  const actual = normalize(guest.namespace.default);
  assert.deepEqual(actual, historical.expected);
  assert.deepEqual(setup.calls, historical.expectedCalls);
  receipt.native.push({attempt, actual, calls: setup.calls, fullHistoricalAnchorMatch: true});
}
receipt.finishedAt = new Date().toISOString();
receipt.nativeAdaptation = 'TypeScript AST locates final top-level return; only return keyword becomes export default; cached SyntheticModules preserve namespace identity';
receipt.counterfactualQualification = 'Original whitelist reconstructed in this isolated process only; all runtime code and original graph unchanged; production source bytes never edited';
console.log(JSON.stringify(receipt, null, 2));
MC001
```

## Focused test-inclusive typecheck command

The package tsconfig excludes tests, so this additional check explicitly includes both MC-001 test roots without emitting files:

```sh
node --input-type=module <<'MC001_TYPES'
import ts from 'typescript';
const configPath = 'packages/safejs/tsconfig.json';
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, 'packages/safejs');
const roots = [...new Set([...parsed.fileNames, 'packages/safejs/src/lint/known-globals-mc-001.test.ts', 'packages/safejs/src/lint/known-globals-mc-001-validation.test.ts'])];
const program = ts.createProgram(roots, {...parsed.options, noEmit: true});
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {getCanonicalFileName: name => name, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n'}));
  process.exitCode = 1;
} else console.log('SafeJS production roots plus both MC-001 test files: 0 TypeScript diagnostics; no emit.');
MC001_TYPES
```
