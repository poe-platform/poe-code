# Test performance work, 2026-09-21

Requested window: two hours, starting 13:17 UTC. Preserve all existing tests and their resource/cancellation assertions.

1. Commit the pending DOCX fixes, tests, plans and audit evidence explicitly.
2. Measure the full DOCX suite and its expensive files using the existing workspace command.
3. Add exact workspace selection to the maintained root unit runner. Preserve uncached execution, declared dependency builds, native npm hooks, environment scoping and cleanup. Keep the default complete suite.
4. Add change-based selection only when the graph can conservatively retain affected consumers and shared infrastructure falls back to the complete suite.
5. Reduce real scheduler overhead without replacing document parsing, archive validation or event-loop cooperation with mocks. Validate cancellation and portable host behavior.
6. Run maintained tests and lint, compare equivalent DOCX cases, document commands and measurements, and commit each atomic improvement.

Initial evidence: the unit argument parser rejects `--workspace`; its plan schedules every declared workspace even with a DOCX path filter. The five pending regression files pass 472 tests in 47.59 seconds, with 75.07 seconds of summed file execution at two workers. ZIP reads/writes call a zero-delay timer for every member and payload chunk.

Pending work committed: `505193e84`, `42e9d0ab8`, `537b96b8a`, `19df50be2`.

## Scope selection

`npm test -- --workspace=docx` now selects only the declared DOCX task. Repeat exact workspace names, or select root with `--workspace=.`. `--changed-since=<ref>` compares staged/tracked working-tree content and untracked files against a verified commit, retains reverse declared dependency consumers, and falls back to all tasks for shared or unknown inputs. `--dry-run` reports planned tasks without claiming passes. Shared runs preserve selected phases and avoid root discovery when root is not selected.

Validation so far: 324 runner tests including native lifecycle/process checks; 62 focused scope/shared/scanner tests; 284 lint guard checks, plus the maintained root posttest stress checks. The default complete suite is unchanged.

## Cooperative scheduler

ZIP and document work now use a real Node immediate turn rather than a minimum-delay timer. Portable hosts retain the timer fallback. All work thresholds, accounting, cancellation checks and codec validation remain in place.

Equivalent five-file benchmark: 472 passes before and after; 47.59s wall / 75.07s summed file time before, 13.25s wall / 18.50s summed file time after. Approximately 72% less wall time. Runs were not isolated from other host processes; use this as a representative local comparison, not a CI guarantee. No cases removed and no timeout changes.

Scheduler/ZIP/compression/budget validation: 81 passes. Portable browser bundle validation: two passes. DOCX dependency build: five declared builds, uncached. Package lint and root type/workflow lint pass.

## Findings from broader validation

- Root ESLint stopped at its finite 16,000-subject ceiling (`subject cap`), not an ESLint rule error. A failing guard test reproduced the inability to admit 16,001 subjects. The new ceiling is 24,000; byte/metadata/entry limits and caller-lowered limits remain unchanged.
- The complete run reproduced 48 outdated canonical field assertions: compatibility-wrapped native PAGE fields were expected to reject edits, although those carriers are already admitted by current code. Tests now exercise successful edits and retain assertions for inactive INCLUDETEXT branches, wrapper spelling, unchanged non-dirty parts and input bytes. Inert fields still reject. Shells are disposed at test completion. The 320-case canonical matrix passes.
- One 5-second test timeout occurred during overlapping full runs/builds. Duplicate full DOCX work was stopped. The final complete suite runs alone; no test timeout was increased.

## Shared helper scope follow-up

An isolated root script test edit now schedules root only. Package test helper/fixture changes fall back to all tasks, because tests may import helpers across package ownership boundaries. The prior committed selector returned only root + DOCX for `packages/docx/tests/fixtures/text.ts`; a replay of the prior pure selector reproduced that result. Focused scope/scanner/routing checks pass 28 tests, plus root posttest stress.

## Fresh DOCX public artifacts

`packages/docx/tests/public-shell.test.ts` starts a child process that imports built public packages outside source aliases. Before this follow-up, exact DOCX selection planned no builds. A failing real-repository graph test reproduced the missing DOCX build. `docx#test:unit` now declares its own build prerequisite, retaining the existing portable safe-fs dependency event and five-stage build closure. Scope/build/shared checks pass 72 tests plus root posttest stress.

## Exact files

Native DOCX commands include `packages/docx`; adding a file as another positional filter still selects the whole package because Vitest combines those filters as alternatives. `--test-file=<repository-relative-path>` now selects exact owned files through the maintained shared route. One exact workspace is required; native hooks/custom pools/extra native arguments are rejected before builds rather than bypassed. Every requested file must belong to the selected unit task. Default and change-based runs remain complete within their selected tasks.

The built public consumer ran as one selected file after five fresh dependency builds and passed in 1.27 seconds (the child checks ten public cases). The equivalent 472 regression cases are also being exercised through the new maintained root route.

## Generated output lint

The second full root lint completed its traversal of 16,928 configured files; all 223 rule errors came from generated audit scripts under root `output`, primarily unused probe imports. The generated output directory now shares the global exclusion used for `out`, `dist` and screenshots. Audit artifacts are preserved. The third maintained root lint completes with exit 0 across 16,169 configured/linted files, zero errors and 19 warnings; no rules were disabled.

## Independent assertion checksums

A 100-read benchmark of a 256 KiB stored member reproduced 758.66 ms of assertion work in the independent bitwise CRC witness. DOCX assertions now use Node's independent native zlib checksum when provided (Node 22.2+), retaining the original bitwise witness on older hosts. No production checksum implementation is reused; framing, payload sizes, every checksum and corrupt payload rejection remain checked. A red host-path test verified the missed native witness; native/fallback check-vector and existing corruption checks pass 25 tests. The equivalent benchmark takes 5.16 ms after the change. This microbenchmark measures the assertion helper, not an additional 99% whole-suite gain. Package lint and both production/test type checks pass with six existing warnings.

## Signed native priority transport checks

The ongoing complete run reproduced the older command test rejecting priority -4. Current native setters deliberately admit the signed 32-bit interval (see b0e3cdb53), and existing native admission checks already preserve negative priorities. The command test now checks SDK/CLI parity for -4, both inclusive signed limits and both immediately outside limits, retaining null, zero, positive and fractional controls. All nine cases pass through the maintained exact-file route; no production semantics were changed.

## Exact-file preflight

A failing memfs routing case showed that missing or clearly foreign exact files could still launch build/test children. The root runner now checks regular-file existence and declared workspace selector boundaries before builds, while Vitest retains the final actual-discovery ownership check. Four focused runner files pass 258 cases plus two root stress checks; changed runner ESLint passes. Native hooks/pools are still rejected before spawning, and root ownership remains derived from maintained Vitest configuration.

## Relationship fixture lifetime

The relationship MCE fixture created a Shell for all 2,808 model/SDK/Shell cases and never disposed it. Shell creation is now lazy, so only the 936 actual Shell cases create one; afterEach drains every created Shell even after a failed assertion. All 2,808 cases still pass with actual Shell execution. Local wall time is 51.64s before / 45.76s after (48.24s / 41.19s test time); concurrent host work limits precision. Full DOCX lint and production/test type checks pass with six existing warnings.

The grouped-beforeAll default-style trial preserved all 3,744 cases but did not improve measured wall time; its authored change was discarded. Fixture serialization is being optimized directly instead, preserving test names and independent executions.

## One-pass fixture serialization

Native DOTX input construction previously wrote a DOCX archive, independently read it, patched its main content type and wrote a second archive. Text fixtures now accept the main package kind and member timestamp up front. Native story fixtures and the 3,744-case default-style matrix use one archive write, preserving previous member order, content types and timestamps. Two red kind tests reproduced the ignored requested template type; eight fixture checks plus 23 independent assertion checks pass. Four fixed pre-change SHA-256 hashes prove exact native template archive identity across strict/transitional and document/header owners. Full DOCX lint/type checks pass.

An interleaved 1,000-fixture comparison in one process, alternating order, confirms identical archives and reports prior/direct times (ms): 1913.63/907.10, 1358.12/766.04, 1223.69/626.01. This removes roughly half the fixture-preparation cost, with no operation-result or task cache. A separate first-run comparison was noisy (920/925 ms) and is not used to claim a gain.

## Remaining Office timer delays

PPTX's stored-archive wrapper still delayed each CRC chunk with a timer even after the shared ZIP runtime improvement. Capability discovery likewise delayed every member and each 256 inspected nodes. Both use the shared cooperative scheduler now. Three red tests reproduced three stored-chunk timers, two capability timers and the lack of the shared cancellation hook. All 51 focused checks pass, including an independent 1,025-byte stored payload witness, real event-loop interleaving and abort identity during 300-node inspection. Existing byte/accounting thresholds and inspection output remain unchanged; portable fallback is covered by the shared runtime tests. Selected PPTX lint/type checks validate this change.

## Final validation discipline

The second broad run exposed one old signed-priority assertion and one child import during a focused DOCX rebuild (controls.js was being rewritten). It also observed three newly added PPTX red tests against its already-loaded old source. The focused signed-priority and scheduler checks pass after their respective changes. That mixed live-edit run was stopped; final validation starts from committed code with no overlapping artifact rebuilds. No timeout was raised, and no complete-suite pass is claimed for the interrupted runs.

## Mandatory posttest guard overhead

The root posttest cap-exhaustion control spent 9.9s repeatedly looking up the same unchanged memfs root/parent metadata. Only inside that fixed cap loop, metadata responses are now mocked from the initialized memfs state and restored in finally. The real input guard still performs and charges all eight million metadata operations, rejects the next operation, preserves diagnostics and receipt checks, and initializes fresh state afterward. The separate 16,384-member traversal still uses real memfs and reports the exact same 1,209,401 operations and open/close accounting. Both controls pass: cap control 3.94s, complete stress file 13.20s instead of a representative 21.14s before (host contention applies). No hooks, cases or budget assertions are skipped. Focused stress-source ESLint passes.

## Deep native children without timer overrides

Three deep DOCX child scripts previously replaced all global zero-delay timers with immediates. They now exercise the real production scheduler. Four deep suites also import Shell modules only inside their actual CLI branch; a Node import probe measured 346 ms for the unused Shell import. SDK/model paths continue executing the real DOCX public package with identical deep inputs, budgets and byte-preservation checks. The first 144-case diagnostic under overlapping work reproduced one 5s edit timeout and its dependent missing-candidate assertion. With unused Shell imports removed and artifact rebuilds stopped, all 144 cases pass in 66.52s wall time without raising timeouts. This diagnostic used the maintained shared entrypoint against completed public builds; the final complete npm test remains the acceptance route. Focused ESLint passes.

## Live test inputs under documentation

A source audit found SafeJS tests importing docs/plans/qualify-realms-and-recovery/legacy-v8.json and related JSON data. A red pure scope test reproduced those edits selecting no tasks because the selector ignored every docs path. Only Markdown documentation is ignored now; non-Markdown docs inputs conservatively retain the full maintained plan, including fixtures, binary inputs and executable harnesses. Three scope/routing files pass 32 cases and focused ESLint passes. The full runner was stopped shortly after startup to incorporate this final correctness fix; code is frozen for the fresh complete acceptance run.

## Declared native DOCX integration consumers

The final graph review reproduced a missing native consumer: Bash integration tests import DOCX source directly, but virtual-bash did not declare docx as a test dependency. An actual-repository assertion failed because a DOCX source change scheduled only root and DOCX. Bash now declares docx as a development dependency, with the matching lockfile entry. Source edits retain Bash and its transitive test consumers; isolated DOCX test edits still omit unrelated native suites. The actual-repository regression and workspace-selection checks pass 26 cases, followed by both mandatory root stress controls; focused ESLint passes.

The ongoing complete acceptance run had already built the same 24 packages with the same events. A graph assertion confirms that its completed order satisfies every current declared dependency, including DOCX before Bash. No source or compiled artifacts changed during that run. The new regression was separately exercised through the maintained exact-file root route, so its pass does not depend on whether the already-running broad worker had loaded its test module.
