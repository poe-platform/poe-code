# Runtime-invalid ERE control flow: SOURCE-only sidecar

Date: 2026-08-29. No production changes or runtime execution. This is an additive clarification of `27cf475704b1fef96d0923a23369b6578464b062`; prior evidence is unchanged. ROOT's last-parent capture reporting decision is now resolved. This sidecar does not revisit that decision or audit current engine/transport repairs.

## Finding

GNU 5.3.15's runtime `regcomp` failure returns **status 2 through the conditional expression**, rather than escaping the entire expression as a fatal exception. Inner `||` can run its right operand and replace that status. Inner `&&` skips its right operand and retains 2. A node's inversion flag maps any nonzero result, including 2, to 0.

There is a parser-level qualification: adjacent `! !` toggles the **same node's flag twice**, so `[[ ! ! E ]]` retains 2. Parentheses create a distinct node: `[[ ! ( ! E ) ]]` yields 1. A generic nested-boolean `not` implementation loses this distinction. These are deductions from authenticated source, **not newly observed native outcomes**.

Private project resource/profile exhaustion remains a different outcome: throw through the inner evaluator, then map to status 3 at the conditional-command boundary. Do not use that policy as the model for ordinary invalid ERE status 2.

## Exact bindings and source branches

`BINDINGS.json` and `SUPPLEMENT-BINDINGS.json` bind every inspected body and numbered excerpt. Source bytes were admitted as bounded regular non-symlink files, opened with `O_NOFOLLOW`, checked against inode identity, and SHA256-verified before decoding those same bytes. The helpers only read source and publish DATA; they did not import or execute target code.

GNU source is the retained signed base plus patches 001–015, with canonical source inventory `75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e`, signature evidence `fe5d87a2`, source evidence `efcd8b49`. The inspected files are:

| File | SHA256 | Source relevance |
| --- | --- | --- |
| `execute_cmd.c` | `5b7da1b3c61225fdf726929ffbc4f89f7068cbe83d2060b6ad1509c2feb9a032` | Conditional and outer-command control flow |
| `lib/sh/shmatch.c` | `c889cb70a2670e5f009e4b0f77e6b32ad0c6d55a6bfe36f6cfab14a58515d06c` | Compile failure, match results, capture mutation ordering |
| `parse.y` | `076a16d00c5b065137b3d2730d2b94a1f6c89a1bbb5d2f4bd72d31e00947e27f` | Inner inversion flags and grouping |

CORE is the accepted 293-input derived composition `bf079ada185a79aec864b068f3738ddc5520822e`, source `7196bace8ea2c141d5ed1020fef5bf721c321ace`, root acceptance `76648c57`. It is not assumed to be a stored tree or live HEAD. Its catalog SHA256 is `12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4`; five relevant CORE bodies were read against their catalog hashes. This is not a reconstruction or execution of all 293 inputs.

Line citations below refer to original authenticated source lines, retained as numeric prefixes in the `.source.txt` excerpts:

- **G1:** `shmatch.c:86–91`: `regcomp` failure optionally produces an error string and returns 2 immediately, before matching or capture-array lookup at 93–120.
- **G2:** `execute_cmd.c:3993–4005`: group nodes return their child's status; OR visits the right child when left is nonzero; AND visits it only when left is zero.
- **G3:** `execute_cmd.c:4061–4072,4095–4104`: operands expand in order; the reached regex leaf calls `sh_regmatch` and emits its invalid-expression diagnostic if result is 2. Diagnostics are not deferred until the whole conditional's final status is known.
- **G4:** `execute_cmd.c:4125–4128`: node inversion is `0 -> 1`, any nonzero `-> 0`. `parse.y:5117–5123` toggles the operand node's flag using XOR for each `!`; `parse.y:5096–5115` creates a `COND_EXPR` wrapper for parentheses. The exact grouping excerpt is also retained in `raw/detail.stdout`.
- **G5:** `execute_cmd.c:4138–4140,4164–4172`: conditional execution sets source line context and command name `[[`, executes the expression, then returns its numeric result. This does not establish exact libc error wording or a captured stderr prefix.
- **G6:** `execute_cmd.c:2936–2964`: outer AND/OR lists ignore errexit for the first command, run the second on zero/nonzero respectively, and use the second's status when visited.
- **G7:** `execute_cmd.c:1170–1175,1203–1207`: an unignored/uninverted failing compound command can trigger errexit; outer command inversion maps nonzero to zero. Existing trap behavior is source context, not a proposal to add ERR traps.

## Finite status/effect truth table

Definitions for all rows: clean noninteractive C/POSIX profile, ordinary successful diagnostic output, no abort/resource failure, no traps, and errexit off unless explicitly stated. `E` is the runtime-invalid comparison `x =~ $bad` after `bad='('`; `T` is `-n t`; `F` is `-n ''`. The shell source is structurally valid except EC19. `:` is a successful builtin. An invalid leaf's diagnostic remains observable even if later control flow returns 0. Counts below are source-predicted invalid-leaf diagnostics, **not native byte goldens**.

| Proof ID | Exact conditional/list form | Result | Evaluation/effects | Authority |
| --- | --- | ---: | --- | --- |
| EC01 | `[[ E ]]` | 2 | E reached, one diagnostic | G1,G3,G5 |
| EC02 | `[[ ! E ]]` | 0 | E reached, one diagnostic | G3,G4 |
| EC03 | `[[ ! ! E ]]` | 2 | Same node toggled twice; one diagnostic | G4 |
| EC04 | `[[ ! ( ! E ) ]]` | 1 | Distinct group inversion; one diagnostic | G2,G4 |
| EC05 | `[[ E && T ]]` | 2 | T skipped; one diagnostic | G2,G3 |
| EC06 | `[[ E || T ]]` | 0 | T visited; one diagnostic retained | G2,G3 |
| EC07 | `[[ E || F ]]` | 1 | F visited; one diagnostic retained | G2,G3 |
| EC08 | `[[ F && E ]]` | 1 | E skipped: no regex expansion/compile/diagnostic | G2 |
| EC09 | `[[ T || E ]]` | 0 | E skipped: no regex expansion/compile/diagnostic | G2 |
| EC10 | `[[ T && E ]]` | 2 | E reached, one diagnostic | G2,G3 |
| EC11 | `[[ F || E ]]` | 2 | E reached, one diagnostic | G2,G3 |
| EC12 | `[[ E || E ]]` | 2 | Both leaves reached; two diagnostics | G2,G3 |
| EC13 | `[[ ! ( E || T ) ]]` | 1 | Recovery returns 0 before group inversion | G2,G4 |
| EC14 | `[[ E ]] && :` | 2 | Outer right command skipped | G5,G6 |
| EC15 | `[[ E ]] || :` | 0 | Outer right command visited | G5,G6 |
| EC16 | `! [[ E ]]` | 0 | Outer inversion, one diagnostic retained | G5,G7 |
| EC17 | `[[ ! E ]] && :` | 0 | Outer right command visited | G4,G6 |
| EC18 | `[[ ! E ]] || :` | 0 | Outer right command skipped | G4,G6 |
| EC19 | `[[ -n t || x =~ ( ]]` | Not a runtime-ERE row | Structural parsing must complete; no skipped-runtime-error inference | GNU parser error branches; original R21 |
| EC20 | `set -e; [[ E ]]; printf after` | exits with 2 | Following command not reached under stated context | G5,G7 |
| EC21 | `set -e; [[ E ]] || :; printf after` | 0 | Recovery and following command reached | G6,G7 |
| EC22 | `set -e; [[ ! E ]]; printf after` | 0 | Inner inversion completed before errexit decision | G4,G5,G7 |
| EC23 | `[[ ! x =~ z ]]` | 0 | Valid nonmatch, not compile failure; capture-clear control | G4; shmatch.c:100–120 |
| EC24 | `[[ E || x =~ (x) ]]` | 0 | Later successful leaf can publish captures after E's diagnostic | G2,G3; shmatch.c:122–130 |
| EC25 | `[[ ! ( E && T ) ]]` | 0 | T skipped; group inverts retained 2 | G2,G4 |

These forms are an exact finite source-level specification using the three explicit textual abbreviations, not executable fixtures or a native launch grant. Before any future execution, materialize each form with literal `bad='('`, substitute E/T/F only in the indicated conditional positions, and freeze the resulting bytes and status/marker capture protocol. EC19 deliberately has no guessed native diagnostic/status tuple. Do not run these forms through string evaluation inside product tests.

No invalid leaf rolls back operand effects. Compile failure occurs before capture mutation; subsequent visited valid comparisons may replace captures. Thus “invalid preserves BASH_REMATCH” means the invalid leaf itself does not publish, not that an entire compound expression restores its entry snapshot.

## Project private-limit distinction

The existing private status-3 policy comes from `e2b4823c`, not native GNU behavior. Let P mean a reached, specifically classified ERE private resource/profile exhaustion, with no higher-priority caller/global/sink/cleanup error:

| Proposed proof grouping | Inner expression / outer form | Required project disposition |
| --- | --- | --- |
| EH01 | `P`, `! P`, `P || T`, `P && T`, `T && P`, `F || P` | Abort inner evaluation; map once to command status 3. No inner inversion/recovery. |
| EH01 | `T || P`, `F && P` | P unvisited; ordinary 0/1, no P acquisition or charge. |
| EH01 | `E && P`, `E || P` | First skips P and returns 2; second reaches P and yields command status 3. E diagnostic remains. |
| EH02 | command-status-3 `&& :`, `|| :`, or outer `!` | Existing outer shell rules: retain 3/skip; run `:`/return 0; invert to 0 respectively. This is the declared command-boundary policy, not a claim all failures are invertible. |
| EH03 | Real `ShellLimitError`, caller abort, host/protocol failure, or diagnostic-sink rejection in any inner boolean context | Not E or P. Preserve existing escaping error/control and raw reason selection. Never manufacture 0/1/2/3 to make a boolean branch run. |
| EH04 | Syntax diagnostic succeeds but later cleanup rejects; syntax diagnostic rejects with falsy/object reason; simultaneous caller abort | Preserve accepted N14 execution/caller/cleanup provenance and identity; do not mistake fulfilled status 2 for an execution rejection. |
| EH05 | Same escaping reason through exact invocation Promise versus derived Promise/control wrapping | Retain N14's documented exact-Promise limitation; no new thenable inference or equality-based provenance. |

EH01–EH05 extend existing H03/H06/H08 procedures. They need separately presealed finite host fixtures after source composition; they are **not** five executed tests or authorization to inject private counters/lower caps. Real default-bound reachability and instrumented controls must remain distinct. No opaque host-promise preemption or new cleanup API follows.

## Minimal integration correction

1. Replace the conditional evaluator's boolean-only semantic channel with a private numeric/discriminated **0/1/2 result**, while keeping escaping failures on the exception/control channel. Do not add a public command contract. A reached typed ERE syntax/unsupported refusal must emit its diagnostic at the leaf, then return 2 into the conditional tree. Returning 2 only from an outer catch skips GNU's inner OR and inversion behavior.
2. Preserve group identity and inversion parity in the parsed conditional representation. Accepted CORE `parser.ts:627` creates nested `not` nodes; `628` discards grouping. CORE `conditional.ts:163–179` then performs boolean `!` and boolean short-circuiting. Changing only the result type is insufficient: EC03 and EC04 would otherwise collapse to the same behavior. Add a group node plus same-node inversion/parity handling, or an equivalent representation that retains both distinctions. Outside `[[ ]]`, keep parsing unchanged.
3. At CORE `runtime.ts:1543–1559`, replace `Number(!await evaluateConditional(...))` with the numeric semantic result. Its current catch at `1560–1569` handles `ConditionalUnsupported` at the entire command boundary and returns 2. Do **not** route runtime-invalid ERE through that generic escape path, nor globally change every existing unsupported conditional feature as part of this fix.
4. Classify only known typed ERE semantic refusals as the recoverable status-2 channel. Keep private ERE/transport resource limits exceptional through the inner evaluator, mapping them once at the conditional-command boundary to the existing profile status 3. Keep protocol/worker faults distinct. Any library error with a coincidental `.status = 2/3` is not sufficient authority.
5. Reuse CORE outer-list and inversion behavior: `runtime.ts:1366–1381` visits outer AND/OR branches by numeric status, `1488–1489` applies pipeline inversion, and `1501–1509` handles errexit. The ignored/negated context is already selected at `1372–1375`. A catch-all status mapper must not intercept caller/global/sink/control failures before those boundaries.
6. Existing sink/error handling is relevant: `runtime.ts:1563–1569` preserves abort checks and real `ShellLimitError`, wrapping escaping diagnostic causes; `1353–1362` unwraps `NounsetDiagnosticFailure` at the appropriate run boundary. Preserve the established N14 provenance machinery rather than changing it to reason-truthiness checks or copying a generic `error.message` into a new error.

All proposed changes remain inside the earlier four-file write-set. No product implementation is authorized by this sidecar.

## Diagnostics, reference applicability, and remaining decisions

- GNU 5.3.15 source attempts an invalid-ERE diagnostic at the reached leaf even when `!` or `||` makes final status 0. Exact `regerror` wording depends on the linked library, and full command-name/line-prefix bytes were not independently established here. Do not transplant GNU 5.3 source wording into Apple 3.2 observation goldens.
- The table assumes a runtime compile failure supplied through `$bad`, not a shell parser failure or operand expansion failure. EC19 and existing R21 must retain parse-before-effects checks separately. No “all errors escape” or “every nonzero is inverted” generalization is valid.
- EC01–EC25 and EH01–EH05 are **UNRUN**. Existing native N01–N12 artifacts do not execute this control-flow matrix. Neither GNU 5.3 native applicability nor Apple 3.2/libc behavior for these compound forms is claimed observed.
- ROOT need not reopen R01 capture reporting. The actionable source-backed design addition is numeric status-2 propagation **plus group/inversion representation**, preserving the already ratified status-3 inner escape / ordinary outer-command split. If ROOT wants a stricter always-fatal invalid-ERE policy instead, that is an explicit compatibility deviation, not a GNU-source conclusion.
- Future runtime/native capture work requires a fresh finite grant. Current engine and transport repair acceptance remain separate prerequisites; no source outcome here grants activation.

## Execution/accounting

Initial direct-file capture predates fallible source helpers. `raw/initial.stdout` records 2026-08-29T10:54:44Z. Three source-helper files received Node syntax qualification before execution; only Node builtins read/hash/publish DATA. Initial inspection read 719977 bytes including the source catalog; supplementary reads are separately bound, not counted as unique-source coverage. Original source hashes were checked again for supplemental windows.

Known process accounting through publication is conservatively at most 32 starts, peak no more than 2: initial shell/context and scoped metadata, three patch/syntax/DATA-helper batches, bounded shell display readers, and explicit-path publication. This includes administrative roles, with room for the patch wrapper's interpreter replacement; it is not an OS-wide census. All tool calls are synchronous and retired; no long-running session or child was started. The final publication shell exec-replaces itself with Git commit. No native Bash, ERE engine, Worker, compiler, product, network, private checkout, or prior held track ran. No grant extension or rerun occurred.

Configured capture/work limits were 32 MiB / 128 MiB; admitted source buffers were bounded to 2 MiB and 768 KiB in the respective helpers, plus a 217136-byte final source detail. Outputs are bounded source excerpts and small JSON/raw receipts, not binary/tool dumps. This is SOURCE/DATA evidence, not a measured product memory/cancellation guarantee. Publication uses only this new scope and leaves `27cf4757` evidence unchanged.
