# Independent MC-002 validation

## Verdict

**READY for the three frozen author publishables at base `ecfd838abd37fb061d66dc8721bc3f86067139ad`. No blocking MC-002 finding remains.** Validation performed directly in the assigned lane on August 29, 2026; the parent orchestrates publication. This is independent of author Mencius's checks. The publisher must still verify its own clean-clone preimages and run its final full gate. No publication authorization, Git mutation, commit, or push is implied.

Worktree: `/Users/kjopek/Workspace/poe-code-safejs-module-identity`, branch `main`. Ancestor `/Users/kjopek/Workspace/AGENTS.md` and root `AGENTS.md` were read; no nested instructions were found under packages/docs/out. All three frozen author paths and the author manifest remained byte-identical. The only validator-created files are this report and `packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts`. No production file, README, master plan, original audit, prior MC-003 clone/capture, or other clone was changed. Build output stays local and outside the publication set.

## Independent freeze manifest

The JSON block below is the independent freeze manifest. Its SHA-256, including its final LF, is `d3e904c7500381f9fe5c6125ad75a98d7b48db03b64612dfd525058d36ef5039`. The author manifest at `out/safejs-remediation/mc-002/manifest.json` independently matches the supplied SHA-256 `f516e56d4a84f3ce63cf8a8dbd8549dfc9128b029fa994aa463c071c1dff34c6`.

The three author publishables remain the publication scope. The independent test/report are separate supporting additions; publishing them requires explicit approval rather than silently widening the author's manifest. The report's own SHA-256 is returned separately to avoid a self-reference.

```json
{
  "schemaVersion": 1,
  "issue": "MC-002",
  "verdict": "READY for the three frozen author publishables only; publisher final preimage/full gate remains separate",
  "baseCommit": "ecfd838abd37fb061d66dc8721bc3f86067139ad",
  "authorManifest": {
    "path": "out/safejs-remediation/mc-002/manifest.json",
    "sha256": "f516e56d4a84f3ce63cf8a8dbd8549dfc9128b029fa994aa463c071c1dff34c6"
  },
  "publishables": [
    {
      "path": "packages/safejs/src/modules/registry.ts",
      "sha256": "8028634f68f597c9ed6b086c478601c7807c20fae51266c250efa016459195f9",
      "bytes": 6506,
      "base": {
        "exists": true,
        "artifact": "base-preimages/packages/safejs/src/modules/registry.ts",
        "sha256": "466490d886714c678d8e99d5e4cf6703a0a26a130365ea0db365094356f13d0f",
        "bytes": 6478
      },
      "frozenArtifact": "out/safejs-remediation/mc-002/publishables/packages/safejs/src/modules/registry.ts"
    },
    {
      "path": "packages/safejs/src/modules/namespace-identity-mc-002.test.ts",
      "sha256": "ae2ea1ddff2668219b223918e695760c7ccfdf25105347894c379e1ac11f7dbc",
      "bytes": 6329,
      "base": {
        "exists": false,
        "artifact": null,
        "sha256": null,
        "bytes": null
      },
      "frozenArtifact": "out/safejs-remediation/mc-002/publishables/packages/safejs/src/modules/namespace-identity-mc-002.test.ts"
    },
    {
      "path": "docs/plans/safejs-fix-mc-002.md",
      "sha256": "113939f12b3c1c26cefe605a559bde8a40db3587a75d9b11e0f99ca4e6c2c018",
      "bytes": 10454,
      "base": {
        "exists": false,
        "artifact": null,
        "sha256": null,
        "bytes": null
      },
      "frozenArtifact": "out/safejs-remediation/mc-002/publishables/docs/plans/safejs-fix-mc-002.md"
    }
  ],
  "validatorSupport": {
    "test": {
      "path": "packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts",
      "sha256": "4cd38130f7d8afee568304d0ceafabdb23b3fb3f44112d4387a1f575042e4f46",
      "bytes": 19767,
      "existsAtBase": false
    },
    "report": {
      "path": "docs/plans/safejs-validate-mc-002.md",
      "existsAtBase": false,
      "sha256Location": "Returned separately to avoid a self-referential report hash"
    },
    "publicationRequiresSeparateApproval": true
  },
  "originalGraph": {
    "path": "out/safejs-audit-2026-08-27/module-composition/examples/graph.safejs",
    "sha256": "ad3ff24fe77d0813d0e24def6984d52c1c6014e36fa9b3a5dfd5c0d795b7fc9b",
    "nativeSha256": "d4514704f9cce57ee740fa06b2d4cb5ba0e64586c76e5d927668224b30649119"
  },
  "invariants": {
    "authorFilesUnchanged": true,
    "basePreimageMatchesActualGitBlob": true,
    "priorMC003CaptureUnchanged": true,
    "auditReadOnly": true,
    "archiveOrSecurityReads": 0,
    "gitMutations": false,
    "publisherFinalGateCertified": false
  }
}
```

## Base and frozen-byte verification

- `git rev-parse HEAD` returned `ecfd838abd37fb061d66dc8721bc3f86067139ad`; branch remained `main`.
- `git show ecfd838abd37fb061d66dc8721bc3f86067139ad:packages/safejs/src/modules/registry.ts` produced 6,478 bytes with SHA-256 `466490d886714c678d8e99d5e4cf6703a0a26a130365ea0db365094356f13d0f`. Those bytes exactly match the author's frozen base-preimage artifact.
- `git ls-tree ecfd838abd37fb061d66dc8721bc3f86067139ad -- packages/safejs/src/modules/namespace-identity-mc-002.test.ts docs/plans/safejs-fix-mc-002.md` returned no entries: both files genuinely are additions at the base.
- Each working publishable was compared byte-for-byte with its frozen copy under `out/safejs-remediation/mc-002/publishables/`, and its size/hash checked against the author manifest before and after validation.
- The two supporting validator paths also have no entries at this base. No frozen base preimage was reconstructed by editing current code.

## Review of the change

`packages/safejs/src/modules/registry.ts` is the only tracked production diff: 11 added and 9 removed lines. The existing `wrappedModules` map is allocated inside `resolveModuleImports`. A null-prototype binding record is now constructed once when exports for a module name are first wrapped, cached in that execution-local map, and returned directly for every namespace import. Previously each namespace specifier created a fresh outer record.

The change preserves wrapping/cancellation of exports, host-operation policy registration, named/default value selection, and per-module/per-execution export copying. It adds no global namespace cache. No snapshot-format, replay-policy, parser, linter, Number, or other-lane production change is included.

The review is scoped to supported SafeJS import forms and the public `run`, `dump`, `restore`, and `runHarness` behavior. `README.md` documents these APIs and `RECOVERY.md` documents failure checkpoints, host-controlled budgets, and non-reexecution of completed journaled operations. This is not a complete ESM live-binding, namespace-immutability, combined-import, or side-effect-import conformance claim.

## Read-only audit bootstrap

Before original payload reads, read only `inventory-verification.json` metadata, extract exactly 38 entries from `archiveReadPolicy.excludedPaths`, assert `alsoExcludeSecurityDirectory`, and exclude the entire security directory. Metadata SHA-256: `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`. The child separately repeats this bootstrap.

The concrete original functional-input allowlist is exactly:

- `out/safejs-audit-2026-08-27/module-composition/examples/graph.safejs`
- `out/safejs-audit-2026-08-27/module-composition-review/native/graph-original.mjs`
- `out/safejs-audit-2026-08-27/module-composition/fixtures.json`
- `out/safejs-audit-2026-08-27/module-composition-review/fixtures.json`
- `out/safejs-audit-2026-08-27/module-composition/manual-expected.json`

All paths are relative to `/Users/kjopek/Workspace/poe-code`. The reader rejects every other original path before opening it. No recursive audit enumeration, excluded read/hash/execute, security research, or security probe occurred. All five allowed input hashes and bootstrap metadata were rechecked unchanged. The prior MC-003 command capture was read only and rechecked unchanged; it supplied the independently previously used driver, not an expected-result substitute.

Exact exclusions established before any payload read:

- `out/safejs-audit-2026-08-27/objects/reductions/special-own.ajs`
- `out/safejs-audit-2026-08-27/strings/evidence/c07-string-budget.safejs.native.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c07-string-budget.safejs.repeat.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c07-string-budget.safejs.safejs.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c08-array-budget.safejs.native.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c08-array-budget.safejs.repeat.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c08-array-budget.safejs.safejs.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c09-regex-budget.safejs.native.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c09-regex-budget.safejs.repeat.json`
- `out/safejs-audit-2026-08-27/strings/evidence/c09-regex-budget.safejs.safejs.json`
- `out/safejs-audit-2026-08-27/strings/reductions/c07-string-budget.safejs`
- `out/safejs-audit-2026-08-27/strings/reductions/c08-array-budget.safejs`
- `out/safejs-audit-2026-08-27/strings/reductions/c09-regex-budget.safejs`
- `out/safejs-audit-2026-08-27/security/REPORT.md`
- `out/safejs-audit-2026-08-27/security/evidence/batch-1.json`
- `out/safejs-audit-2026-08-27/security/evidence/report-command.json`
- `out/safejs-audit-2026-08-27/security/evidence/verification.json`
- `out/safejs-audit-2026-08-27/security/examples/callback-failures.safejs`
- `out/safejs-audit-2026-08-27/security/examples/capability-isolation-acyclic.safejs`
- `out/safejs-audit-2026-08-27/security/examples/capability-isolation.safejs`
- `out/safejs-audit-2026-08-27/security/examples/constructor-rejection.safejs`
- `out/safejs-audit-2026-08-27/security/examples/deadline-capability.safejs`
- `out/safejs-audit-2026-08-27/security/examples/deadline-minimal.safejs`
- `out/safejs-audit-2026-08-27/security/examples/edit-distance.safejs`
- `out/safejs-audit-2026-08-27/security/examples/host-fixtures.mjs`
- `out/safejs-audit-2026-08-27/security/examples/native-transforms.safejs`
- `out/safejs-audit-2026-08-27/security/examples/nested-transforms.safejs`
- `out/safejs-audit-2026-08-27/security/examples/permutations.safejs`
- `out/safejs-audit-2026-08-27/security/examples/prototype-api-rejection.safejs`
- `out/safejs-audit-2026-08-27/security/expectations.json`
- `out/safejs-audit-2026-08-27/security/followup-expectations.json`
- `out/safejs-audit-2026-08-27/security/licenses/endojs.txt`
- `out/safejs-audit-2026-08-27/security/licenses/lodash.txt`
- `out/safejs-audit-2026-08-27/security/licenses/quickjs-ng.txt`
- `out/safejs-audit-2026-08-27/security/licenses/trekhleb.txt`
- `out/safejs-audit-2026-08-27/security/results.json`
- `out/safejs-audit-2026-08-27/security/source-inventory.json`
- `out/safejs-audit-2026-08-27/security/sources.md`

## Original substantial graph: expected equals actual

The primary witness is the exact 4,906-byte, 134-line original graph, SHA-256 `ad3ff24fe77d0813d0e24def6984d52c1c6014e36fa9b3a5dfd5c0d795b7fc9b`. Its imports, both `Number.POSITIVE_INFINITY` sentinels, async metrics, factories, data, scaling, bias and routes were unchanged. The independent unit test embeds those exact bytes and asserts the hash; it does not substitute the prior numeric-only extraction or a compatible global-Infinity rewrite.

Native projection SHA-256: `d4514704f9cce57ee740fa06b2d4cb5ba0e64586c76e5d927668224b30649119`. An exact byte comparison verifies that its only difference is replacing the final top-level `return ` with `export default `. The review fixture datasets and metric stdout are checked equal to the original primary fixtures.

**Native first:** all four native ESM configurations pass the complete retained hand expectations and metric-call ledger before any direct SafeJS run. The native linker uses a module-name-keyed cache of the four explicitly registered factory modules.

**Current TypeScript:** all eight direct SafeJS observations pass full native equality, twice each for object/object, object/map, map/object and map/map registries. Each execution constructs fresh actual `makeHarnessModule` and `makeMetricModule` instances and uses only fixed in-memory metric responses. All runs use 4,316 interpreter steps.

**Public harness:** the independent tests additionally execute the full original graph once per registry shape and once through `runHarness` using memfs. All five pass complete expected outputs and metric ledgers. No guest filesystem module or network/provider capability is registered.

| Graph/node | Expected distance = actual | Expected adjusted = actual | Expected route = actual |
| ---------- | -------------------------- | -------------------------- | ----------------------- |
| alpha/a    | 0                          | 1                          | [a]                     |
| alpha/b    | 6                          | 7                          | [a,c,b]                 |
| alpha/c    | 2                          | 3                          | [a,c]                   |
| alpha/d    | 8                          | 9                          | [a,c,b,d]               |
| beta/s     | 0                          | 2                          | [s]                     |
| beta/t     | 9                          | 11                         | [s,u,t]                 |
| beta/u     | 6                          | 8                          | [s,u]                   |
| beta/v     | 15                         | 17                         | [s,u,t,v]               |

All ten import identity/alias observations are true, including `namespaceContainerSame`. Titles and labels match the complete native output, not only the graph projection. The metric ledger is alpha scale #1, beta scale #1, alpha bias #2, beta bias #2; metric results are [2,3,1,2]. Native/actual comparisons normalize object prototypes with `structuredClone` before `deepStrictEqual`; they do not delete or override the namespace flag.

The original graph lint has zero errors and the unchanged unused `betaPlan` warning. Unlike the prior MC-003-only validation, there is now no remaining namespace-output exception in the full original graph.

## Independent identity, isolation, and recovery

The 18 new tests cover:

- Exact original source hash; full original graph in all four registry shapes; the public memfs harness.
- Supported standalone default, named (including named-default alias), renamed and namespace imports in four different orders, with stable namespace/data/function alias observations.
- Empty repeated namespaces; two module names backed by the same host export object remaining separate.
- Overlapping and later runs using one host registry: namespaces are not shared across executions; guest mutations do not mutate host data; a later run sees updated host input without stale namespace caching.
- Three completed dump/restore replays for both object and map registries, with nested saved namespace aliases preserved and no calls to replacement host implementations.
- Failure checkpoints at 25, 900 and 1,800 steps, after respectively zero, one and two completed host calls. Larger-budget recovery preserves namespace/data/function/saved-reference identity; another completed replay remains stable. The original host-call arguments remain exactly [1] and [2], with no duplicate completed effects.

The recovery anchor is [true,true,true,true,2,11,12,9480]. Full execution uses 2,236 steps. Initial budget measurement explicitly found that 2,700 steps already completes the scenario, so the final checkpoint tests use the measured failing limits rather than falsely calling a completed run a checkpoint.

## Actual commands and final outcomes

Commands execute in the target worktree with `TERM` removed from the child environment, equivalent to the displayed `env -u TERM` prefix. The initial configured package/root/test typechecks, configured ESLint, workflow lint, formatting, and build were independently rerun, not accepted from author logs.

| Check                                                      | Actual outcome                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Exact-base RED: author + validator identity files          | Expected exit 1; 26 failed / 2 passed, 28 total; 3.11 s                  |
| Frozen-source focused regressions                          | Exit 0; 279 passed in 11 files; 5.21 s                                   |
| SafeJS source suite                                        | Exit 0; 4,510 passed / 34 skipped; 148 files passed / 1 skipped; 26.17 s |
| Package TypeScript                                         | Exit 0                                                                   |
| Configured root TypeScript                                 | Exit 0                                                                   |
| Both identity test files, strict test-inclusive TypeScript | Exit 0                                                                   |
| Configured repository ESLint                               | Exit 0                                                                   |
| Configured workflow lint                                   | Exit 0                                                                   |
| All author publishables + validator test Prettier          | Exit 0                                                                   |
| Tracked diff whitespace check                              | Exit 0                                                                   |
| SafeJS dependency build                                    | Exit 0; 67/67 tasks, 0 cached; 27.527 s                                  |

### Focused regressions

```sh
env -u TERM node_modules/.bin/vitest run packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts packages/safejs/src/modules/namespace-identity-mc-002.test.ts packages/safejs/src/modules/registry.test.ts packages/safejs/src/lint/known-globals-mc-001.test.ts packages/safejs/src/lint/known-globals-mc-001-validation.test.ts packages/safejs/src/interp/globals/number-mc-003.test.ts packages/safejs/src/interp/globals/number-mc-003-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts packages/safejs/src/dump.test.ts packages/safejs/src/restore.test.ts
```

Includes the previously landed MC-001 globals/lint, MC-003 constants/graphs, TREE contextual-from, module registry and public dump/restore regressions. Their passing status is a regression check for this frozen MC-002 candidate, not a new certification of another workstream.

### Broader and configured gates

```sh
env -u TERM node_modules/.bin/vitest run packages/safejs/src --reporter=dot
env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM npm run lint:types
env -u TERM node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --resolveJsonModule --types node,vitest/globals packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts packages/safejs/src/modules/namespace-identity-mc-002.test.ts
env -u TERM npm run lint:eslint
env -u TERM npm run lint:workflows
env -u TERM node_modules/.bin/prettier --check packages/safejs/src/modules/registry.ts packages/safejs/src/modules/namespace-identity-mc-002.test.ts docs/plans/safejs-fix-mc-002.md packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts
git diff --check
env -u TERM node_modules/.bin/turbo run build --filter=@poe-code/safejs...
```

The package/root build configurations exclude test files; the separate explicit strict `tsc` command closes that gap for both identity test files. The 34 configured skips were neither enabled nor changed. The 67-task build is not `npm run build`'s complete root code-generation/bundle/release gate. Build-generated terminal fonts were present at handoff and remain excluded from publication. No tracked changes beyond the frozen registry diff appeared after the build.

## Genuine base RED

The source overlay comes from `git show` at the exact supplied base, with SHA-256 asserted against the frozen preimage. A Vite pre-transform substitutes that entire genuine preimage only in memory, leaving all production files and Git state untouched. Exactly one substitution occurs, and the current frozen registry hash is verified unchanged afterward. This is not a hand-made mutation or acceptance of the author's RED log.

Final RED has **10/10 author identity failures and 16/18 validator failures**. The two validator controls (source-byte integrity and separation of different module names) pass. All four original direct graph cases and the memfs harness pass distance/route and metric-ledger assertions first, then fail only because `namespaceContainerSame` is false instead of true. There are no parser/setup failures in this final RED.

Retained exact inline Node program used with `env -u TERM node --input-type=module -e <program>`:

```text
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startVitest } from 'vitest/node';
const file = 'packages/safejs/src/modules/registry.ts';
const base = 'ecfd838abd37fb061d66dc8721bc3f86067139ad';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const currentHash = sha(fs.readFileSync(file));
assert.equal(currentHash, '8028634f68f597c9ed6b086c478601c7807c20fae51266c250efa016459195f9');
const preimage = execFileSync('git', ['show', base + ':' + file], { encoding: 'utf8' });
assert.equal(sha(preimage), '466490d886714c678d8e99d5e4cf6703a0a26a130365ea0db365094356f13d0f');
let substitutions = 0;
const context = await startVitest('test', [
  'packages/safejs/src/modules/namespace-identity-mc-002.test.ts',
  'packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts'
], { watch: false, maxWorkers: 1 }, { plugins: [{
  name: 'mc002-genuine-git-base-memory-overlay', enforce: 'pre',
  transform(source, id) {
    if (!id.endsWith('/' + file)) return;
    assert.equal(sha(source), currentHash);
    substitutions++;
    return { code: preimage, map: null };
  }
}] });
await context.close();
assert.equal(substitutions, 1);
assert.equal(sha(fs.readFileSync(file)), currentHash);
console.log(JSON.stringify({ base, preimageSha256: sha(preimage), substitutions, frozenUnchanged: true }));
```

## Original graph execution program

Actual executable: `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`. Arguments: `--max-old-space-size=192 --experimental-vm-modules --import tsx/esm --input-type=module -e <program>`. Hard host timeout: 30 seconds, output cap: 8 MiB. Exit 0; stderr contains only Node's experimental VM-module warning. The exact program is retained here as command evidence, not as an executable QA script file:

```text
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { makeHarnessModule } from './packages/safejs/src/modules/harness.ts';
import { makeMetricModule } from './packages/safejs/src/modules/metric.ts';
import { run } from './packages/safejs/src/run.ts';
import { Budget } from './packages/safejs/src/interp/budget.ts';
import { lint } from './packages/safejs/src/lint.ts';
import { createLintModulesFromRuntimeRegistry } from './packages/safejs/src/lint/runtime-modules.ts';
const base = '/Users/kjopek/Workspace/poe-code/';
const root = 'out/safejs-audit-2026-08-27/';
const metadataBytes = fs.readFileSync(base + root + 'inventory-verification.json');
const policy = JSON.parse(metadataBytes).archiveReadPolicy;
const excluded = new Set(policy.excludedPaths);
assert.equal(excluded.size, 38);
assert.equal(policy.alsoExcludeSecurityDirectory, true);
const allowedInputs = new Set(['module-composition/examples/graph.safejs', 'module-composition-review/native/graph-original.mjs', 'module-composition-review/fixtures.json', 'module-composition/fixtures.json', 'module-composition/manual-expected.json']);
const reads = [];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(relative) {
  const name = root + relative;
  assert(allowedInputs.has(relative) && !excluded.has(name) && !relative.startsWith('security/'));
  const bytes = fs.readFileSync(base + name);
  reads.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
  return bytes.toString('utf8');
}
const source = read('module-composition/examples/graph.safejs');
const nativeSource = read('module-composition-review/native/graph-original.mjs');
const fixtures = JSON.parse(read('module-composition-review/fixtures.json'));
const primaryFixtures = JSON.parse(read('module-composition/fixtures.json'));
const anchor = JSON.parse(read('module-composition/manual-expected.json')).expectations.graph;
assert.equal(hash(source), 'ad3ff24fe77d0813d0e24def6984d52c1c6014e36fa9b3a5dfd5c0d795b7fc9b');
assert.equal(hash(nativeSource), 'd4514704f9cce57ee740fa06b2d4cb5ba0e64586c76e5d927668224b30649119');
assert.equal(source.slice(3997, 4004), 'return ');
assert.equal(nativeSource, source.slice(0, 3997) + 'export default ' + source.slice(4004));
assert.deepEqual(fixtures.datasets, primaryFixtures.datasets.graph);
assert.deepEqual(fixtures.metricStdout, primaryFixtures.metricStdout);
const shapes = ['object-object', 'map-map', 'object-map', 'map-object'];
function setup(shape) {
  const calls = [];
  const names = ['alpha', 'beta'];
  const frontmatters = fixtures.datasets.map((dataset, index) => ({
    tasks: [structuredClone(dataset)], agents: [],
    principles: [...fixtures.factorySetup[names[index]].principles],
    constraints: [...fixtures.factorySetup[names[index]].constraints]
  }));
  const plans = frontmatters.map((frontmatter, index) => makeHarnessModule(frontmatter, {
    kind: fixtures.factorySetup.kind, version: fixtures.factorySetup.version,
    filepath: fixtures.factorySetup[names[index]].filepath
  }));
  frontmatters.forEach((frontmatter, index) => {
    frontmatter.tasks[0].title = fixtures.factorySetup.postConstructionTitleEdits[index];
  });
  const metrics = names.map(instance => {
    let count = 0;
    return makeMetricModule(async script => {
      assert(Object.hasOwn(fixtures.metricStdout[instance], script));
      calls.push({ instance, script, call: ++count });
      return fixtures.metricStdout[instance][script];
    });
  });
  const objects = {
    planA: { ...plans[0], default: plans[0].tasks, records: plans[0].tasks, decorate: plans[0].applyConstraints },
    planB: { ...plans[1], default: plans[1].tasks, records: plans[1].tasks, decorate: plans[1].applyConstraints },
    metricA: { ...metrics[0], default: metrics[0].run, score: metrics[0].run },
    metricB: { ...metrics[1], default: metrics[1].run, score: metrics[1].run }
  };
  const [outer, inner] = shape.split('-');
  const entries = Object.entries(objects).map(([name, exports]) => [name, inner === 'map' ? new Map(Object.entries(exports)) : exports]);
  return { modules: outer === 'map' ? new Map(entries) : Object.fromEntries(entries), calls };
}
const expected = [];
for (const shape of shapes) {
  const { modules, calls } = setup(shape);
  const registry = modules instanceof Map ? modules : new Map(Object.entries(modules));
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const cache = new Map();
  const entry = new vm.SourceTextModule(nativeSource, { context, identifier: 'MC-003-native-original' });
  await entry.link(name => {
    assert(registry.has(name));
    if (!cache.has(name)) {
      const exports = registry.get(name);
      const entries = exports instanceof Map ? [...exports] : Object.entries(exports);
      cache.set(name, new vm.SyntheticModule(entries.map(([key]) => key), function () {
        for (const [key, value] of entries) this.setExport(key, value);
      }, { context, identifier: name }));
    }
    return cache.get(name);
  });
  await entry.evaluate({ timeout: 2000 });
  const value = structuredClone(entry.namespace.default);
  assert.deepEqual(value, anchor.returnValue);
  assert.deepEqual(calls, anchor.calls);
  expected.push({ shape, returnValue: value, calls });
}
console.log(JSON.stringify({ phase: 'native-expected-first', node: process.version, sourceSha256: hash(source), nativeSourceSha256: hash(nativeSource), excludedPaths: [...excluded], securityDirectoryExcluded: true, metadataSha256: hash(metadataBytes), reads, expected }));
const observations = [];
for (const native of expected) {
  for (let repetition = 1; repetition <= 2; repetition++) {
    const { modules, calls } = setup(native.shape);
    const diagnostics = lint(source, { modules: createLintModulesFromRuntimeRegistry(modules) });
    const budget = new Budget({ maxSteps: 100000, maxCallDepth: 64, stringLength: 32768, arrayLength: 4096, dataSize: 2097152, deadline: Date.now() + 2500 });
    const result = await run(source, { modules, budget, randomSeed: 827 });
    assert.equal(result.ok, true);
    const value = structuredClone(result.returnValue);
    assert.deepEqual(value.alpha, native.returnValue.alpha);
    assert.deepEqual(value.beta, native.returnValue.beta);
    assert.deepEqual(calls, native.calls);
    assert.deepEqual(value, native.returnValue);
    observations.push({ shape: native.shape, repetition, ok: result.ok, graphPayloadMatch: true, fullNativeMatch: isDeepStrictEqual(value, native.returnValue), returnValue: value, calls, lint: diagnostics, stats: result.stats, budget: { stepsUsed: budget.stepsUsed, peakCallDepth: budget.peakCallDepth, peakDataSize: budget.peakDataSize } });
  }
}
console.log(JSON.stringify({ phase: 'safejs-current-source', observations }));
```

## Preserved validator failures and scope corrections

No failure is omitted from the conclusion:

1. The first new-test attempt had a missing closing bracket in the validator's registry-shape array. It failed collection at line 407; only the author's 10 tests ran and failed against the genuine base. This attempt is not counted as independent test RED. The validator alone corrected the delimiter.
2. The next initial RED had 26 failures / 2 passes, but five failures involved unsupported test syntax. The following frozen-source focused run therefore had 5 failures / 274 passes. Four added cases used combined default-plus-named/namespace or bare side-effect imports; the empty-namespace case also used a bare side-effect import. Errors were `Expected 'from'` or `Unexpected token`, before module execution.
3. The unchanged parser at the exact base and current source accepts one standalone import form per declaration, not those combined/bare forms. The validator replaced only those five cases with supported standalone import ordering and empty repeated namespace cases, without relaxing any identity/isolation expectations or changing production. This is a disclosed validation-scope correction, not a repaired or concealed MC-002 runtime regression.
4. After correcting the scope, the entire genuine-base RED and frozen-source GREEN were rerun. The final RED has no ParseError; final focused/broader tests and every configured gate pass.

Captured-output hashes distinguish those attempts:

| Attempt                          | Exit | stdout SHA-256                                                   | stderr SHA-256                                                   |
| -------------------------------- | ---- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Initial delimiter failure        | 1    | aeb411b8f495be02c39cbe88677853deebd60deb958c3e7acc2138cb2c897502 | 8a1e97f25d46dcf6eb95c1aa1334da2f0ab3f14c91933b3029540142d418fe15 |
| Pre-scope-correction RED         | 1    | d1abd3d5b786e186a4723487a8ff52041eabfcb921e917324b73bfa57e1d8e40 | 7a0a9f1b3da780bae74aaa2f67ceb39560e833fd354631c58cca7c9743ec5274 |
| Unsupported-form focused attempt | 1    | 1f88150eca755cb2bf844200c7b51d201ab25aa58d0fe2e7d5a5567ee056d936 | 33f5634904ee7dbc9679b6b42dbeff40132778d8f04385010411e95fd1454945 |
| Final genuine-base RED           | 1    | a5972e18517d05939138d3d6864d8bd6a12daed3dcf2a398cfd53571a77e57f1 | 2dee0aab595cfad92eb17edae2b1032dea97c3e807ccd68224513bc8886f050a |
| Final focused GREEN              | 0    | 9acbcfd0263158fecf81b6ff89b9a3365646c3765933348deff268446579d0d8 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Broad source suite               | 0    | ade6f99ebd58da9d8affd5a5bdb1e971a9c68f926662cbde5a843247f81d2985 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| Build                            | 0    | fbd6cb5f4ef632d8f748680b510a534b257a218082b9feb3ef0478f52ad38196 | a6052069f52915d75bf1cd6f441c4ea945b949f416a2eb62f2a69ce234408bd4 |

The complete command programs, counts, failure diagnostics and their classification are retained in this Markdown report. No extra evidence files or QA scripts were created outside the explicitly allowed validator test/report paths.

## Limits and publisher handoff

- Original graph native evaluations: 2,000 ms each. SafeJS: 100,000 steps, depth 64, strings 32,768, arrays 4,096, data 2 MiB, deadline 2,500 ms. Direct runtime is current TypeScript, not stale dist.
- Independent checkpoint recovery uses at most 10,000 steps and fixed, immediate stub responses. New filesystem interactions are memfs-only; there are no guest network, guest filesystem, real metric scripts, real providers, or LLM calls.
- Original archive/security payload reads, hashes and executions: zero. Entire security tree excluded. No fuzz/adversarial campaign, intentional dangerous input, or security research was added.
- Source suite only, not the whole repository unit suite or E2E. No complete root bundle, installed-consumer, release, publisher-preimage, or publisher-full-gate certification.
- No CLI appearance changed, so screenshot validation is not applicable. No source standards expansion, descriptor/live-binding conformance, or unrelated parser repair is claimed.
- The three author files retain their original frozen hashes and actual-base preimages. Parent/publisher must recheck those preimages against its own clean main clone; do not blanket-stage the shared worktree, generated assets, or local author evidence. Supporting validator test/report publication remains a separate explicit decision.

## Coordinator publication-set approval — August 29, 2026

The coordinator explicitly approves adding the independent validation test and this report to the three author publishables, making the publication candidate exactly five files:

1. `packages/safejs/src/modules/registry.ts`
2. `packages/safejs/src/modules/namespace-identity-mc-002.test.ts`
3. `packages/safejs/src/modules/namespace-identity-mc-002-validation.test.ts`
4. `docs/plans/safejs-fix-mc-002.md`
5. `docs/plans/safejs-validate-mc-002.md`

This append supersedes only the earlier three-file publication-set restriction. All prior validation results, limits, failure history, and the earlier embedded manifest remain unchanged as historical evidence. No code or assertion changed. The report before this append has SHA-256 `4502e344fbe4b39ddf04cd55cb95339f002bf24dfb85a34c96b9457f2c3ffc65`.

The five approved file copies, the existing validated registry base preimage for `ecfd838abd37fb061d66dc8721bc3f86067139ad`, and a standalone manifest are frozen under the already ignored `out/safejs-remediation/mc-002/candidate/`. The earlier three-file author capture is preserved unchanged. No original audit inputs are reread for this packaging step.

This is publication-set approval only, not permission to push. The publisher alone must check its actual main preimages and run fresh full gates before publication. The candidate freeze does not certify or perform those publisher steps.
