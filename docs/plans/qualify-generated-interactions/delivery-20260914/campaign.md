# Generated interaction campaign GI-1

This is an agent-executed Markdown campaign over the maintained SafeJS
adversarial Vitest tooling, not a separate QA executable. The acceptance gate is
terminal accounting, realized seed/grammar evidence, and disposition of every
mismatch as repaired or a reproducible blocking counterexample. Semantic success
and delivery are separate gates. Random counts are not conformance percentages.

Compatibility remains ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025),
Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Async disposal is the separately
tracked resource-management extension
`38c13295dc20c2273ba0a6ed82555f1fabb37764`, not an addition to the edition target.
Primary source clauses and document hashes are in `primary-spec-extracts.json`;
the extension source is retained as `resource-management-spec.emu`.

## Declared generation and limits

Reuse `test/adversarial/random.ts` and `report.ts`. Seeds are `0xad5c2026`,
`0x02622025`, `0x51a9cafe`; eight draws per seed, with integer value 1–8 and
resize 0–3. Each row instantiates five bounded interaction templates:
Proxy get/ToPrimitive during array resize; async disposal of return/throw before
an awaited finally; eval-created mutable closures through completed snapshots;
a two-node source-module cycle with top-level await; strongly rooted weak-map
keys and aliased shared views across host cancellation. There is no recursive
grammar production. Program source is at most 2,048 characters; eval calls at
most five, array literals at most four elements, module cycles two nodes plus one entry module (three total source records),
shared buffers 16 bytes. Generated runs use fresh budgets: 10,000 steps,
32 call depth, 128 array length, 4,096 string length, 1,000,000 data bytes,
500 ms deadline. Vitest's 2,000 ms per-case timeout remains unchanged.
The final campaign has a separate 30-second process watchdog; a watchdog failure
is incomplete evidence, never a pass. Reduced probes are finite straight-line
programs under the same 2,000 ms test timeout and default runtime limits.

`coverage.json` lists the actual seed, index, numeric parameters and completion
branch for every row. This is template/parameter coverage, not instrumented
runtime branch coverage. Numeric mutations do not establish comprehensive
grammar exploration, GC scheduling or edition-wide compatibility.

## Oracles and authority

| Family | Primary contract and category owner | Admitted comparison |
| --- | --- | --- |
| Proxy resize | ArraySetLength steps 3–4, ToPrimitive; qualify-exotic-interactions | Explicit two-conversion trace and array result; native VM is a control |
| Disposal/finally | Pinned DisposeResources, block disposal before finally; qualify-error-completions | Explicit body/disposal/finally trace for return and throw; no unavailable native syntax oracle |
| Eval/snapshot | PerformEval lexical environment; qualify-language-semantics and qualify-snapshot-adversarial-input | Explicit increments, native strict-function control, original/completed-replay equality |
| Module cycle/TLA | InnerModuleEvaluation and module linking; qualify-source-modules | Explicit initialized function binding and awaited result; resolver permits only two literal source IDs |
| Weak/shared cancellation | WeakMap and shared-buffer aliasing plus run/host admission contract; qualify-lifecycle-and-retention | Strongly held key and shared-view neighbor; cancellation Error data and zero call depth |

Completed replay is used only for closed guest histories: no host calls, time,
randomness, finalizers or weak liveness. It compares the original result to a
JSON dump/restore completed result. Cancellation has no replay equality oracle.
The only cancellation authority is registered `cap.stop`; no ambient imports,
filesystem, network, GC forcing, worker scheduling or injected shared memory.
Native VM synchronous execution is limited to 100 ms. Native is never the source
of the expected result. The pending-disposal probes separately exercise the
public `dump(pending)` / `restore` contract; they do not stand for completed replay.

## Execution and review

1. Inspect local main, fetched remote main and AGENTS.md. Fingerprint dirty
   sources and preserve the staged diff. Do not qualify remote main by local
   results when source/API differences exist.
2. Run the five-family generated test through maintained Vitest. Preserve JSON
   test results, stderr/stdout and the source/Node/ICU receipt. Initial exploratory
   pending-snapshot and native-identity assumptions remain archived separately.
3. For each mismatch, reduce numeric values, remove trace/return/finally syntax,
   then remove individual interaction features. Keep the smallest observed
   reproducer and a neighboring passing control. Grammar deletion was performed
   manually because the maintained line-based synchronous minimizer cannot
   evaluate asynchronous run/dump failures. No parallel minimizer was added.
4. Re-run the reduced success assertions on local and an archive of fetched
   remote main. A counterexample must retain its failing success assertion.
   Known counterexamples use the existing `SAFEJS_ADVERSARIAL_SLOW=1` qualification
   gate; normal-suite skips are explicit nonpasses, not repaired cases.
5. Run pinned upstream controls with the maintained conformance command and
   unchanged 3,000 ms variant / 10,000 ms startup limits. Record fixture hashes,
   exact selection, failures/skips and terminal summary. These controls cannot
   prove the product snapshot contract or broader generated interactions.
6. Run the maintained adversarial directory and scoped ESLint. Review the final
   terminal accounting and append dispositions and delivery receipts to
   `docs/plans/safejs-gap-closure-evidence.md`.

Reproduce the generated campaign from the repository root:

```sh
SAFEJS_ADVERSARIAL_SLOW=1 npx vitest run \
  packages/safe-js/test/adversarial/generated-interactions.test.ts \
  packages/safe-js/test/adversarial/generated-interactions-counterexamples.test.ts \
  --reporter=json --outputFile=<new-results.json>
```

Use a 30-second external process watchdog, as recorded in the final execution
receipt. Do not overwrite archived results. Run one family with `-t 'Proxy resize'`,
or one reduced case with `-t 'minimized disposal replay'`. Source templates plus
seed/index and `coverage.json` reproduce every generated program; complete
original failure sources are retained in `initial-results.json`.

Reproduce the upstream controls (choose a new report filename):

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- \
  --corpus /private/tmp/safejs-exotic-test262 \
  --include built-ins/Array/length/define-own-prop-length-coercion-order-set.js \
  --include staging/explicit-resource-management/await-using-in-block.js \
  --include language/module-code/top-level-await/pending-async-dep-from-cycle.js \
  --report <new-report.jsonl> --timeout-ms 3000
```

The corpus checkout must match the pin in `fixtures.json`; the maintained report
also pins harness hashes. Missing historical `/private/tmp/safejs-baseline-test262-419d3e0`
was a setup failure; the fresh verified exotic checkout was used instead.

## Disposition

GI-PENDING-DISPOSAL is an unresolved product snapshot-contract counterexample,
not a demonstrated ECMAScript execution defect. GI-REMOTE-MODULE is an absent
remote integration capability, not a defect in the legacy harness contract.
GI-HOST-IDENTITY was an invalid native-reference oracle and is qualified by
the explicit copied error-data contract. No runtime repair was made. See
`results.md` for revisions, exact failure/control programs, runtimes and receipts.

## Current candidate independent review

Execute the unchanged opt-in campaign on available Node 18/20/22/24 hosts.
Invoke the maintained Vitest CLI with each exact Node executable, record its
Node/ICU versions, and retain JSON results and logs under a fresh evidence
directory. A legacy patch is not the exact minimum 18.18.0 cell. Node 26,
the exact minimum, Bun and Workerd remain unverified unless actually executed;
Vitest runner support is separate from product runtime support.

On CI22 execute maintained source-authority, realm rollback, eval-budget,
runtime budget, resource-completion, eval-source-validation, eval-syntax-position,
CLI source-module and CLI diagnostic tests as independent controls. These cover
denied imports, cancelled host work cleanup, realm accounting rollback, rejected
eval budgets and snapshot input, completion ordering and CLI/SDK admission.
Do not interpret their success as repairing either pending-disposal probe.
Run scoped ESLint and the maintained selected workspace build closure. Run the
three pinned upstream selections above with unchanged deadlines. Inspect terminal
counts and every nonpass separately. No CLI implementation is modified in this
review; screenshot QA is required if a later repair changes visible behavior.
