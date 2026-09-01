# Node diagnostic attribution investigation

Date: September 1, 2026. Worktree: `/tmp/poe-test-speed-push-20260901`.
Scope: the reporter, its focused tests, this document, and the six explicitly
approved caller files listed below. No other caller edits, Git commands, lint
invocations, concurrency changes, or frozen-benchmark-checkout writes.

## Reproduced cause

The supplied `/tmp/poe-release-64a24f9c-job.log` prints the successful virtual-bash
summary at lines 1963–1970, then scenario/fixture diagnostics starting at 1971.
One concrete caller is `tests/integration/s3-http-exports/exports.test.ts`, which
imports `archive-controls.test.mjs`; the latter registers tests and emits the
scenario diagnostics.

Real Node 22.23.2 reproduces this with an entry module importing a helper module:

- The helper's `context.diagnostic()` event includes the helper's absolute
  `file`, `line`, `column`, `nesting`, and `level: "info"`. The file was not missing.
- The successful per-file `test:summary` names the entry module, not the helper.
- The reporter therefore keeps the helper buffer until stream completion and
  prints it after the aggregate summary, matching the CI output pattern.

The tests use real isolated Node test children with in-memory module hooks.
No fixture files are written. The parent harness is supplied through stdin:
using `--eval` caused Node's child runner to re-execute that harness instead of
the fixture, so the tests explicitly avoid that false reproduction.

## Reporter correction: preserve every diagnostic

A proposed aggregate-success filter matched diagnostics to successful test
locations. It removed the dumps, but a real Node counterexample invalidated it:
`test(..., { only: true }, ...)` without `--test-only` emits a genuine warning
with `level: "info"` and exactly the same metadata as that test's context dump.
Only the message differs. Matching a passed test, an entry-file boundary, or a
green aggregate cannot establish that the diagnostic is merely verbose output.

That filter was removed. Review correctly identified that the same counterexample
also invalidates the inherited suppression of direct-file info diagnostics.
The reporter now preserves **every** `test:diagnostic` event when a successful
file summary discards its stdout/stderr. It does not inspect severity or message
text. This replaces the earlier, insufficient non-info-only preservation fix.

Unattributed diagnostics and unresolved helper buffers also remain visible,
including on green runs. Failed-file buffering, complete output and stream
order, unfinished output, CLI reporter options, and destinations remain unchanged.
Only successful stdout/stderr are suppressed. The separate CI fixture-noise
issue requires caller changes; it must not be solved by hiding diagnostics.

TDD on Node 22.23.2 reproduced three failures before the correction: the real
direct-file only-option warning, severity-independent diagnostic preservation,
and passing/nested informational diagnostic preservation. Quiet-output controls
use explicit console/stdout/stderr fixture output rather than diagnostics.

## Completed caller conversion (separate change)

After the parent confirmed Cicero's handoff and authorized all three callers,
converted exactly eight identified verbose scenario/fixture emissions from
`context.diagnostic(serializedFixture)` to `console.log(serializedFixture)`.
Payload expressions, assertions, error handling, and cleanup are unchanged.
Removed only the eight now-unused test callback context parameters; the archive
module loader's unrelated context parameter remains untouched. No diagnostic
messages were classified, no success-only branch was added, and no callers
outside that initial approval were edited. Keep this caller conversion separate
from the reporter diagnostic-preservation correction when committing. The later
four-site extension below belongs to the same caller-noise improvement and brings
the total to twelve fixture sites across six caller files.

Real Node tests verify that stdout from an imported helper is attributed to the
entry file. The existing reporter suppresses that explicit fixture stream when
the entry succeeds and preserves it when another test in the entry fails.
This supplies the missing ownership without classifying arbitrary diagnostic
text or hiding a passing sibling's evidence in a failed file. Explicit Node
reporter selection still exposes the normal stdout stream.

## Approved caller inventory from the supplied green log

All 47 JSON diagnostic lines in `/tmp/poe-release-64a24f9c-job.log` are accounted
for below. These are eight emission sites in three caller files; line numbers
describe the inspected working files and must be rechecked after handoff.
The eight formerly diagnostic sites are now explicit fixture stdout. No caller
changes are part of the separate reporter correction.

### Archive controls: six sites, 21 log records

File: `packages/safe-bash/tests/integration/s3-http-exports/archive-controls.test.mjs`.
Handoff: Cicero relinquished the file; the parent authorized this caller edit.
Entry: `packages/safe-bash/tests/integration/s3-http-exports/exports.test.ts:9`.

| Caller line | CI log lines | Records | Exact fixture payload/category |
| --- | --- | --- | --- |
| 851 | 1971–1972 | 2 | `mode`, `launcherSha256`, `status`, `startupRan`, `verifierRan`; baseline and poisoned-environment controls |
| 1013 | 1973 | 1 | `files`, `catFileProcesses`, `rawPath`; tab/Unicode path inventory control |
| 1069 | 1974–1977 | 4 | `defect`, `admittedBlobReads`, `forbiddenCompilerBodyReads`, `candidateExecution`; missing/drift/symlink/legacy-command refusals |
| 1085 | 1978 | 1 | `defect`, `treeBytes`, `alias`; held-path case-alias fixture |
| 1139 | 1979–1982 | 4 | `defect`, `admittedBlobReads`, `forbiddenObjectIdentities`, `forbiddenReads`; positive/source-symlink/guard-symlink/held-alias controls |
| 1314 | 1983–1991 | 9 | `scenario`, `verifierHash`, `status`, `error`, `rootAliasPayloadReads`, `steps`; deliberate archive-continuity failures |

The nine last-row scenarios are copied bytes; packed membership; packed public
root declaration; packed public HTTP declaration; installed membership;
post-runtime membership; post-types membership; installed parent before initial
reads; and installed parent before runtime. Their `status: "fail"` and error
stacks describe expected negative fixtures: the next assertion requires that
status, and further assertions verify the refusal. They are not runner warnings
or failing test results. Preserve those assertions and error payloads.

### Pattern cancellation: one site, two log records

File/site: `packages/safe-bash/tests/shell-stress/current-gaps/pattern.test.ts:15`.
CI log lines 1992–1993 are the matcher and shell runs at input length 65536.
Payload: `before`, `after`, `status`, `signal`, optional `error`, `stdout`,
`stderr`. The surrounding assertions require stable source identity, no spawn
error/signal, exit zero, empty stderr, and an allowed outcome. This is explicit
fixture observation output, not a Node diagnostic warning. The supplied log
alone does not establish why this direct TypeScript site's buffer remained
unmatched; its emitter is identified from the exact payload and fixture modes.

### Remote cancellation: one helper site, 24 log records

File/site: `packages/safe-bash/tests/stress/remote-cancellation/helpers.ts:75`,
inside `audit()`. CI log lines 1994–2017 are S01–S12 followed by D01–D12,
registered in `packages/safe-bash/tests/stress/remote-cancellation/remote-cancellation.test.ts`.
Payload: `name`, `verdict`, `durationMs`, `pipelines`, `events`; every observed
record has `verdict: "PASS"`. The emission also executes on failures; `audit()`
rethrows collected assertion/cleanup errors afterward. Convert the fixture
emission unconditionally if approved, not only the PASS branch, so failed-file
stdout retains the complete audit trace. Do not alter error collection,
cleanup, rethrows, or semantic warnings.

Completed scope: only these eight fixture emission expressions, with payloads
intact, plus removal of their unused callback context parameters. The existing
remote-cancellation formatter was verified against actual TAP output after
conversion. No additional diagnostics are authorized for conversion merely
because they are informational or JSON-shaped.

## Direct-file diagnostics: inventory before the four-site extension

Before the later four-site approval, a read-only TypeScript AST scan of the
maintained `discoverTests()` inventory
found 611 selected entry files, 41 containing diagnostic calls, and 101 call
sites after the approved conversion. These are static sites, not executed
record counts or guarantees of green-run output. Optional profiles and shared
registration helpers require separate consideration. Of those sites, 58 in 26
files directly call `JSON.stringify`; this is an inventory label, not a proposed
runtime classifier or permission to convert them.

Before that approval, two then-untouched actual suites were run through both
the corrected reporter and an
in-memory historical reporter variant differing only in successful-summary
diagnostic handling. No historical source was written to disk:

- `tests/commands/archive-stress/long-link-regression.test.ts:38`: 1/1 passed;
  one newly visible 4,759-character raw-archive record containing archive,
  PAX payload and link-header base64 plus raw header hex. Reporter output grew
  from 115 to 4,879 bytes.
- `tests/commands/tree/work-budget.test.ts:44` and `:101`: 7/7 passed; two newly
  visible work/allocation measurements totaling 265 diagnostic characters.
  Reporter output grew from 115 to 390 bytes.

This historical JSON-call inventory was not fully runtime-qualified. Only the
long-link and tree-work sites in this table, plus the EVIDENCE site in the next
table, received the subsequent four-site approval recorded below. Every other
listed site remains **not approved for edits**. Author-source line numbers come
from AST positions, not tsx's sometimes collapsed runtime call locations.

| File relative to `packages/safe-bash` | Diagnostic call lines |
| --- | --- |
| `tests/commands/archive-stress/hardlink-identity.test.ts` | 48, 73, 94 |
| `tests/commands/archive-stress/limits-effects.test.ts` | 64, 114, 134, 187, 304 |
| `tests/commands/archive-stress/long-link-regression.test.ts` | 38 |
| `tests/commands/diff-patch-stress/absolute-target/absolute-target.test.ts` | 125 |
| `tests/commands/diff-patch-stress/editflows/parity.test.ts` | 11 |
| `tests/commands/metadata-stress/provenance.test.ts` | 36 |
| `tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts` | 156 |
| `tests/commands/tree/sort-text-bound.test.ts` | 45, 62, 74, 81, 100 |
| `tests/commands/tree/work-budget.test.ts` | 44, 101 |
| `tests/fs/conformance/shared.test.ts` | 10 |
| `tests/fs/mount/identity-compatibility-review/compatibility.test.ts` | 117, 178, 263, 291 |
| `tests/fs/mount/identity-compatibility-review/traversal-authority.test.ts` | 95, 126, 140, 172, 219, 257 |
| `tests/fs/overlay/allocation.test.ts` | 281 |
| `tests/fs/real/allocation.test.ts` | 67 |
| `tests/fs/webdav/binding-violations.test.ts` | 40, 65 |
| `tests/integrations/safejs/canonical-filesystem.test.ts` | 44 |
| `tests/shell-stress/differential.test.ts` | 11, 21, 33 |
| `tests/shell-stress/input-boundary-holdout/compatibility.test.ts` | 43 |
| `tests/shell-stress/invocation-modes/holdout.test.ts` | 34, 73 |
| `tests/shell-stress/targeted-holdout/compatibility.test.ts` | 15, 24 |
| `tests/shell-stress/targeted-holdout/lifecycle.test.ts` | 15 |
| `tests/shell/invocation-cleanup-public.test.ts` | 49, 146 |
| `tests/shell/remote-close.test.ts` | 50 |
| `tests/stress/remote-cancellation/handoff-supplement.test.ts` | 130 |
| `tests/stress/s3-policy/bounded-races.test.ts` | 16, 40, 64, 106, 119 |
| `tests/stress/s3-policy/rename.test.ts` | 123, 134, 146, 284 |

The remaining 43 calls across 17 files do not directly call `JSON.stringify`
as their argument. This is not a claim that their output cannot contain JSON:
some interpolate JSON or encode it as base64. Two files occur in both tables,
so the union remains 41 files and 101 sites.

| File relative to `packages/safe-bash` | Other diagnostic call lines |
| --- | --- |
| `tests/commands/diff-patch-stress/fuzz/budgets.test.ts` | 14, 30 |
| `tests/commands/diff-patch-stress/fuzz/edits.test.ts` | 27, 51, 124 |
| `tests/commands/diff-patch-stress/fuzz/properties.test.ts` | 51, 52 |
| `tests/commands/file/native.test.ts` | 29 |
| `tests/commands/filesystem-authority-stress/native-parity.test.ts` | 21 |
| `tests/commands/safejs-stress/upstream-limitations.test.ts` | 31, 75 |
| `tests/commands/safejs/local-safejs.test.ts` | 43, 154 |
| `tests/fs/conformance/shared.test.ts` | 107, 270, 299, 316, 331 |
| `tests/fs/real/timestamps.test.ts` | 31 |
| `tests/integration/adapter-tools-diagnostics/eight-cases.test.ts` | 151 |
| `tests/integration/adapter-tools/matrix.test.ts` | 39, 271, 302, 327 |
| `tests/shell-stress/differential.test.ts` | 9 |
| `tests/shell-stress/invocation-closure/holdout.test.ts` | 32, 51 |
| `tests/stress/adapters/core.test.ts` | 17, 22, 46, 50, 63, 72, 79 |
| `tests/stress/adapters/policy.test.ts` | 13, 16, 42, 72, 96 |
| `tests/stress/adapters/s3.test.ts` | 111 |
| `tests/stress/adapters/webdav.test.ts` | 32, 41, 211 |

That read-only triage identified `adapter-tools-diagnostics/eight-cases.test.ts:151`
as an additional potentially bulky `EVIDENCE` base64-encoded fixture record;
the diff-patch fuzz suites emit textual matrix/fuzz/ordering summaries.
By contrast, `adapter-tools/matrix.test.ts:39` and `:327` emit caught errors
before failing assertions and are not successful-run noise. Its `:271` and
`:302` calls report successful cleanup-control counts. At that checkpoint none
was edited; the later approval converts only the EVIDENCE site in this group.

Explicit CAPABILITY GAP, DIRECTORY POLICY, POLICY DIVERGENCE, historical host
atime caveats and upstream limitation messages are semantic diagnostics to
retain. Any further fixture conversion requires individual review and additional
parent scope approval; neither table authorizes bulk replacement.

## Validation

Focused command: `node --test packages/safe-bash/scripts/test-reporting.test.mjs`.
The prior 23-test run passed on Node 22.23.2 and Node 22.22.2 but did not protect
direct-file info warnings. The corrected suite adds that real-Node regression.
Corrected result: 24/24 pass on both versions. The real warning regression was
red before the change; the default reporter CLI smoke run also passes 24/24.
The suite covers real imported/nested diagnostics, helper sharing across entry
files, runtime test failures, late-activity warnings, the only-option metadata
collision, direct-file info warnings alongside quiet successful console streams,
and the caller-stdout alternative. Synthetic controls retain
unattributed/unfinished output, every diagnostic severity, complete
failure content/order, and all existing reporter CLI overrides.

### Approved caller validation on Node 22.23.2

- Full `archive-controls.test.mjs`: 175/175 passed, no skips, summary-only output
  through the actual reporter CLI; 93.2 seconds.
- Actual `current-gaps/pattern.test.ts`: 2/2 passed. Captured two complete JSON
  stdout records attributed to the entry file; neither appears in concise output.
- Actual `remote-cancellation.test.ts`: 24/24 passed. Captured 24 complete JSON
  stdout records attributed to the entry file; none appears in concise output.
- Existing audit formatter with explicit `--test-reporter=tap`: 24 PASS records,
  zero formatter errors, proving the optional formatter route still works.
- Reporter focused tests after caller conversion: 24/24 passed through its CLI.

In-memory Node entry modules exercised actual changed callers plus deliberate
failures, without altering any caller assertions. The archive copied-bytes
control retained its entire JSON payload, including the expected negative
fixture's error stack, when a separate injected test failed. Both actual pattern
records survived the same trailing-failure control. The actual audit helper
retained a successful sibling's full trace and the failing audit's full FAIL
trace, plus its original thrown error. These controls intentionally have one
failed test each; the outer verification asserted those failures and exited zero.

The first TypeScript event-capture probe inherited `--input-type=module` into
tsx's child entry resolution and failed before running tests. Repeating from
plain stdin with dynamic imports corrected the probe; this was not counted as
a successful suite run. All reported passing outcomes use the corrected route.

### Post-rebase confirmation: parent-announced `9d4a054ed`

After the parent resumed work following its rebase/push, revalidated the
preserved working-tree changes on Node 22.23.2. No Git commands were used to
inspect or modify HEAD; the revision label is the parent's supplied identity.

| Check | Result | Observed duration |
| --- | --- | --- |
| Reporter focused suite through its CLI | 24 passed, 0 failed/skipped | 1.14 s |
| Actual pattern suite through reporter CLI | 2 passed, 0 failed/skipped | 2.32 s |
| Actual remote-cancellation suite through reporter CLI | 24 passed, 0 failed/skipped | 0.87 s |
| Full archive-controls suite through reporter CLI | 175 passed, 0 failed/skipped | 87.29 s |

All four successful runs printed summaries without the approved fixture dumps.
Re-ran all three actual-caller failure-retention controls: the archive record
including its error stack, both pattern records, and both PASS/FAIL audit
records remained complete. Each control produced exactly its one deliberately
injected/expected failure; each outer verification exited zero. Re-ran the
explicit TAP/formatter path: 24 PASS records, zero formatter errors.

The read-only source census remains 611 selected entries, 41 files and 101
diagnostic sites: 58 direct-JSON sites in 26 files and 43 other-argument sites
in 17 files, with two files shared between those groups. Re-ran both untouched
direct-file before/after probes: long-link 1/1 passed and exposed the same
4,759-character record; tree-work 7/7 passed and exposed the same two records
totaling 265 characters. At that checkpoint no further caller conversion had
been authorized. The subsequent limited approval is documented below.

That resumed validation pass changed only this documentation, not the preserved
reporter,
focused tests or caller implementation. No active measurement processes remain.

## Approved four-site extension

The parent subsequently approved exactly four further fixture emissions in
three files. Converted only these calls to `console.log`, removing their unused
test callback context parameters while leaving every payload expression,
assertion, failure collection, semantic diagnostic and cleanup unchanged:

| Caller file relative to `packages/safe-bash` | Sites | Unchanged payload |
| --- | --- | --- |
| `tests/commands/archive-stress/long-link-regression.test.ts` | 38 | Raw archive/base64/header bytes and archive digest |
| `tests/commands/tree/work-budget.test.ts` | 44, 101 | Work-step and row-allocation measurements |
| `tests/integration/adapter-tools-diagnostics/eight-cases.test.ts` | 151 | `EVIDENCE` plus the complete base64-encoded JSON record, including failures |

### Red/green and actual suite validation

Before editing, all three actual suites passed but the quiet-output assertion
failed: one archive record, two measurement records and eight evidence records
were emitted as diagnostics. After editing, Node 22.23.2 runs pass 1/1, 7/7 and
8/8 respectively. All eleven complete records are now attributed to their entry
files as stdout and are absent from successful concise output. No test is
skipped. The existing reporter focused suite also passes 24/24, including its
real direct-file info-warning regression.

In-memory entry modules importing each actual changed suite and adding one
deliberate trailing failure retain all one/two/eight records in original order,
with no duplication or truncation. These are expected failure controls, not
passing product-test claims; the outer verification checks exactly one failure.

A separate isolated runtime fault throws once from `Shell.prototype.exec`
while running the actual `readonly:append:EROFS` case, restoring the method at
test teardown. The original caller collects the error and emits a complete
base64 record with `status: "FAIL"` and one failed check. The concise reporter
retains that whole record, the injected error message, and the original final
`AssertionError`. No caller assertion or persistent product source was modified
for this control.

### Explicit TAP compatibility

- The actual archive suite still produces the `# {"kind":` line consumed by
  `long-link-evidence/capture.mjs`. Its one parsed raw-archive record retains
  base64 bytes matching the recorded SHA-256 and its full 512-byte link header.
- The tree suite's explicit TAP output contains both complete parseable JSON
  measurement records. No separate active tree-record parser was found in the
  inspected tree test directory.
- The adapter suite was run with the existing `register.mjs` worktree loader,
  `DIAGNOSTIC_REVISION=worktree`, and explicit TAP. The exact `# EVIDENCE `
  extraction/base64-decoding logic used by its `run.mjs` consumer yields all
  eight PASS records with empty failure arrays.

Historical capture drivers were not executed: they write evidence and/or use
Git outside this assignment. This validates the current-output parsing
contracts, not regeneration of their historical snapshots or revisions.

### Historical hook limitation and final scope

The optional existing `DIAGNOSTIC_MUTATION=append-untyped` hook was attempted
as an additional failure control. It rejects current source at its own
`revision-loader.mjs:47` admission assertion (`1 !== 2`), before the test body
can emit evidence. It therefore does not qualify failure-payload retention.
That out-of-scope hook was not edited; the independent runtime-fault control
above supplies the actual FAIL-evidence validation instead.

After these four conversions, the maintained read-only census is 611 selected
entry files, 38 files containing 97 diagnostic sites: 55 direct-JSON sites in
24 files and 42 other-argument sites in 16 files. The two groups overlap in two
files. All remaining sites, including CAPABILITY GAP, POLICY divergence,
upstream limitations and error diagnostics, remain untouched and visible.
No implementation outside these three newly approved files changed in this
extension; this document records the additional evidence. Parent handles Git
and hooks; no Git commands, lint, concurrency or frozen-checkout changes were
performed.
