# Independent diagnostic acceptance

Accepted bounded fixes on source commits
`22ca649492275aed151193986d6956a95ff7f3f7` (source names) and
`c116d637aa82e4b075460fc07088a5703a10e7b4` (warning coordinates).
READY explicitly relinquished the source lease. Current and committed shell
hashes were checked before and after every phase; all original inputs and
7e9a15d baseline artifacts remain byte-identical.

- Runtime SHA256:
  `f307642e52c3bfeb5df64057fb26af6645135bb5bdc307f399de6ce1541c0ddb`.
- Parser SHA256:
  `f8a76103ccc3e0f981bdb8cf391f48a8864dbf895c39e459d5f5da7b6ec77b0c`.
- Shell/types remain unchanged; no shared contract/API, manifest or dependency
  change belongs to these source fixes. This verifier changed only its owned
  diagnostic-recheck evidence/runner/report files.

## Frozen independent NUL cohort

The same eight fixtures and two globally applied source names ran unchanged.
Both complete native profiles were freshly repeated:32 native controls exactly
match their original frozen bytes/status/effects. They confirm, not replace,
`nul-native-frozen.json`. All16 current virtual observations match the frozen
GNU5.3 primary expectations: **3/16 before →16/16 now**. Bash3.2 remains **0/16**,
because its silent NUL removal differs from the selected modern warning policy.

The original nested two-blank-line repro now warns on line6, not8. One/three
blank-line and prefix-line variants match5/7/8 respectively; the backtick
control stays4. Explicit `diagnostic-nul-script` now appears in its warnings
instead of literal `shell`. Two independent substitutions still warn twice;
multiple NUL bytes within one substitution still warn once. Every changed field
is stderr; stdout bytes, status and namespace effects remain equal to baseline.
No expectation, source string, name input, diagnostic or effect was normalized.

Native OS argv0 defaults to the actual executable path; the final argument to
`-c` supplies shell `$0` (`shell` or `diagnostic-nul-script`). These are recorded
separately. The named profile remains a source label, not a physical script file.
Product uses the same real `bash -c SCRIPT NAME` invocation as the frozen baseline.

## Original OLD9 and complete88 profiles

All352 current virtual tuples across four whole-cohort runs are byte-for-byte
unchanged from baseline. All352 freshly captured native fixture tuples match
their respective original frozen profile/name observations, with zero drift.

| Whole affected cohort | Current TAP | Current raw tuples |
| --- | --- | --- |
| Original helper, Bash3.2, shell-stress |80/89, original OLD9 fail|74/88 exact|
| Uniform GNU5.3 original-helper launch, shell-stress |80/89, same OLD9 fail|74/88 exact|
| Existing GNU5.3 diagnostic profile, shell |89/89|88/88 exact|
| Existing Bash3.2 diagnostic profile, shell |75/89,14 fail|74/88 exact|

The original helpers, tests, fixtures and assertions are unchanged. Modern
original-helper execution substitutes the executable uniformly, never per case.
The original five syntax tests use status/no-effects/nonempty-stderr checks;
their additional raw diagnostic losses stay visible in the88-tuple denominator.
The original nine remain source-name/profile conflicts, including two genuine
historical parse/effect-policy differences, not newly fixed modern defects.

Modern88/88 was ALREADY true at baseline; it is not credited to these two fixes.
The baseline's89-pass/one-after-hook-failure observation is immutable. That
unchanged hook then saw unimported S3 transport drift. This fresh run has no
hook failure or imported/source drift; it is a new observation, not a waiver,
retry or retroactive rewriting of the baseline.

## Separate author and regression evidence

| Cohort | Result | Counting qualification |
| --- | --- | --- |
| Author25, both frozen native profiles |25/25 primary,1/25 historical|One virtual25 capture compared with BOTH whole references; native references reused|
| Author test suite |26/26 TAP|25 overlapping author cases plus ONE bounded child with9 internal assertions, not35 TAP|
| Existing diagnostic/parser/descriptor/input |171/171|Separate affected suite|
| Source/dot/eval and prior diagnostics |134/134|86+48 author checks|
| Independent current-shell |43/43 leaves|44TAP including wrapper|
| Global noEmit |exit0|1080 actual pre-enumerated compiler inputs|
| Build noEmit |exit0|302 actual pre-enumerated inputs; no emitted build|
| Benchmark noEmit |exit0|417 actual pre-enumerated inputs|

The author25 comparison and author test suite overlap; they are not added to
an inflated independent denominator. The bounded child retains command/source/
depth/output limits, binary input/provenance, callback identity, cancellation
and late-rejection controls. Its actual engine file was import-traced. No accepted
Plato budget fixture or broad lifecycle cohort was rerun.

## Source review and guards

`SOURCE_REVIEW.md` records independent inspection of the exact source diff and
locally pinned GNU5.3 parser/printer source. Coordinate metadata is separate
from execution-line coordinates and is keyed to AST object identity. A new AST
from source/eval/child execution cannot inherit an unrelated key's mapping.
Function bodies are copied to retain definition-source identity; positional,
local/export/readonly/depth restoration is unchanged. Function diagnostic NAME
propagation is broader than NUL rendering; only the new coordinate map is
warning-only. This distinction is part of the review, not hidden by green tests.

No concrete regression was observed in the frozen independent or affected
suites. General compound/heredoc/redirect-only/ANSI-C-word pretty-print fidelity
is still unproved and conservatively uses prior handling. These fixes are not
universal diagnostic, function-context, Bash or kernel parity.

Measured window: August27,2026,04:12:48–04:15:06 UTC. All28 phases have matching
actual import/input hashes, with zero changed loaded inputs or source drift;
final endpoint checks also show none. Aggregate-backed cases now load135 source
modules, including five S3 HTTP modules beyond the old130-module baseline;
focused shell suites load34. This is explicit dependency evolution, not an
assertion that the entire product equals the old snapshot. Compiler counts are
current measured inputs, not copied from the author's earlier1079/302/411.

Foreign archive source/test edits and untracked unrelated evidence existed in
the worktree. They were preserved, and no current clean-tree or full-suite claim
is made. Hash maps are deduplicated by digest; raw outputs, exact launches,
per-PID actual loads, native captures, old/current comparisons and source diff
are in `acceptance-c116d637.json` and `acceptance-summary.json`.
All905 recorded child PIDs/groups were checked absent at completion and again
in the final audit; temporary directories were cleaned, with no SIGSTOP/watchers.

## Preserved adjacent checkpoints

ROOT reports Plato1f2aa30 independently accepted the eight frozenf700 output
budget failures, with nine controls retained: accounting17/18 (one Apple-env
ordering raw loss),100/100,6/6,10/10,111/111,guards8/8,mutants7/7,author29/29.
That separately accepted result was NOT rerun or claimed as new evidence here.
The baseline's pending wording remains historical. GNU9.7 env capture on Darwin/
libSystem with gnulib prepend behavior is not universal GNU/Linux ordering;
POSIX environment-entry order remains unspecified.

The five CUSTOM first-read requirements remain unrun/open; no lifecycle API
change is authorized or claimed. Original native/profile losses, seven-gap
history, other owners' matrices and broader superiority/full-product goals
remain separate. This checkpoint accepts only the two independently frozen
modern NUL diagnostic defects and preserves all other denominators and limits.
