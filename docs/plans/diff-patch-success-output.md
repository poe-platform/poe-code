# Diff/patch success output

## Authorized scope and historical boundary

September 2, 2026: change only five maintained callers under
`packages/safe-bash/tests/commands/diff-patch-stress/` and this plan:

- `absolute-target/absolute-target.test.ts`
- `editflows/parity.test.ts`
- `fuzz/budgets.test.ts`
- `fuzz/edits.test.ts`
- `fuzz/properties.test.ts`

The reusable current callers may evolve. The original manifest does not
authenticate the resulting current caller bytes. Before this change, four of
the five already differed from its original hashes; absolute-target still
matched. Do not rewrite historical manifests, drivers, hashes, source copies,
or captured evidence, and do not describe old-revision seals as current
qualification.

Before preparing the change, read-only Git-object verification recovered each
of the five originals at `4d4f5ca2338cc0020dd17bf2d6b3627c6bbeb78f` and checked
its SHA-256 against the manifest at
`c623665b88467eddaa10e253f9df1136158976e0`. The historical and present stored
manifest bytes match SHA-256
`9f33adce0d68795bc0620938e438e2c376cfbed6f2addfa58b4fc599b6034ec1`.

Historical admission drivers explicitly require those original bytes and
remain unchanged. The current canonical discovery does not classify these
five callers as held sources, held evidence, or fixture roots. Inspection of
current package/script/hook/workflow entrypoints found no gate requiring their
exact historical source hashes. If qualification reveals such a current
binding, stop rather than changing its authority or bypassing admission.

## Output policy

Do not change the reporter or add diagnostic filtering. Use its existing
file-attributed stdout handling only for the explicitly identified fixture
success dumps. Preserve every payload, test name, assertion, option, execution
order, cleanup path, and timeout.

- The EngineSession result uses stdout only for `status === "pass"`. Pending,
  unavailable, unsupported, error, timeout, and failed results remain diagnostics.
  In particular, an unavailable just-bash comparator must remain visible and is
  not a pass.
- Edit-flow result JSON uses stdout only for status zero with empty stderr.
  Unexpected status or stderr remains diagnostic before the unchanged assertion.
- MATRIX_REPORT, REPETITION_REPORT, HANDWRITTEN_REPORT, ORDER_REPORT, and
  SHELL_REPORT use stdout. Existing assertions and expected-refusal semantics
  remain intact; later file failures still expose buffered output.
- FUZZ_REPORT and FAILURE_INDEX use stdout only when the accumulated failure
  array is empty. Nonempty failure reports remain diagnostics, followed by the
  unchanged final assertion.

Warnings, errors, genuine diagnostics, pending results, failed-file output, and
interrupted-file output retain the existing reporter behavior. No helper,
runtime, historical driver, comparator installation, or concurrency change is
part of this work.

## Preparation and static red

Preparation baseline: `96259488893eec05813c3545af5f77def0ef0c46`.
The primary checkout remains untouched while its normal push gate runs.
Temporary baseline and candidate sources are under
`/tmp/poe-diff-reporting-prep-20260902/`; these are preparation copies, not an
independent runnable checkout.

Static red confirms nine unconditional diagnostic sites on successful paths
across the five baseline callers. This is an AST-only check, not a substitute
for the required actual-output red. Static candidate validation preserves all
assertion expressions/order, test declarations/options, exact report payload
expressions, and normalized non-reporting code. Conditional diagnostic branches
remain in absolute-target, edit-flow parity, and fuzz properties.

## Completed runtime qualification

After explicit parent clearance, created a detached worktree at
`/tmp/poe-diff-reporting-20260902`, still at the preparation baseline revision.
Dependency entries link to the installed primary dependencies; the existing
safe-bash build was copied into the detached worktree. No dependency installation
or primary source/build mutation occurred. All tracked edits are the five callers
and this plan.

Every actual test process used Node `v22.23.2`, the installed Bash-local tsx
loader, and `--test --test-concurrency=1`. Each selected entry ran in its own
serial process. A temporary reporter recorded native Node events, then delegated
unchanged events to the existing concise reporter. Source/build identity receipts
matched before and after every run. Root precommit lint and short trace-cache
checks could overlap; these are correctness runs, not performance measurements.

### Real-output red and green

| Maintained entry | Original/candidate passing tests | Pure-success records |
| --- | ---: | ---: |
| absolute-target/absolute-target.test.ts | 28 / 28 | 1 |
| editflows/parity.test.ts | 10 / 10 | 7 |
| fuzz/budgets.test.ts | 5 / 5 | 2 |
| fuzz/edits.test.ts | 24 / 24 | 3 |
| fuzz/properties.test.ts | 1 / 1 | 2 |
| Total | 68 / 68 | 15 |

All baseline and candidate tests passed, with zero failed, skipped, or cancelled
tests. Original output exposed all 15 pure-success records, failing the quiet
contract as expected. Candidate events retain those exact records as stdout
attributed to the actual entry file; the concise successful output omits them.
Ordered test names/counts and payloads match. Only the two elapsedMs values and
the EngineSession result durationMs are excluded from payload equality.

The separate real just-bash result remains `pending`, with its exact unavailable
comparator reason visible as a diagnostic. It is not counted as comparator
success. No comparator dependency was installed or result fabricated for the
positive runs. All 83 source assertion expressions remain unchanged.

### Negative controls and explicit TAP

Temporary load-hook controls affected only in-memory entry source; no tracked
helper, runtime, fixture, or source file changed:

- A failing sibling after the real edit-flow cases produced 10 passes and one
  deliberate failure. All seven previously buffered stdout records, the failing
  test name, and the failure sentinel remained visible.
- Injecting unexpected stderr after each real edit-flow execution produced three
  passes and seven deliberate assertion failures. All seven result records
  remained diagnostics rather than successful stdout.
- Changing one fuzz expected status after real execution preserved the complete
  512-case workload and produced one accumulated assertion failure. FUZZ_REPORT
  retained diff-status 511 pass/1 fail; FAILURE_INDEX retained index0/diff-status.
  Both records stayed visible diagnostics before the unchanged final assertion.
- Three comparator-classification controls changed the returned just-bash result
  to unsupported, error, or fail after the real EngineSession call. Each remained
  visible despite its enclosing 28-test file passing. These are classification
  controls, not claims that an installed comparator actually exhibited those
  behaviors.

Actual explicit TAP for fuzz properties passed. The unchanged extraction regex
from `compatibility/run.mjs` recovered FUZZ_REPORT with denominator512, six
512-pass/0-fail phase counts, zero skips, and FAILURE_INDEX `[]`. The historical
driver was neither executed nor modified.

The unchanged reporter control suite passed 24/24, including genuine info
warnings, late activity, failed-file diagnostics/output, and incomplete-summary
retention. No reporter changes or generic diagnostic filtering are involved.

### Types, lint, and qualification corrections

Focused TypeScript checking of the five callers and transitive imports passes
using Bash's installed `@types/node`22.20.1. Scoped ESLint passes with no output;
`git diff --check` passes.

Two temporary qualification-tool mistakes are retained in the evidence rather
than hidden:

- The first candidate test run passed, but its analyzer expected an absolute
  stdout event path. Node supplied a relative entry path. Canonical path
  normalization validated the saved native events; that test was not rerun.
- The first temporary type config incorrectly selected root `@types/node`25.9.4,
  producing TS18046 in unchanged benchmarks/session.ts. A separate config using
  the package's actual Node22 declaration profile passes. No source change or
  weakened type option was used to clear it.

No failed runtime test was retried or silently routed elsewhere. Historical
manifests, drivers, original source objects, and captured evidence remain intact.

## Evidence and handoff

Local artifacts: `/tmp/poe-diff-reporting-evidence-20260902/`.

- `summary.json`: counts, record parity, conditional diagnostics, negative
  controls, explicit TAP extraction, and qualification limitations.
- `baseline-*.events.jsonl`, `candidate-*.events.jsonl`, corresponding `.stdout`,
  `.stderr`, and `.json`: actual Node events/output and source/build receipts.
- `negative-*.events.jsonl` and injection receipts: deliberate failure and
  non-pass classification evidence, retained separately from positive runs.
- `candidate-fuzz-explicit-tap.stdout`, `tap-extraction.json`: actual TAP and
  parsed historical-consumer accounting.
- `reporter-controls.tap`, `types-bash.log`, `lint.log`: supporting checks;
  `types.log` preserves the initial incorrect-root-profile diagnostic.
- `historical-before.json`: original Git/manifest verification and baseline
  caller hashes. Static preparation remains in
  `/tmp/poe-diff-reporting-prep-20260902/static-validation.json`.

This is bounded caller-output qualification, not a full-suite, CI, release, or
runtime-speed claim. Root owns staging, commits, push, and release monitoring.
