# Remaining fixture audit output

## Scope and decision

September 1, 2026 follow-up to the reporter improvement delivered as 0611abf45
(parent-reported rebased commit). The earlier evidence remains in
`node-diagnostic-attribution.md`; this change does not modify the reporter.

Reviewed the remaining 97 diagnostic sites in 38 inventoried callers. Select
23 unconditional fixture/measurement emission sites in six files, rather than
treating JSON as evidence that an arbitrary diagnostic is safe to silence.
Only the emission method changes to `console.log`; remove the now-unused test
context parameter in five files. The handoff wrapper still passes its context
to the callback. Preserve every payload expression, assertion, test name,
option, ordering, cleanup path and thrown error.

Paths below are relative to `packages/safe-bash`:

| Caller | Lines | Reviewed payload and reason |
| --- | --- | --- |
| `tests/commands/archive-stress/hardlink-identity.test.ts` | 48, 73, 94 | Archive hashes, identity/alias checks and expected refusal/sentinel receipts. Unsupported-hardlink assertions and stderr payload remain intact. |
| `tests/commands/archive-stress/limits-effects.test.ts` | 64, 114, 134, 187, 304 | Boundary vectors, gzip expansion, partial effects and blocked-source/cleanup measurements. Deliberate negative controls are successful assertions, not operational warnings. |
| `tests/commands/tree/sort-text-bound.test.ts` | 45, 62, 74, 81, 100 | Work/scan/comparison measurements and expected budget-refusal results, including full stderr. |
| `tests/stress/s3-policy/bounded-races.test.ts` | 16, 40, 64, 106, 119 | Full mock mutation/state receipts for success, writer-preservation races and expected bounded refusals. |
| `tests/stress/s3-policy/rename.test.ts` | 123, 134, 146, 284 | Capability-preflight and race fixture states; ENOTSUP/EAGAIN and no-clobber assertions remain intact. |
| `tests/stress/remote-cancellation/handoff-supplement.test.ts` | 130 | Unconditional PASS/FAIL audit record with all events, operations and signal state. Keep VERIFIER_ASSERTION stderr, cleanup failure events and AggregateError. |

No changes to production, historical evidence, reporter behavior, CLI options,
concurrency or excluded callers. No Git, raw lint or frozen-checkout operations.

## Consumer review

- S3 policy `verify.mjs` parses TAP summary counts and `not ok` names and keeps
  complete stdout/stderr. It does not consume diagnostic events.
- Remote `handoff-verify.mjs` parses `# {"name":` lines with
  `JSON.parse(line.slice(2))`, retains raw output and counts TAP summaries.
  `format.mjs` has a related TAP JSON unescape/parser contract. Check both with
  actual new output, not a synthetic replacement for the supplement.
- Archive bounds/final/PAX capture drivers and the public filesystem-inspection
  verifier select these suites and retain TAP transcripts/counts/test names.
  Historical revision/hash admission remains intentionally unchanged; updated
  live test bytes do not qualify a pinned historical capture.
- The separate SafeJS-current NDJSON reporter accepts stdout, stderr and
  diagnostics, and its cohorts do not select these six callers. No reviewed
  selected consumer requires the `test:diagnostic` event type specifically.
- Do not run historical capture drivers: they use Git, pinned-source loading
  and/or write evidence. Exercise their relevant extraction contracts directly
  on current explicit-TAP output, without updating historical hashes.

## Red baseline

Real Node 22.23.2 with `--import tsx`, one selected entry per run, before edits:

| Suite | Passed | Fixture records | Payload bytes |
| --- | ---: | ---: | ---: |
| Hardlink identity | 3 | 6 | 1,300 |
| Archive limits/effects | 5 | 16 | 3,627 |
| Tree sort/text bounds | 12 | 5 | 601 |
| S3 bounded races | 44 | 34 | 8,964 |
| S3 rename | 42 | 8 | 730 |
| Remote handoff supplement | 10 | 10 | 8,854 |
| Total | 116 | 79 | 24,076 |

All cases passed without skips. Each actual suite failed the quiet assertion:
its fixture diagnostic payloads were present in the current reporter output.
All selected events had direct source-file attribution on this Node run. This
is expected reporter behavior now that genuine info diagnostics are preserved,
not permission to suppress that event class again.

## Completed validation

All runs below use Node 22.23.2. Selected suites ran one entry per invocation;
no test concurrency setting changed.

- Full-source equality against the in-memory pre-edit source passes with only
  23 callee substitutions and 22 unused callback-parameter removals. Every other
  byte is unchanged, including other workers' existing tests. The tree suite
  has 12 actual cases, not just its five changed measurement sites.
- Actual post-change suites pass 116/116, with no skipped, cancelled or TODO
  cases. All 79 records are now file-attributed stdout, with no remaining
  fixture diagnostics in these six entries. All six quiet-output assertions
  pass. The explicit concise-reporter CLI also passes 116/116, emits only
  115–117 bytes per entry in that run and has empty stderr.
- Baseline/post-change receipts compare equal, normalizing only the handoff
  elapsed times and freshly generated lock UUIDs between separate executions.
  The emitted payloads themselves are not normalized, shortened or redacted.
- Explicit TAP CLI runs pass the same 116 cases and retain all 79 complete
  records. TAP unescaping recovers the full baseline-equivalent JSON, including
  quoted S3 ETags and embedded stderr newlines. TAP summary extraction used by
  S3 consumers succeeds. Both the exact handoff-verify JSON-line extraction
  and existing `format.mjs` parser recover all ten PASS records; formatter
  errors are empty.
- Six virtual entry modules import the actual suites, then register one
  deliberate trailing failure. Each has precisely the original passing cases
  plus one expected failure. All 79 raw stdout records survive exactly once,
  in order, with the injected error visible. These are successful retention
  controls, not claims that the deliberately failing test suites pass.
- A separate in-memory runtime fault changes the first WebDAV stat cancellation
  code from ECANCELED to EIO in an isolated child. The actual handoff suite
  reports V01 FAIL and nine passes. All ten records survive, including the
  full V01 assertion event, request/signal data and `fixture.remaining-locks:0`.
  VERIFIER_ASSERTION stderr and the original aggregate failure remain visible.
  Running the same control with the original handoff emitter supplied through
  an in-memory loader gives equal FAIL payloads (elapsed time excepted) and
  byte-identical stderr. Both TAP streams decode the complete failure evidence.
- Existing focused reporter tests pass 24/24, including real direct-file
  `only`-option info warnings, imported diagnostics, runtime/unfinished output,
  failed-file streams and explicit reporter CLI options. Reporter files remain
  untouched by this follow-up.

Reproducible focused CLI commands, from `packages/safe-bash`, with the Node
22.23.2 binary on PATH:

```sh
node --test scripts/test-reporting.test.mjs
node --import tsx --test --test-reporter=./scripts/test-reporting.mjs <selected-caller>
node --import tsx --test --test-reporter=tap <selected-caller>
```

The red/green event capture uses `node:test.run` with the actual selected entry
and `execArgv: ["--import", "tsx"]`, then the existing concise reporter.
Failure controls use `registerHooks` data-URL preload modules for virtual entry
sources; no test fixture, runtime patch or historical transcript is written to
disk. Baseline sources, events and captures remain in memory only.

## Unchanged inventory disposition

This bounded batch leaves 74 of the original sites across 32 files unchanged.
A read-only AST recount of those inventoried files confirms that subtraction;
this is not a new repository-wide discovery or runtime census.

- Leave every diff-patch-family caller alone, including diff-patch-stress, to
  avoid the other owner's area. Do not touch settled compression/current-shell
  changes. Fuzz/matrix payloads there are not included in this batch.
- Preserve conformance CAPABILITY GAP and DIRECTORY POLICY diagnostics,
  adapter policy/divergence messages, native MIME/allocation/atime caveats,
  SafeJS limitations and qualified external-runtime/profile notices.
- Preserve failure-only `adapter-tools/matrix.test.ts` diagnostics at lines
  39 and 327. Do not convert caught operational/assertion failures to quiet
  success output. Its small cleanup-count receipts also stay unchanged.
- Defer metadata/filesystem-authority provenance, jq review evidence,
  mount identity/traversal receipts, WebDAV binding observations, shell native
  differential/holdout/invocation/cleanup receipts and remaining adapter sites.
  These have provenance, host/profile or semantic context beyond the selected
  unconditional receipts; this batch makes no blanket conversion claim.

Per-file disposition of the 74 unchanged sites (paths relative to
`packages/safe-bash`, original source line numbers):

| Caller | Lines | Disposition |
| --- | --- | --- |
| `tests/commands/diff-patch-stress/absolute-target/absolute-target.test.ts` | 125 | Other-owner family; untouched. |
| `tests/commands/diff-patch-stress/editflows/parity.test.ts` | 11 | Other-owner family; untouched. |
| `tests/commands/diff-patch-stress/fuzz/budgets.test.ts` | 14, 30 | Matrix/elapsed receipts; other-owner family. |
| `tests/commands/diff-patch-stress/fuzz/edits.test.ts` | 27, 51, 124 | Fuzz/order/shell receipts; other-owner family. |
| `tests/commands/diff-patch-stress/fuzz/properties.test.ts` | 51, 52 | Fuzz/failure index; other-owner family. |
| `tests/commands/metadata-stress/provenance.test.ts` | 36 | Source admission and current-vs-immutable provenance caveat. |
| `tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts` | 156 | Defer historical migration/comparison receipt. |
| `tests/commands/file/native.test.ts` | 29 | Native mismatch/semantic-profile caveat, not full passes. |
| `tests/commands/filesystem-authority-stress/native-parity.test.ts` | 21 | Frozen-evidence provenance hash. |
| `tests/commands/safejs-stress/upstream-limitations.test.ts` | 31, 75 | Current-vs-historical engine behavior/limitations. |
| `tests/commands/safejs/local-safejs.test.ts` | 43, 154 | Local engine provenance and historical-constructor caveat. |
| `tests/fs/conformance/shared.test.ts` | 10, 107, 270, 299, 316, 331 | Source hash, DIRECTORY POLICY and CAPABILITY GAP. |
| `tests/fs/mount/identity-compatibility-review/compatibility.test.ts` | 117, 178, 263, 291 | Defer identity/outcome/authority evidence. |
| `tests/fs/mount/identity-compatibility-review/traversal-authority.test.ts` | 95, 126, 140, 172, 219, 257 | Defer authority/refusal/cancellation evidence. |
| `tests/fs/overlay/allocation.test.ts` | 281 | Host/filesystem allocation and copy-up profile. |
| `tests/fs/real/allocation.test.ts` | 67 | Host/filesystem allocation profile. |
| `tests/fs/real/timestamps.test.ts` | 31 | Host atime persistence explicitly not guaranteed. |
| `tests/fs/webdav/binding-violations.test.ts` | 40, 65 | Untrusted metadata/host-binding violation classifications. |
| `tests/integrations/safejs/canonical-filesystem.test.ts` | 44 | External engine profile and qualification. |
| `tests/integration/adapter-tools/matrix.test.ts` | 39, 271, 302, 327 | Keep failure-only errors at 39/327; small cleanup-count receipts at 271/302 deferred. |
| `tests/shell-stress/differential.test.ts` | 9, 11, 21, 33 | Native/version/source provenance; defer script expected/actual receipt. |
| `tests/shell-stress/input-boundary-holdout/compatibility.test.ts` | 43 | Batch/source/native-reference provenance. |
| `tests/shell-stress/invocation-modes/holdout.test.ts` | 34, 73 | Defer child-process receipts. |
| `tests/shell-stress/invocation-closure/holdout.test.ts` | 32, 51 | Defer child PID/stdout-hex receipts. |
| `tests/shell-stress/targeted-holdout/compatibility.test.ts` | 15, 24 | Batch/native profile and legacy difference provenance. |
| `tests/shell-stress/targeted-holdout/lifecycle.test.ts` | 15 | Defer source/lifecycle result receipt. |
| `tests/shell/invocation-cleanup-public.test.ts` | 49, 146 | Defer cleanup proof and child-process attack receipts. |
| `tests/shell/remote-close.test.ts` | 50 | Defer child-process/timeout/residual audit. |
| `tests/stress/adapters/core.test.ts` | 17, 22, 46, 50, 63, 72, 79 | Path policies, approved S3 profile and capability gaps. |
| `tests/stress/adapters/policy.test.ts` | 13, 16, 42, 72, 96 | Policy/divergence and native-fidelity caveats. |
| `tests/stress/adapters/s3.test.ts` | 111 | Non-atomic guarded rename profile caveat. |
| `tests/stress/adapters/webdav.test.ts` | 32, 41, 211 | Defer small namespace receipt at 32; retain capability gaps. |

Root owns guarded lint, commits and CI. Focused results do not establish a full
workspace or historical qualification pass.
