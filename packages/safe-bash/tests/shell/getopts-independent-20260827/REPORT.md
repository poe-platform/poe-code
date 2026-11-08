# Independent private getopts Phase 1 review — August 27, 2026

## Result

Scoped review complete; **no confirmed candidate implementation defect found**.
The original frozen gate is **not all green**: P03 contains a reviewer oracle
error. Preserve its failure rather than claiming 238/238. Authenticated native
followups agree with the candidate; separately corrected cursor controls pass.
This is private scanner acceptance evidence, NOT a usable getopts builtin.

Candidate: `157d78c957b56f83f6e705fc35da60b1f2ea3a9b`.
Independent freeze: `7a47dcdba6175a4eccc9dad16c3ac9733cf0e0bf`; all eight files remain
byte-identical to that commit. Freeze was post-source-commit but before independent
implementation inspection/execution. No recursive delegation occurred.

## Exact denominators

| Cohort | Actual result | Accounting |
| --- | --- | --- |
| Frozen semantic controls | **85/85 projections**, all31 sequences | Source and moved JS, each run twice |
| Frozen policy controls | **152/153 materialized rows**;31/32 named controls green | Same four runs; sole failure P03/reset-clones |
| Combined original runtime rows | **237/238**, one failure | Per mode/per run; not952 distinct tests |
| Original strict probe classification | **27/28** per mode | T20 runner classification error; compiler correctly rejected it |
| Corrected strict classification | **28/28** per mode | Two positives +26 negatives, unchanged frozen probe code |
| Frozen Bash5.3 holdouts | **12/12 scripts;71/71 records** | Primary Darwin profile, exact stdout/stderr |
| Frozen Bash3.2 holdouts | **12/12 scripts;71/71 records** | Separate historical Darwin comparison |
| Source-copy mutants | **16/16 killed** | Loaded successfully; baseline-passing assertion witnesses only |
| Supplemental cursor assumptions | **1/3 scenarios** | F01/F03 assumptions fail on BOTH native profiles and both candidate modes |
| Supplemental actual transcript agreement | **3/3 scenarios;6/6 records per profile** | Each native profile agrees with both candidate modes; reanalysis, not new native runs |
| Corrected supplemental cursor controls | **3/3 per mode** | R01–R03, post-inspection; do not replace frozen P03 |

Policy rows can contain several boundary assertions;153 is the materialized row
count, not a claim of153 distinct native cases. Runtime repetitions and source vs
compiled transport are not new unique controls. All32 policy groups executed.
Original32 controls include limits/admission/byte widths, state isolation, error
modes, malformed controls, task yielding, falsy cancellation, late rejection and
listener cleanup. Original captures and all failed expectations remain intact.

## Findings and corrections

**P03: reviewer oracle defect, not candidate bug.** Minimal reproducer: scan p
from `['-pqr']`, clone the returned state, apply `withGetoptsIndex(state,2)`, scan
the same one-element vector. Frozen P03 expected q. Candidate returns EOF,
status1/option?/OPTIND2/unset argument. Both authenticated Bash versions return
exactly that. Candidate source `src/shell/getopts.ts:191` checks an out-of-range
index before continuing an active cursor; lines187–193 clear the cursor at EOF.
Immutable source is `capture-01/candidate-scanner.ts.data:191`.

Adding an unused second operand keeps index2 in range and returns q in both
candidate and native profiles. Shortening the vector restores EOF. The primitive
still retains/copies the cursor (`src/shell/getopts.ts:66`); that does not override
the later scanner EOF boundary. The historical report already described positive
out-of-range EOF. This reviewer overgeneralized the retained-cluster rule.
No product fix is proposed. The API prose could clarify that boundary; author
documentation is outside this worker's ownership. See `CORRECTIONS-v3.md` and
the complete native/source transition captures.

**T20: test-harness defect.** The first checker omitted TypeScript diagnostic2740
from its accepted diagnostic codes. Actual source and emitted declarations both
rejected the malformed AbortSignal object for the intended reason. Version2
accepts2740 only for T20 with an AbortSignal-shape message; all28 probes rerun
successfully. No suppressed diagnostics, casts or skipLibCheck were used.

**Mutation attribution correction.** M03's already-failing P03 row cannot establish
a kill. The separate baseline audit excludes it and retains new S12 failures.
All16 mutants still have baseline-pass/new-fail witnesses. Each mutant has its
exact source patch, original/mutant hash, successful load check and raw assertion
output. There are no load/compiler/outer-process timeout failures counted as kills.
M13's in-harness pending-cancellation watchdog failures are intended liveness
assertions. One concrete variant per frozen target was run, not every possible
mutation in each target's family. See `capture-followup-02/mutation-baseline-audit.json`.

## Identity, isolation and scope

- Scanner SHA256: `bf0bcfd9f370861504e9561c54cfd12c8706663ee7dc3ca8a28b70f66290e9ee`.
- Emitted JS SHA256: `e6c92f625e233c1a6994580cba6832e21bc2f397191f7d6476325c99b867bbe0`.
- Emitted declaration SHA256: `25f6cef9448d16e85ba1df757fde407da5aa22df5785d4ccf4f0ae56ac58546a`.
- Actual candidate package metadata SHA256: `691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535`.

The full private module was inspected. It has zero imports and no host IO,
process, stdin, VFS, environment or variable-binding operations. Its only injected
host work is checkpoint/signal handling. Cardinality is checked before per-slot
work (lines159–168), strings are bounded before each code-unit charge/byte count
(lines141–154), and the128-entry table is allocated only after input validation
(lines174–175). These source checks plus P14/P17/P20 support bounded admission;
they are not RSS measurements or a CPU-time/host-sandbox guarantee.

Actual committed source/package inputs were exported by Git into an isolated,
task-owned archive. Because the scanner has no imports, that is its complete
implementation closure. `candidate-tree.txt` separately inventories the entire
candidate's tracked files. This is not extraction/typechecking of the whole
product or every tracked consumer. No live product source entered the runs.

Source mode loaded the exact archived `.ts` file via tsx with cache disabled.
The candidate built with strict NodeNext/ES2023 and emitted declarations. A package
using unchanged `virtual-bash` metadata was physically moved to a separate
consumer root. Its internal emitted module loaded by explicit file URL in a
fresh Node process without tsx; loader logs show no source fallback. Other package
exports were neither built nor certified. Before/after manifests compare complete
membership, directories, symlinks and bytes, including added entries.

Tooling: Node22.22.2, TypeScript5.9.3, installed tsx4.23.12. Entry/compiler hashes,
actual TypeScript input inventories and module-resolution logs are retained.
The tsx package version was read locally after execution; loader entry hashes were
recorded before execution. No claim of a fully sealed external tooling install.

## Native profiles

Primary: Bash5.3.0(1)-release, Darwin, binary SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Historical: Bash3.2.57(1)-release, Darwin, SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Both binaries were available and authenticated. Captures retain versions/platform,
explicit C-locale environments, literal argv, closed stdin, exact Base64 stdout/
stderr, status/signal, deadlines and settled-child records. No Linux claim.
Each profile ran12 frozen scripts plus3 separately labeled source-informed
followups; the additional six records do not enter the frozen71 denominator.

## Preservation, chronology and limits

All original/followup captures are immutable and independently manifested.
Source archives, moved-package entries and all freeze files matched after runs.
Ownership-checked ephemeral scratch was removed; no `.test.ts`, `.ts` or `.mts`
review inputs remain in discovery. Captured source/native data are explicitly
`.data`, tar or JSON—not canonical tests. Children were awaited; cancellation
tests checked late rejection observation and invocation listener cleanup.
Opaque host work is not forcibly stopped and completed effects are not undone.

Foreign work/staging was never reset, stashed, broad-staged or committed. Foreign
concurrent commits/edits are not a claim of whole-live-tree immutability. A foreign
Git index.lock blocked the attempted pre-execution v2 commit; it was left alone.
Therefore v2 followup execution honestly precedes its driver commit, unlike v1
and v3. All commits use explicit owned paths and `--only`, with hooks disabled to
avoid unintended candidate/shared-test execution during commits.

Driver commits: v1 `904620b96563192696cd63ffdd9a0877bc5d2db7`; v2
`d8e8a0bf3c50e5aade747625537c9c9ddd9142b8`; v3
`6108e727f901a1fa8d36c12a01eb719fa0bac5eb`. The containing final evidence commit
binds this report and manifests; no circular self-hash is asserted.

Author claims remain separate:134/134 distinct tests run twice, prior76 scanner
projections from17 native scripts, and124 retained original observations. Author
tests were not rerun, and their history was not rewritten. No default test count
increase, whole-product gate, provider/service acceptance or superiority claim.

**Stage2 WITHHELD:** no usable builtin, registration, variable writes, readonly
bypass/attribute removal, assignment-origin hooks, local/function/subshell
restoration or shared-budget wiring. Runtime/shell integration remains Sagan's
ownership. Stronger readonly policy and ASCII-only options remain mandatory;
Unicode argument values work within this private profile. No full getopts/native
parity or72-hour work-duration completion is claimed.
