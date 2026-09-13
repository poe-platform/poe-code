# Error completion qualification, 2026-09-13

**Acceptance remains blocked.** This commit adds four independent completion/cleanup traces and records current qualification. It makes no runtime repair and does not adopt the existing dirty runtime repairs or untracked qualification tests.

## Target and source

The target remains [ECMA-262 edition 16, June 2025](https://262.ecma-international.org/16.0/) and ECMA-402 edition 12, with Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Resource management is the separately tracked [proposal revision 38c13295dc20c2273ba0a6ed82555f1fabb37764](https://github.com/tc39/proposal-explicit-resource-management/blob/38c13295dc20c2273ba0a6ed82555f1fabb37764/spec.emu). The newer stack-accessor cases below remain extension failures, not edition defects. Naming ECMAScript grants no ambient imports, host access, or authority to evaluate host getters.

Source HEAD: `2d36d34699ea800144d3176f919d41dac697a5e4`, on `main`, with preserved dirty changes. Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, Darwin arm64. The corpus fingerprints the actual working source, not only HEAD. Earlier passing repairs in this checkout are not delivered by this commit.

New test bytes SHA-256: `409ae58114c88e6f18e3d807b0b9ecb6de5eba7c3d67ffe0434c2b7b207836b4`. The committed regression is `packages/safe-js/src/interp/completion-cleanup-traces.test.ts`.

## Independent traces and manual checks

The three edition traces have explicit expected event lists and separate native Node controls. They cover finally-continue canceling return without premature IteratorClose, missing delegated throw closing before catch/finally, and a failing close taking precedence over the missing-throw TypeError. The extension trace covers two asynchronous disposer failures suppressing the body AggregateError in reverse cleanup order, preserving error/cause identity, before an outer finally return overrides the throw. All four check original execution and completed replay.

Manual checks passed for the exact test bytes committed:

- New file alone: **4 passed**, zero skips, exit 0.
- Focused maintained-source selection: **215 passed / 19 files**, zero skips, exit 0. This includes existing step-budget, cancellation recovery, host diagnostic getter, error subclass/cause, pending replay and disposal tests. These are overlapping coverage, not 219 unique tests; pre-existing untracked tests are not claimed as committed regressions.
- Targeted ESLint: exit 0.
- Archived HEAD SafeJS source plus only the new test: **4 passed**, zero skips, exit 0. This independent control uses installed dependencies and a minimal Vitest configuration; it is not a workspace build or installed-package qualification. Two setup attempts initially imported no tests because generated Intl modules were absent; running HEAD's maintained numberformat-data script through its canonical filesystem path generated them. These setup failures are retained, not counted as passing tests.
- Two isolated deadline-only probes: both reject with `budgetExceeded/deadline`, process exit 0, without the unchanged five-second external watchdog. Each uses a 500 ms guest deadline and a 600 ms host gate followed by an infinite finally, with and without a host trace at entry. This bounded observation does not establish all cancellation/deadline paths.

No runtime, budget, timeout, assertion, support declaration, README, CLI behavior, or visual presentation changed. There is no repaired runtime failure requiring a red/green claim. Full package/repository checks, builds, screenshots, the supported runtime/platform matrix, pending replay of all failing paths, and installed-artifact checks are **not** claimed. The narrow checks are appropriate to the new test-only change; broader qualification remains open.

## Reproduction commands

Run from repository root with the source and dependency versions above. Use the pinned Test262 checkout; do not substitute its moving main branch. Keep the maintained runner's **3000 ms** per-variant wall deadline and **10000 ms** startup deadline. The command inherits the runner's existing unlimited semantic limits and isolated deadline; none were changed for this audit. Fatal-budget tests separately use explicit finite budgets.

```sh
npx vitest run packages/safe-js/src/interp/completion-cleanup-traces.test.ts
npx vitest run packages/safe-js/src/interp/completion-cleanup-traces.test.ts packages/safe-js/src/interp/error-completions-qualification.test.ts packages/safe-js/src/interp/error-ownership-qualification.test.ts packages/safe-js/src/interp/restricted-error-owner.test.ts packages/safe-js/src/interp/async-return-ownership-qualification.test.ts packages/safe-js/src/interp/generator-reentry-qualification.test.ts packages/safe-js/src/interp/globals/disposable-stack.test.ts packages/safe-js/src/interp/globals/async-disposable-stack.test.ts packages/safe-js/src/interp/resource-declarations.test.ts packages/safe-js/src/snapshot/async-disposable-stack.test.ts packages/safe-js/src/snapshot/error-data.test.ts packages/safe-js/src/interp/error-diagnostic-accessors.test.ts packages/safe-js/src/interp/foreign-host-error.test.ts packages/safe-js/src/interp/foreign-aggregate-error.test.ts packages/safe-js/src/host-error-identity.test.ts packages/safe-js/src/error
npx eslint packages/safe-js/src/interp/completion-cleanup-traces.test.ts
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-baseline-test262-419d3e0 --report /Users/kjopek/Workspace/poe-code/docs/plans/qualify-error-completions/qualification-20260913/corpus.jsonl --include built-ins/Error --include built-ins/NativeErrors --include built-ins/AggregateError --include built-ins/SuppressedError --include built-ins/DisposableStack --include built-ins/AsyncDisposableStack --include built-ins/ThrowTypeError --include language/statements/try --include language/statements/throw --include language/statements/break --include language/statements/continue --include built-ins/GeneratorPrototype --include built-ins/AsyncGeneratorPrototype --include built-ins/AsyncFromSyncIteratorPrototype --include language/expressions/yield
```

To reproduce the host Proxy boundary observation:

```sh
node --import tsx --input-type=module <<'JS'
import { run } from './packages/safe-js/src/run.ts';
const trace = [];
const reason = new Proxy({}, {
  getPrototypeOf() { trace.push('getPrototypeOf'); return null; },
  get(_, key) { trace.push('get:' + String(key)); return undefined; }
});
const result = await run('try{fail()}catch(e){return [e.name,e.message]}', {
  bindings: { fail() { throw reason; } }
});
console.log(JSON.stringify({ trace, ok: result.ok, result: result.returnValue }));
JS
```

Actual result: `{"trace":["getPrototypeOf","getPrototypeOf","getPrototypeOf"],"ok":true,"result":["Error","Host operation failed."]}`. An empty trap trace is required for trap-free throwable classification; that requirement still fails. The `instanceof` checks in `isFatalBridgeError` and `createHostErrorValue` remain a concrete lead. This observation does not claim arbitrary host Proxy admission as an ECMAScript requirement, nor prove credential extraction. It blocks the requested host diagnostic ownership qualification.

The local raw receipts are under `docs/plans/qualify-error-completions/qualification-20260913/`; they are reproducibility artifacts, not committed source. Commands, terminal results and every nonpass disposition are retained in this committed report.

## Final corpus and all failure dispositions

The unchanged fifteen-selector corpus completed **2026-09-13T12:49:04.053Z–2026-09-13T12:51:03.396Z**, exit **1**, complete: **914 files / 1811 variants / 1736 passed / 75 failed**, zero unsupported, metadata errors or execution errors. Every filename/source-hash/mode cell, status, reason and detail matches the preceding static-block/resource grammar run; no new failure or disappearance is hidden. All tests in the new trace file pass independently; there is no runtime repair in this commit.

Runner source fingerprint: `ef129136523fbc30ba25e6d8251e80a37b11d51c9d5a031e2c3a2ddd75d5b419`. Manifest: `b4ac664dc17da5e633d37e2a573608d2b7b66ff61ca1bcdf75e8c034af25a45d`. Raw report SHA-256: `f086f96db583a9485af7b523839a64449e02e44230d2f4e5883fa0c365d1c162`. The initial attempt aborted during enumeration after the new test was added (exit 1, no completed corpus); its `enumeration-aborted-*` receipts are retained. The rerun above had stable source throughout.

Each row below names every nonpassing variant. **E-REALM** is a current cross-realm error ownership defect (foreign strict-arguments restricted accessor; wrong TypeError constructor), jointly owned with qualify-realms-and-recovery. **E-TCO** is an unresolved strict tail-call/performance failure at the unchanged 3000 ms deadline, not waived as an engine limitation. **E-STACK-EXT** is missing newer stack-accessor support/qualification, explicitly separate from the edition target. All three dispositions **block completion**; no nonpass is counted as a pass or skip.

| Corpus file                                                             | Failed modes   | Case        | Observed failure                                                                                             |
| ----------------------------------------------------------------------- | -------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `built-ins/Error/prototype/stack/getter-cross-realm.js`                 | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-data-property-shadows.js`       | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-error-as-prototype.js`          | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-error-instance.js`              | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-error-prototype.js`             | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-foreign-new-target.js`          | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-no-error-data.js`               | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-not-a-constructor.js`           | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-receiver-is-proxy.js`           | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-subclass.js`                    | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/getter-this-not-object.js`             | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/instance-no-own-stack.js`              | sloppy, strict | E-STACK-EXT | Error: hasOwnProperty("stack") is false Expected SameValue(«true», «false») to be true                       |
| `built-ins/Error/prototype/stack/instance-not-enumerable.js`            | sloppy, strict | E-STACK-EXT | Error: getOwnPropertyNames does not include "stack" Expected SameValue(«0», «-1») to be true                 |
| `built-ins/Error/prototype/stack/prop-desc.js`                          | sloppy, strict | E-STACK-EXT | Error.prototype.stack getter should be a function Expected SameValue(«"undefined"», «"function"») to be true |
| `built-ins/Error/prototype/stack/setter-creates-own-property.js`        | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-cross-realm.js`                 | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-delete-round-trip.js`           | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-empty-string.js`                | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-existing-own-property.js`       | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-no-argument.js`                 | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-non-error-receiver.js`          | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-non-extensible-receiver.js`     | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-non-string-value.js`            | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-non-writable-stack.js`          | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-not-a-constructor.js`           | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-own-accessor.js`                | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-proxy-trap-rejects.js`          | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-proxy-trap-throws.js`           | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-proxy-wrapping-prototype.js`    | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-receiver-is-null-proto.js`      | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-receiver-is-other-prototype.js` | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-receiver-is-prototype.js`       | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-receiver-is-proxy.js`           | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-this-not-object.js`             | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/Error/prototype/stack/setter-via-assignment.js`              | sloppy, strict | E-STACK-EXT | Cannot read properties of null or undefined.                                                                 |
| `built-ins/ThrowTypeError/distinct-cross-realm.js`                      | sloppy, strict | E-REALM     | Expected a TypeError but got a different error constructor with the same name                                |
| `language/statements/try/tco-catch-finally.js`                          | strict         | E-TCO       | Isolated variant exceeded 3000 ms; child terminated                                                          |
| `language/statements/try/tco-catch.js`                                  | strict         | E-TCO       | Isolated variant exceeded 3000 ms; child terminated                                                          |
| `language/statements/try/tco-finally.js`                                | strict         | E-TCO       | Isolated variant exceeded 3000 ms; child terminated                                                          |

## Acceptance and delivery

Independent completion, cleanup and error-alias traces now have four additional regressions. Existing focused tests revalidate subclasses, AggregateError/SuppressedError/cause, accessor-based diagnostic fields, foreign errors, original/completed/pending replay and finite-budget/cancellation behavior. This does not certify cross-realm restricted accessors or trap-free host throwable classification: the five edition variants, seventy extension variants and three host Proxy traps above remain explicit blockers. Broader runtime/platform, pending failure-path replay and installed-artifact gates remain unverified. The task is **not complete**.

Local delivery is the Conventional Commit containing this report, the new test, and the appended evidence-ledger section. Only those paths/hunks are staged through a separate index based on HEAD. The existing index and all prior working changes are preserved. The pre-existing staged diff SHA-256 is `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`; before documentation editing the original tracked working diff was also unchanged. No earlier runtime repairs or unrelated staged safe-bash edits enter this commit.

**Remote-main receipt:** no push requested or performed; no verified remote delivery for this commit. **Publication receipt:** no release initiated or verified for this commit. Earlier releases do not deliver these regressions. The local SHA is reported separately after commit creation; the commit carrying this report is its durable local receipt.
