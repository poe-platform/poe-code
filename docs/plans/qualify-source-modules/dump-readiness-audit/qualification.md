# Source-module checkpoint boundary qualification

Disposition: **qualify-source-modules is incomplete**. The existing working-tree
source-module candidate was audited, not included in this commit. The committed
repair makes unsupported live-run dump requests fail promptly instead of waiting
indefinitely on an unresolved host operation. It does not implement graph replay.

Source base: `60a6f594ec0f40467b61880a856a626d3b14de35`, branch `main`.
Runtime: Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, Darwin arm64.
Observation date: **2026-09-13 UTC**. The target remains published ECMA-262
edition 16 / ECMA-402 edition 12 plus the previously tracked newer APIs.
Test262 remains `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.
The maintained conformance runner recorded candidate source digest
`bce76d2afd041d595a1bae1e2e3169885fa88fed72c657d9898948e402a89cd9` and manifest
`185a1ead7189923b2a5dce8d44d778a4b82dbcf40e9873736c085368a3b769dd`.

## Validated repair and exact commit checks

`run.live-dump.test.ts` first produced **two failures / one pass**: both `dump`
and `dumpCurrent` remained pending across a host turn while an imported host
function awaited an unresolved promise. The regression uses a turn boundary,
not a test timeout, to detect nonsettlement. Cleanup explicitly cancels the run.
The live-run branch now attaches the existing dump controller with the existing
unsupported-snapshot error. Dump requests reject without interrupting execution;
subsequent cancellation and successful host completion remain independently tested.

The task-owned `run.ts` hunk and the new test were also applied to a detached
checkout of the source base. This excludes the pre-existing source-module
candidate and unrelated changes from the verification of committed code.
These manual checks passed on those exact code files:

```sh
npm run pretest --workspace=@poe-code/safe-js
npx vitest run packages/safe-js/src/run.live-dump.test.ts packages/safe-js/src/dump.test.ts packages/safe-js/src/snapshot/dump-readiness.test.ts packages/safe-js/src/run.pending-imported-promise-cancellation.test.ts packages/safe-js/src/realm.test.ts
npx eslint packages/safe-js/src/run.ts packages/safe-js/src/run.live-dump.test.ts
npx tsc --noEmit -p packages/safe-js/tsconfig.json
```

Results: pretest passed all four filesystem type-contract environments;
**49 tests passed / zero failed / zero skipped**, five files; lint and
typechecking exited **0**. The first isolated test attempt omitted generated
number-format data and failed five suites during import, executing **no tests**.
Running the maintained pretest generated that data; the rerun above passed.
An initial context patch could not apply to the detached base because its
surrounding source-routing changes were intentionally excluded. Applying only
the task-owned hunk resolved this preparation error. Neither failure is a pass.

## Working-tree candidate checks

The same five test files plus `run.source-modules.test.ts` and
`realm.source-modules.test.ts` passed **67 tests**, zero failures/skips.
The following integration selection passed **132 tests**, zero failures/skips:

```sh
npx vitest run packages/safe-js/src/modules/source-graph.test.ts packages/safe-js/src/modules/source-bindings.test.ts packages/safe-js/src/modules/source-files.test.ts packages/safe-js/src/modules/source-linking-budget.test.ts packages/safe-js/src/modules/source-request-budget.test.ts packages/safe-js/src/modules/module-environment.test.ts packages/safe-js/src/parse/source-module.test.ts packages/safe-js/src/parse/source-module-context.test.ts packages/safe-js/src/parse/source-import-meta.test.ts packages/safe-js/src/run.source-root.test.ts packages/safe-js/src/cli.source-modules.test.ts packages/safe-js/test/conformance/source-modules.test.ts packages/safe-js/test/conformance/corpus.test.ts packages/safe-js/test/conformance/execute.test.ts packages/safe-js/test/conformance/worker.test.ts
```

Working-tree lint of both changed code files and package typechecking passed.
These tests cover live bindings, re-exports, namespaces, cycles, linking errors,
dynamic imports, TLA, cached async failures, realm ownership, registered grants,
resolver denial, unsupported attributes and existing budget/cancellation controls.

Pinned module execution was repeated through the maintained command:

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-baseline-test262-419d3e0 --report /Users/kjopek/Workspace/poe-code/docs/plans/qualify-source-modules/dump-readiness-audit/module-code.jsonl --include language/module-code
```

Complete report, exit **1**: **594 passed / two failed / six unsupported**,
602 variants, 755 selected files including 156 fixture helpers. These are actual
Module executions, not blanket exclusions. The two failed files remain
`namespace-unambiguous-if-import-star-as-and-export.js` and
`namespace-unambiguous-if-export-star-as-from-and-import-star-as-and-export.js`;
their previously recorded newer-edition namespace-normalization disposition is
unchanged. Five unsupported source-phase variants require an ungranted newer
capability. The remaining unsupported `top-level-await/syntax/await-expr-dyn-import.js`
retains the missing-source-authority disposition. None is counted as a pass.
The existing 3000 ms variant deadline, 10000 ms process-start limit and maintained
runner budget defaults were unchanged. Separate finite-budget regressions passed.

Full package/root gates, the whole dynamic-import corpus and the runtime matrix
were not repeated for this focused repair; their historical receipts are not
requalified. Raw command output and JSON probes remain local audit artifacts in
this directory and are not part of the commit.

## Manual CLI inspection

Run the maintained screenshot script against the package CLI:

```sh
npx tsx scripts/screenshot.ts --output docs/plans/qualify-source-modules/dump-readiness-audit/source-module-run.png node --import tsx packages/safe-js/src/cli.ts --source-type module --source-root docs/plans/qualify-source-modules/fixtures docs/plans/qualify-source-modules/fixtures/entry.ajs
```

It exited **0**. The image was opened and visually inspected: the command and
`{"ok":true,"returnValue":{"result":2}}` are complete and readable. This is an
ad hoc visual check, not a screenshot unit test. The root `screenshot-poe-code`
shorthand targets a different CLI. No visual language was changed.

## Remaining checkpoint failure

Run from the main working tree with `node --import tsx --input-type=module`:

```js
import {run} from './packages/safe-js/src/run.ts';
import {dump} from './packages/safe-js/src/dump.ts';
const source = "export {value} from 'dep'";
const a = await run(source, {sourceType: 'module', sourceResolver: () =>
  ({id: 'dep', source: 'export const value=1'})});
const b = await run(source, {sourceType: 'module', sourceResolver: () =>
  ({id: 'dep', source: 'export const value=2'})});
console.log(a.returnValue.value, b.returnValue.value,
  a.snapshot.sourceHash, b.snapshot.sourceHash);
try { await dump(a); } catch (e) { console.log(e.message); }
let calls = 0;
try { await run(source, {sourceType: 'module', snapshot: a.snapshot,
  sourceResolver: () => { calls++; return {id: 'dep', source: 'export const value=2'}; }
}); } catch (e) { console.log(e.message, calls); }
```

Observed **1, 2, 621f4a91, 621f4a91**. Dump rejects live realm serialization;
restore rejects unsupported live snapshots before calling the resolver (**zero
calls**). `Scope.captureFrame()` on a scope with `declareImport()` still throws
`Source module import frames require graph checkpoint encoding.` These are
negative boundaries, not successful graph identity or restore mismatch checks.

Both public dump functions were separately requested while module execution was
pending on (a) the source resolver and (b) a registered host operation. They now
reject the unsupported snapshot promptly. Cancelling each run still returns the
exact supplied cancellation reason. Positive checkpoint capture and pending-host
replay remain absent; prompt rejection does not satisfy that acceptance criterion.

## Remaining rooted authority failure

The two-swap counterexample was rerun with memfs, creating no real fixture files:

```js
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {fs, vol} from 'memfs';
vol.fromJSON({'/grant/sub/dep.js': 'export const secret=false',
  '/outside/dep.js': 'export const secret=true'});
const original = {realpath: fsPromises.realpath, stat: fsPromises.stat,
  open: fsPromises.open};
let stage = 0;
try {
  fsPromises.stat = async path => {
    if (path === '/grant/sub/dep.js' && stage === 0) {
      vol.renameSync('/grant/sub', '/grant/prior');
      vol.symlinkSync('/outside', '/grant/sub'); stage = 1;
    }
    return fs.promises.stat(path);
  };
  fsPromises.open = fs.promises.open;
  fsPromises.realpath = async path => {
    if (path === '/grant/sub/dep.js' && stage === 1) {
      vol.unlinkSync('/grant/sub');
      vol.renameSync('/grant/prior', '/grant/sub'); stage = 2;
    }
    return fs.promises.realpath(path);
  };
  syncBuiltinESMExports();
  const {createRootedSourceResolver} = await import(
    './packages/safe-js/src/modules/source-files.ts');
  const resolver = await createRootedSourceResolver('/grant');
  const result = await resolver('./sub/dep.js', '/grant/entry.js', {});
  console.log(stage, result);
} finally { Object.assign(fsPromises, original); syncBuiltinESMExports(); }
```

The resolution reaches stage 2 and returns the **outside** source
`export const secret=true` under `/grant/sub/dep.js`. The expected inode was
already outside at `stat`; restoring the directory before `realpath` defeats
the later pathname check. The retained handle does not provide atomic ancestor
confinement. No repeated pathname check or broader filesystem grant was added
as a purported fix. A qualified descriptor-relative primitive or equivalent
design is still required across supported platforms.

## Delivery

This report accompanies only the live-dump repair and its regression tests.
The existing module implementation, prior ledger additions and unrelated staged
files remain uncommitted and preserved. The local commit SHA is reported after
commit creation; no task push was initiated. Verified remote-main delivery:
**none**. Successful release/publication receipts: **none**.

The source graph still lacks checkpoint encoding for identities, import cells,
namespaces, async states and pending host/resolver operations, and restore lacks
manifest-aware validation. These implementation gaps and the demonstrated root
escape block the requested acceptance. No authority, assertion, runtime support,
budget, timeout or compatibility target was weakened.
