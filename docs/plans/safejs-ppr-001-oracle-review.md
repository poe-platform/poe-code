# PPR-001 third-party contract and oracle adjudication

Date: August 29, 2026. Delegated third-party reviewer, neither author nor Curie.

## Scope and preservation

Work only in `/Users/kjopek/Workspace/poe-code-safejs-promise-aliases`, base
`4358488f9478bcb3c5a89af4fcd61c3cdfcf037f`. Curie's evidence manifest verifies as
`8c872de8d76b0cd56ede6bd85ce84fd2fb310a6b1e6f6f2ce317cc1203946b46`.
Its 29 listed evidence artifacts and three validator files were verified before
review. Preserve Curie's report, failed test bytes, and every earlier result.
The author candidate and PPR-002 prerequisite remain frozen and separate.

Explicit ownership transfer permits correction of the independent validator test
only after documented contract/oracle proof. No production, README, other-clone,
Git-state or publication changes. No assertion weakening to hide defects. The
1,442 unrelated repository-format warnings are not this task's repair scope.

Before any original payload access, bootstrap exactly 38 exclusions from the
original `inventory-verification.json` and deny the entire security subtree.
Only the two hash-locked ordinary public-promise-recovery sources named in Curie's
report are allowlisted. No recursive original-audit search, excluded bytes,
security probes, LLMs or guest real I/O. Public API probes use bounded processes,
in-memory bundles and snapshots, and pure host mocks.

## Procedure

1. Reproduce the unchanged 91-test validator and identify all fourteen exact IDs.
2. Compare native behavior, exact-base v6, PPR-002-only v7, and frozen candidate;
   inspect public contracts and conversion/replay code, not baseline failure alone.
3. Document proof for each proposed oracle correction before editing. If a real
   defect remains, give a bounded author repair request and prerequisite relation.
4. Retain full values, recorded prefixes and checkpoint immutability; compare
   completed histories exactly and control pending-operation continuation latency.
5. Run bounded corrected validation, configured and new-test types/lint/format,
   and functional regressions with TERM unset. Preserve original failures.
6. Produce the complete fourteen-row adjudication matrix. Freeze publishable delta,
   prerequisite and preimages separately only if the required scoped checks pass.

## Contract anchors under review

- `CHECKPOINT_REPLAY.md` promises replay of recorded history, while still-pending
  operations follow reissue/reconciliation policy; it does not freeze unrecorded
  future host latency.
- `run.ts` sends arguments/import metadata through the generic data converter and
  bindings/imports through the host bridge, then journals input promises.
- `values.ts` accepts the supported data subset and explicitly refuses non-plain
  host-class instances; `values.test.ts` defines that conversion boundary.
- `host-bridge.test.ts` explicitly requires non-Error host rejection metadata to
  be omitted; input promises also traverse the host journal's rejection bridge.
- PPR-001 adds only converter memoization; PPR-002 controls public-input replay
  and v6/v7 semantics. Historical broken raw-v6 snapshots are not repaired by
  changing markers or by pretending baseline restore succeeded.

## Adjudication

### Oracle proof before any validator edit

The unchanged validator independently reproduces **77 passes and the same
fourteen failures**. Twenty additional in-memory diagnostic tests exercise exact
v6 and prerequisite-only v7 through the public API; their 91 filtered existing
tests are not counted as validation passes. All diagnostic observations, including
errors, are retained. No production or validator source was changed for these
observations.

**Six failures demand unrecorded future ordering.** For the fulfilled argument
graph, the saved settlement prefix is `[(1,2),(2,2)]`. Original capture completes
as `[(1,2),(2,2),(4,28),(5,28),(6,28),(3,95)]`; immediate pending-boundary reissue
completes as `[(1,2),(2,2),(6,28),(4,28),(5,28),(3,95)]`. Both preserve all values,
identities, host operations, total steps, registration count, and every settlement;
only unrecorded ordering differs. `CHECKPOINT_REPLAY.md:3` explicitly limits replay
to recorded history and specifies pending-operation reissue. The fixture itself
holds the original boundary until snapshot write but returns immediately on
reissue. A prerequisite-to-prerequisite continuation produces the same divergence;
this is corroboration, not the contractual reason. Correct the oracle to require
the exact saved prefix, exact non-settlement metadata, and all final `(id,step)`
entries, allowing only ordering of the unrecorded suffix. Completed histories
must still replay with their exact complete trace. Restore the newly completed
continuation again to prove its formerly new order becomes immutable history.

**Four failures demand an unsupported host-class data representation.** Entry
arguments and import metadata use `deepCopyToSandbox` (`run.ts:263`, `run.ts:286`).
`values.ts:510` converts Promise rejection reasons using the same data converter;
`values.ts:602` accepts plain objects and its final guard at `values.ts:630`
explicitly rejects unsupported host instances. The conversion contract tests at
`values.test.ts:384` and `values.test.ts:403` require refusal of built-in/non-plain
host objects. Native `Error` is not a plain object. Guest Error constructors and
the host bridge's separate rejection conversion do not extend this generic data
input contract. Consequently the received rejection is a caught TypeError with
the exact message `Unsupported sandbox value at <root>: Error`, not the original
native Error `7`. Its identity is still preserved by PPR-001.

This boundary is independently observed through public `run`, including direct
Error argument/import-metadata refusal with explicit input paths. The simpler
two-reference rejected-Promise cases produce the same exact TypeError/name/message
in v6, prerequisite-only v7 and candidate; reason identity changes from false to
true only with PPR-001. Host bindings/imported rejected Promises instead preserve
Error `7` through `host-bridge.ts:510`, `host-bridge.ts:844`; their native parity
remains required. The corrected graph oracle must explicitly assert both the
complete native expected object and the complete supported boundary outcome,
plus exact TypeError diagnostics, rather than silently replacing native equality
with an arbitrary observed value. `Number(TypeError.message)` is NaN; the existing
child JSON transport records it as null. This is a qualified unsupported-value
case, not a claim that native Error payload parity has been repaired.

An exploratory direct-binding/direct-import Error-as-data probe also refuses at
the initial replay-data codec. It is distinct from rejected-Promise conversion
and is not used to claim direct Error input support. Initial probe quoting and
that overly broad exploratory expectation are retained as reviewer diagnostic
errors, not runtime successes or additional PPR-001 regressions.

**Four failures incorrectly require the buggy prerequisite graph to succeed.**
Both exact-base v6 and prerequisite-only v7 split the same rejected Promise into
five wrappers. Source handles its two direct references, leaving rejected array,
Map and Set wrappers unhandled. They throw `UnhandledRejectionError`; native
execution succeeds. This is a real functional consequence of PPR-001, not an
acceptable baseline failure. The frozen PPR-001 candidate already repairs it:
one shared wrapper, two distinct input journal rows total, all graph aliases true,
one shared reason with visible mutation, successful completion and recovery.
The old oracle's `previous.status === "ok"` is false precisely because the
prerequisite lacks this fix. Correct that prerequisite assertion to require the
specific defect and keep positive candidate/native alias and recovery assertions.
Use the separate successful two-reference diagnostic for normalization comparison.
Non-Error reason metadata is deliberately not part of the host rejection surface:
`run.ts:296` journals input Promises through the host bridge;
`host-bridge.ts:510` wraps non-Errors, and `host-bridge.test.ts:630` explicitly
requires omission of arbitrary metadata. Preserve this limitation rather than
pretending the candidate recovers native `.value` payloads.

These conclusions authorize only corrections to the independent validator test.
They do not change production scope or waive a remaining functional defect.
The full fourteen-row matrix, exact IDs, observations and final gate results will
be recorded after executing the corrected assertions.

### Additional future-position proof before the second test edit

The first correction passes 87/91. Its four remaining failures are reviewer-added
overconstraints, not production regressions: comparing sorted final `(id,step)`
pairs still freezes unrecorded future latency. Rejected graph continuations settle
the reissued boundary at the checkpoint rather than one interpreter step later.
For example, import-metadata capture records boundary ID 6 at step 32, while
immediate reissue records it at step 31; the checkpoint step is 31. All recorded
prefix entries, full values, host history and total registrations remain exact.

`promise-replay.ts:299` drains recorded events against their stored positions;
after that prefix and the checkpoint boundary, `promise-replay.ts:331` records
new ready settlements at **the current step**, not a nonexistent historical
future step. `promise-replay.test.ts:166` specifies the actual restriction: pending
work must not settle before reaching the checkpoint. This source contract proves
that the corrected oracle must permit both unrecorded ordering and unrecorded
positions. It will require the exact recorded prefix, exact non-settlement
metadata, the complete final settlement ID set with no duplicates, monotonically
ordered live positions bounded by checkpoint/final steps, and a further completed
restore with exact full metadata. Thus no lost, duplicated, prematurely replayed,
or subsequently unstable settlement is allowed. The first correction's test bytes,
proof text, complete outputs and four failures are preserved separately.

## Final fourteen-case matrix

**READY for the scoped PPR-001 contract/oracle review; no author repair is required.**
This supersedes Curie's HOLD only for the fourteen adjudicated assertions. Curie's
original report and failure evidence remain untouched. No remaining required
functional assertion is waived because its baseline failed. No product decision
remains unresolved by the inspected source contracts.

Every ID below belongs to
`packages/safejs/test/integration/promise-alias-independent.test.ts`.
Rows 1–10 use suite `input-graph, settlement, and checkpoint aliases`; rows 11–14
use suite `existing non-Error host rejection normalization remains qualified`.
The JSON matrix stores the full file/suite/test ID, original expected/actual,
complete native value, exact-base v6 observation, prerequisite-only v7 observation,
frozen-candidate value, direct current-checkpoint restorations, source anchors and
final verbose PASS line for each row. Historical compatibility observations are
separately labeled; they must not be confused with newly captured candidate state.

Evidence: `out/safejs-remediation/ppr-001-oracle-review/adjudication-matrix.json`.

Codes used only to keep this table readable:

- **S**: wrong expectation of identical _unrecorded future_ schedule. Exact saved
  prefix, complete settlement IDs, bounded monotonic positions, full values and
  exact completed replay remain required.
- **E**: unsupported native Error-class generic input representation. Require the
  documented exact TypeError and shared reason identity, not native Error payload.
- **B**: incorrect assertion that the buggy prerequisite graph succeeds. Its real
  split-wrapper/unhandled-rejection defect is fixed by this frozen candidate.
- **split**: successful capture with graph aliases `[false,false,false,false,true]`,
  `sameResult:false`, `markerVisible:false`; distinct input and scalar values correct.
- **UE**: expanded graph throws `UnhandledRejectionError` because split wrappers
  remain unhandled. Exact reason/name/message are in the matrix; the simpler
  two-reference representation diagnostic succeeds and isolates conversion policy.

| Row | Exact test title                                                                      | v6 / PPR-002-only v7 | Native / frozen candidate and correction                                                       | Final |
| --- | ------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| 1   | `retains graph_arguments_fulfilled/saved with no replacement inputs`                  | split / split        | Native full graph = candidate; S permits only unrecorded future differences.                   | PASS  |
| 2   | `retains graph_arguments_rejected/saved with no replacement inputs`                   | UE / UE              | Native Error payload differs from documented generic refusal; E plus S after masked assertion. | PASS  |
| 3   | `retains graph_arguments_rejected/completed with no replacement inputs`               | UE / UE              | Native Error payload differs from documented generic refusal; E.                               | PASS  |
| 4   | `retains graph_bindings_fulfilled/saved with no replacement inputs`                   | split / split        | Native full graph = candidate; S permits only unrecorded future differences.                   | PASS  |
| 5   | `retains graph_imports_fulfilled/saved with no replacement inputs`                    | split / split        | Native full graph = candidate; S permits only unrecorded future differences.                   | PASS  |
| 6   | `retains graph_bindings_rejected/saved with no replacement inputs`                    | UE / UE              | Native full graph = candidate; S permits only unrecorded future differences.                   | PASS  |
| 7   | `retains graph_imports_rejected/saved with no replacement inputs`                     | UE / UE              | Native full graph = candidate; S permits only unrecorded future differences.                   | PASS  |
| 8   | `retains graph_importMeta_fulfilled/saved with no replacement inputs`                 | split / split        | Native full graph = candidate; S permits only unrecorded future differences.                   | PASS  |
| 9   | `retains graph_importMeta_rejected/saved with no replacement inputs`                  | UE / UE              | Native Error payload differs from documented generic refusal; E plus S after masked assertion. | PASS  |
| 10  | `retains graph_importMeta_rejected/completed with no replacement inputs`              | UE / UE              | Native Error payload differs from documented generic refusal; E.                               | PASS  |
| 11  | `preserves normalization while fixing reason identity for plain_rejection_arguments`  | UE / UE              | Native aliases = candidate; B fixed. Arbitrary rejection metadata intentionally omitted.       | PASS  |
| 12  | `preserves normalization while fixing reason identity for plain_rejection_bindings`   | UE / UE              | Native aliases = candidate; B fixed. Arbitrary rejection metadata intentionally omitted.       | PASS  |
| 13  | `preserves normalization while fixing reason identity for plain_rejection_imports`    | UE / UE              | Native aliases = candidate; B fixed. Arbitrary rejection metadata intentionally omitted.       | PASS  |
| 14  | `preserves normalization while fixing reason identity for plain_rejection_importMeta` | UE / UE              | Native aliases = candidate; B fixed. Arbitrary rejection metadata intentionally omitted.       | PASS  |

### Exact value obligations

For all eight graph placements/outcomes the native full expected/actual object is:

```json
{
  "graph": [true, true, true, true, true],
  "distinctPromise": true,
  "sameResult": true,
  "markerVisible": true,
  "resultGraph": true,
  "value": 7,
  "distinctValue": 11
}
```

The candidate matches that entire object for supported cases. For rejected Error
arguments/import metadata only, the documented converter boundary instead requires
`resultGraph:false` and `value:null` in the child JSON observation; every other
field stays exactly as above. The null encodes source NaN, not a guest null or a
recovered native Error value. Successful two-reference diagnostics require:

```json
{ "same": true, "name": "TypeError", "message": "Unsupported sandbox value at <root>: Error" }
```

Exact v6 and PPR-002-only v7 produce the same name/message with `same:false`.
Bindings/imported rejected Error reasons must preserve native `Error: 7` instead.
The four plain-object rejection cases require the entire native graph object above,
but the candidate intentionally omits `value` (undefined omitted by JSON), while
all six other fields remain equal. The exact baseline graph failure is:

```json
{
  "name": "UnhandledRejectionError",
  "message": "Unhandled rejection: {\"name\":\"Error\",\"message\":\"[object Object]\",\"stack\":\"Error: [object Object]\"}"
}
```

The separate successful normalization probes require
`{name:"Error",message:"[object Object]",same:false}` before PPR-001 and the same
object with `same:true` afterwards. This is a positive test of the actual fix,
not permission to leave a native-supported alias failure unresolved.

### Original lifecycle and version qualifications

`original-workflow-comparison.json` retains **full native expected/actual and all
baseline/prerequisite/candidate values** for the unchanged full source and tiny
argument/binding alias controls, plus all eight direct fresh candidate restores.
No summary projection is substituted for full value equality. In the full original
workflow, candidate and native both return balance 13, the full lexical closure,
all event names and trace, and alias vector `[true,true,true,true]`; baseline and
prerequisite have `[false,false,false,true]` and split input-result identities.
The tiny controls retain value 7 with all handle/alias/mutation checks true after
repair. Each of the eight fresh current-format restores matches every native field.

The final suite also retains the prior compatibility requirements unchanged:

- Six retained working v6 snapshots, eighteen successful replay generations in the
  focused suite; six independently captured v6 histories add eighteen fresh-process
  candidate generations. No marker rewriting.
- Sixteen independent genuinely pre-memoization v7 histories pass twenty-four
  candidate restores, preserving their historical split aliases and branch-dependent
  registration counts. Three supplied historical-v7 fixtures also pass.
- **Eight broken raw-v6 histories still fail** in both their own v6 runtime and the
  candidate with `TypeError: Promise replay references work not created at this position.`
  These are honest negative compatibility checks, not eight successful restores,
  unsupported-version relabeling, or a retroactive v6 repair.
- PPR-002 is required separately for public-input recovery and v6/v7 selection.
  Its eleven paths do not fix Promise alias memoization; PPR-001's six paths do.
  Public API use, in-memory engine construction, no replacement input graphs, and
  finite process/budget controls remain unchanged.

### Executed gates and retained failures

All commands run in this clone. Every terminal gate uses `env -u TERM`; there are
no changed timeouts, skipped tests or source/config weakening. Full command arrays,
stdout, stderr, exit status and timestamps are in the named JSON evidence records.

| Evidence record                          | Command / scope                                                                                                    | Actual result                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `unmodified-curie-red.json`              | `env -u TERM node_modules/.bin/vitest run --config packages/safejs/test/promise-alias-validation.vitest.config.ts` | 77 pass / 14 fail; 190 observations                     |
| `three-engine-contract-probes.json`      | In-memory public-API v6/prerequisite/candidate diagnostic overlay, exact command recorded                          | 20 diagnostic tests pass; 91 filtered tests not counted |
| `corrected-validator-green.json`         | Same validator after first proven correction                                                                       | 87 pass / 4 reviewer-overconstraint failures, preserved |
| `corrected-validator-confirmation.json`  | Same validator after future-position proof                                                                         | 91/91 pass                                              |
| `adjudicated-validator-final.json`       | Same command plus `--reporter=verbose`                                                                             | 91/91 pass; all fourteen exact IDs PASS; 46.71 seconds  |
| `focused-contracts.json`                 | `env -u TERM node_modules/.bin/vitest run` with the three public-recovery, alias and compatibility targets         | 43/43 pass in 3 files                                   |
| `broad-functional.json`                  | Same runner with 21 explicit replay/converter/recovery targets; exact list recorded                                | 547/547 pass in 21 files                                |
| `new-test-types.json`                    | Strict NodeNext no-emit compiler on validator test/config and alias test; all flags recorded                       | PASS                                                    |
| `package-types.json`                     | `env -u TERM node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json`                                      | PASS                                                    |
| `configured-types.json`                  | `env -u TERM npm run lint:types`                                                                                   | PASS                                                    |
| `configured-eslint.json`                 | `env -u TERM npm run lint:eslint -- --max-warnings=0`                                                              | PASS                                                    |
| `configured-package-lint.json`           | `env -u TERM npm run lint:packages`                                                                                | 17 rules / 68 packages PASS                             |
| `public-generic-data-refusal-final.json` | Public run, exact direct Error argument/import-metadata refusal paths and native control                           | PASS                                                    |

Final validator observations: **206 bounded child processes: 54 captures and 152
restores; every provider-call count is zero**. These counts include intentionally
failing historical controls and must not be read as 206 successful executions.
The 43 focused tests overlap the 547 broad tests; do not add them as unique tests.
No full repository test sweep or build is newly claimed here. A full build was not
needed: in-memory source builds, package/root types and configured lint all passed.

Repository formatting remains explicitly non-green. The three full
`env -u TERM npm run format` attempts report 1,445, 1,443 and 1,443 warnings.
All include **the same 1,442 unrelated paths** retained by Curie. The extra paths
were reviewer-created command-record JSON formatting, not production changes.
Those metadata records alone were subsequently formatted, with exact old bytes
preserved as .txt preimages. The last extra was
`configured-format-confirmation.json`. No fourth whole-repository formatter run
is claimed. The first targeted check exposed the subsequently generated
`configured-format-final.json` record using the old writer; that formatting-only
residue and its exact preformat bytes are also retained and corrected. The final targeted check covers every reviewer JSON and changed
validation/report file, confirming that reviewer scope is clean; see
`final-targeted-format-confirmation.json`. The unchanged global 1,442-path failure remains an
out-of-scope repository gate, not evidence that the complete repository is green.

Two exploratory public-data diagnostic errors (quoting, then an overly broad
binding/import expectation) and the first correction's four failures remain in
original command records. Final conclusions rely on successful narrowed probes
and explicit source-contract tests, not those failed explorations.

## Immutable handoff and limits

The ready capture is
`out/safejs-remediation/ppr-001-oracle-review/candidate/manifest.json`.
It records base, SHA-256, byte lengths, exact postimages and original/after-prerequisite
preimages. Content-addressed read-only .txt blobs preserve exact bytes without
reformatting frozen author or prerequisite artifacts.

The manifest separates six unchanged PPR-001 author publishables from eleven
PPR-002 prerequisite paths and from reviewer validation-only artifacts. The latter
include the transferred validator, unchanged config, this report, and preserved
Curie evidence identity; **the archive-dependent validator is not automatically a
portable CI publication target**. No new production delta, private adapter, provider,
version marker, README, or other-clone file is introduced. The original author and
Curie manifests remain hash-identical; original failed test bytes are retained.

**No author repair request remains within these fourteen cases.** READY is bounded
by the documented input-conversion contract and tested histories; it is not universal
native parity, arbitrary external exactly-once semantics, all-version recovery, or
a repository-wide formatting approval. A publisher combining other replay/core
fixes must perform fresh integrated validation against the exact resulting tree.
This capture grants **no publication authorization** and no commit or push occurs.
