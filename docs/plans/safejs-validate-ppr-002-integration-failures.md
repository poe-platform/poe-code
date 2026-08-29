# Independent PPR-002 ordered integration failure adjudication

Date: August 29, 2026. Delegated independent validator, not author.

## Frozen scope

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-public-promise-recovery-integrated`.
- Provisional manifest SHA-256:
  `532adf40516da33ba2a66f04298e472e1f6ae42fcd90d04573c0f11fd7f32d22`.
- Manifest base: `32caeaddbac72bccea1cb3fd0a07fb293a1bee71`; no Git command is used.
- Verified all 67 manifest-listed files and all 12 working PPR-002 postimages.
- NUM → AW → OBJ2 → CBI → provisional AR are prerequisites, separate from PPR-002.
  PPR-001 is absent. At intake Nash's AR approval was pending; subsequent status
  and the independently frozen AR manifest are recorded below. No racing source
  tree is read.
- Bootstrap the original inventory's 38 exclusions and deny all `security/` before
  considering original payloads. This review uses only locally frozen approved
  captured sources; no original payload read, excluded read/hash/execution, audit
  recursive scan or security research is necessary.

## Procedure

1. Preserve and reproduce all sixteen failures with existing tests unchanged.
2. Run the same tests against the exact ordered pre-PPR-002 production preimages
   through a validation-only in-memory module loader, without changing files,
   historical fixtures, snapshot markers or assertions.
3. Add independent package tests for fresh writer semantics, all affected graph/
   workflow continuations, genuine historical v6 replay and cleanup behavior.
   Use native observations, memfs, bounded pure mocks, and observed outcomes only.
4. Separate shared PromiseReplay ALS temporary exits from run-local host-context
   disposal using receiver identity and call-through instrumentation. Verify
   actual context lifetime, not just a relaxed global counter.
5. Return exact minimal author repair recommendations; preserve all old failures,
   v6 assertions and original raw-v6 TypeErrors. Do not modify production or any
   existing author/validator tests. Candidate stays HOLD pending author repair,
   complete applicable gates and prerequisite publication clearance.

## Decision: adjudication complete; candidate HOLD

All sixteen reported failures reproduce independently. They are **fifteen stale
fresh-writer version assertions and one overbroad native ALS instrumentation
assertion**, not demonstrated production regressions. This is not permission to
ignore failing tests: the existing tests remain unchanged and the provisional
candidate still fails its combined gate. Planck should make only the specific
test repairs below, freeze a new candidate, and request fresh independent review.
No production repair is recommended by this adjudication.

### Exact failure matrix and minimal author repair

The line numbers refer to the unchanged frozen test bytes.

| Existing assertion                                               |                                                                                 Failing instances | Independent behavior check                                                                                                                                                                          | Minimal repair                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/safejs/src/external-checkpoint.test.ts:58`             |                                                                  2: re-issue and read-side-effect | Both pending continuations return `{first:20,final:13}`; completed lookup is not repeated; boundary reissues once or consumes one observed receipt, respectively; completed replay has zero effects | Change this fresh-capture literal only, `jobs-v6` → `jobs-v7`                |
| `packages/safejs/src/external-checkpoint-validation.test.ts:423` |                                         5: reduction, callback, retry-reissue, retry-external, co | All five exact captured sources match complete native values and host traces with the same pending gate schedule; all public/signal/completed continuations and subsequent recaptures pass          | Change this fresh-capture literal only, `jobs-v6` → `jobs-v7`                |
| `packages/safejs/src/external-checkpoint-validation.test.ts:672` |                                                                                     1: CLI SIGINT | Memfs SIGINT returns 130 while the host call remains held; the actual saved checkpoint resumes to 13 with exactly one boundary call                                                                 | Change this fresh-capture literal only, `jobs-v6` → `jobs-v7`                |
| `packages/safejs/src/snapshot/obj-002-validation.test.ts:39`     | 7: full alias graph; hole lengths 0/2/9; undefined/null/holes; named cycles; independent captures | All seven strict graph/shape checks pass after current dump serialization and public restoration; interpreter and legacy fixture tests remain unchanged                                             | Change this fresh-envelope literal only, `jobs-v6` → `jobs-v7`               |
| `packages/safejs/src/external-checkpoint.test.ts:21`             |                                                                    1: successful awaited callback | One actual run-local host-context disposal, plus four temporary disables of the distinct shared PromiseReplay context; retained callback async resource cannot recover a disposed store             | Scope the exact-one assertion to non-PromiseReplay receivers, as shown below |

For the final row, import `promiseReplayContext` from
`./interp/promise-replay.js` and replace only the global counter assertion with:

```ts
expect(disable.mock.contexts.filter((context) => context !== promiseReplayContext)).toHaveLength(1);
```

Keep the existing call-through spy, `finally` restoration, success and parse-error
cases. Do not replace `disable`, suppress its calls, change the count to five or
“at least one”, or remove runtime cleanup. The additional package tests here
identify the actual callback's ALS receiver, prove its store is true both before
and after an await, assert that very receiver is disabled exactly once, and use
an `AsyncResource` created inside the callback to prove its store is unavailable
after disposal. Both successful and throwing callbacks pass, as does parse
failure. Keep these stronger lifecycle checks in subsequent validation.

Do not globally replace `jobs-v6`, accept either marker for fresh captures, alter
saved fixtures, or rewrite a snapshot to make it replay. In particular, preserve
all fourteen tests in `run.promise-compatibility.test.ts`, all genuine v6 fixture
bytes, every historical TypeError assertion, and OBJ2's legacy inline/items cases.
The five original workflow tests previously stopped at their first public-snapshot
marker assertion; their signal/completed branches were not certified by merely
reading the failure messages. This review executes those branches independently.

### Contract and native rationale

- `packages/safejs/src/snapshot/dump-format.ts:2` defines the current fresh writer
  as `jobs-v7`. Each failing version assertion constructs a new checkpoint with
  that writer; none reads a genuine historical v6 snapshot.
- `packages/safejs/src/run.ts:199` selects v6 only for an accepted v6 snapshot;
  `run.ts:202` preserves the original v6 conversion context and uses native
  `promiseReplayContext.exit(convert)` for v7 initial inputs. New captures must
  advertise their changed scheduling mode; old traces must keep their old mode.
- `packages/safejs/src/restore.ts:46` validates before input conversion and accepts
  both the current mode and genuine v6. Unsupported formats retain their guard.
  The compatibility addendum in `docs/plans/safejs-fix-ppr-002.md:265` supersedes
  its preserved earlier blanket-v6-refusal proposal. Fresh v7 success alone would
  not justify rejecting previously working v6 histories.
- `packages/safejs/src/run.ts:519` unconditionally disposes the run-local host
  context in `finally`. `packages/safejs/src/interp/host-bridge.ts:271` enters that
  separate context for real host callbacks. The shared PromiseReplay context is
  declared in `packages/safejs/src/interp/promise-replay.ts:346`.
- Observed directly on Node **v22.22.2**, native `AsyncLocalStorage.exit()` calls
  `this.disable()`, executes the callback with no current store, then re-enables
  the context in `finally`. The exact native method source is preserved in
  `native-als-implementation.json`; an independent native test verifies temporary
  hiding and restoration of the same store. These temporary disables are not
  leaked or multiply-disposed run-local host contexts.

### Independent executions

All artifact paths in this section are relative to
`out/safejs-ppr2-integration-adjudication/`. Commands run from this clone with
`env -u TERM`; no Git command is used.

| Execution                                                         | Result                                                             | Evidence                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Three exact unchanged affected suites on ordered pre-PPR2 runtime | **37 pass**                                                        | `unchanged-ordered.log`                                                             |
| Same exact suites on provisional PPR2                             | **21 pass / 16 fail**                                              | `unchanged-candidate.log`                                                           |
| Author's exact 34-file combined command, independently rerun      | **894 pass / 16 fail**, exit 1                                     | `broad-candidate.log`, `broad-candidate.stderr.log`, `broad-candidate-command.json` |
| Existing PPR2 recovery + compatibility suites, unchanged          | **24 pass**                                                        | `ppr2-candidate-focused.log`                                                        |
| Additional independent checks on ordered runtime                  | **59 pass**                                                        | `independent-ordered-final-exact.log`                                               |
| Additional independent checks on provisional PPR2                 | **59 pass**                                                        | `independent-candidate-final.log`                                                   |
| Bounded completed-input RED selection on ordered runtime          | **2 pass / 3 fail / 5 unselected**                                 | `raw-input-ordered-bounded-red.log`                                                 |
| Full existing recovery suite on ordered runtime                   | **6 pass / 4 fail**, including one 10-second pending-input timeout | `raw-input-ordered-red.log`                                                         |

The 59 additional cases comprise 15 affected continuation/graph checks, four ALS
checks, four exact ordered raw-v6 historical failure cases, and 36 preserved v6
generation records. The latter re-execute all 36 emitted checkpoints plus nine
interrupted checkpoints, including failure replay, with unchanged serialized
initial-input/replay/PromiseReplay metadata and v6 emissions. The unchanged
14-case compatibility suite separately retains its six genuine original
saved/completed controls and repeated dump/restore generations.

The ordered RED selection proves the actual prerequisite defect remains without
PPR2: arguments, importMeta, and the full original raw-input scan fail with
`TypeError: Promise replay references work not created at this position.` Bindings
and imports pass. The full RED run's separate pending-input timeout is preserved,
not reclassified as one of the sixteen integration failures and not hidden by
the bounded selection. Candidate recovery tests all pass; no timeout assertion
or runtime behavior was edited.

The four frozen ordered raw-v6 saved/completed snapshots are accepted by restore
but still raise the same exact original TypeError, with no boundary/provider call
and unchanged input bytes and marker. They are not retroactively repaired and
do not become blanket version refusals. The earlier author's eight historical
raw-v6 observations and eight fresh-process v7 restores remain in the original
frozen evidence; those separate child-process cohorts were not rerun for this
targeted adjudication. This is not final composite-core certification, a new
PPR1 alias-parity claim, or a pending-proof-stall resolution.

### Test construction and preserved unsuccessful attempts

- New tests are under `packages/safejs/test/`, not planning docs. The validation
  Vitest config loads the exact hash-checked ordered preimages of `run.ts`,
  `restore.ts`, `snapshot/dump-format.ts`, and `snapshot/migration.ts` in memory
  only when `SAFEJS_PPR2_ADJUDICATION_PHASE=ordered`. Candidate mode uses unchanged
  working sources. No existing test text, historical marker or production file
  is replaced, even temporarily.
- `test/fixtures/ppr2-integration-workflows.ts` contains the same five literal
  sources and bounded fixtures from the existing approved AR validator; it does
  not read the audit. All new unit-test file writes use memfs; native observations
  and call-through spies do not contact an LLM or other provider.
- First independent probe: **17 pass / 2 fail**, preserved in
  `independent-candidate-first.log`. The native retry fixture was inadvertently
  ungated while the comparison expected the captured gated execution, changing
  the order of the final `b`/`c` trace entries. The native runner now uses the same
  real pending gate and release schedule. Full-value and complete-trace assertions
  remain; nothing is sorted, omitted, normalized or relaxed. The corrected run
  passes all 19 continuation/lifecycle cases in both runtime modes.
- First new-test typecheck failed on an unnarrowed scope union, ES2023-only
  `findLastIndex` under ES2022, and an untyped spy receiver. Its diagnostics remain
  in `new-test-types-first.log`. Fixes are confined to this validator's new code:
  explicit missing-binding rejection, ES2022 `map(...).lastIndexOf(true)`, and an
  actual `instanceof AsyncLocalStorage` guard. Runtime assertions are not weakened.

### Configured gates and limits

- Root `npm run lint:types`, SafeJS `tsc -p packages/safejs/tsconfig.json --noEmit`,
  and explicit four-new-file typechecking with configured ES2022/NodeNext/strict
  options pass. Root production types exclude tests, so the latter is separate.
- Root-config ESLint on all four new TypeScript files passes. Configured Prettier
  checks those files and this Markdown report. Logs and command records are
  preserved with the validation evidence.
- Production and existing test bytes are unchanged. The independently reproduced
  broad suite is intentionally still RED. This test-only adjudication does not
  rebuild or reapprove the entire repository; the frozen author build evidence
  remains available. No new visual CLI behavior or screenshot claim is made.

### Prerequisite update and outstanding publication gates

After intake, root reported Nash's AR independent READY with no production repair.
The final AR manifest was read only after that notification and its exact SHA-256
verified: `2df0a5d3adb477933055dcabd9988e6aa25f5893f3965f771dc47719b947d1d7`.
Its frozen production hashes are checked against this clone's ordered inputs;
no code is imported and its independent report remains separate from AR's ten
delta paths. The original provisional PPR2 manifest and its earlier AR-pending
metadata remain untouched as historical evidence.

Root subsequently clarified that the 13 AW hard-break trailing spaces are a
**current** `git diff --check` exit-2 gate, not merely historical warnings. This
review independently confirms the current document still has SHA-256
`5492f3ccca999e952d8484a861e079be0f4bc3bf9a2eb2b32062a236efce4df5` and the 13
two-space line endings. No Git command was run here. The separate eight AW
format passes do not waive that gate. Ptolemy owns the isolated document-only
repair; this clone has not imported it. Refresh that prerequisite document only
after its independent review, preserving this frozen failure capture.

Required next steps: Planck applies the five strictly scoped test-site repairs;
root accepts the separately reviewed AW document repair and prerequisite report;
then a newly frozen PPR2 candidate receives fresh focused, combined,
compatibility, types/lint/format and applicable publication-gate review. **No
publication approval is granted here.**

### Final preservation

Final rehash confirms all 67 frozen manifest-listed files, all 12 working PPR2
postimages, all three existing affected test files, and all 44 prerequisite paths
are unchanged. All ten finalized AR delta hashes match either this clone's
unchanged path or its exact ordered preimage where PPR2 composes the file. All
five copied AR guest-source strings are byte-exact. `final-integrity.json` records
these checks; `archive-read-guard.json` records the 38 exclusions plus `security/`
and zero original payload reads. No prerequisite document refresh was applied.

Validation-only files and logs are sealed separately under
`out/safejs-ppr2-integration-adjudication/validation/manifest.json`; its status is
adjudication complete / candidate HOLD, not a publishable production candidate.
