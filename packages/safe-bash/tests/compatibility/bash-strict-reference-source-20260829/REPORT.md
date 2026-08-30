# Eleven OPEN Unit2 rows — GNU 5.3.15 source findings

2026-08-29. SOURCE inference only: no GNU/local Bash, product, package, engine,
compiler, Worker, P2 or native oracle executed. All eleven original runtime
identities remain OPEN/UNRUN; this is not a rescore or an executed golden set.

## Frozen authority

- Design: 90c109913cf2a1ec5b39ba0c4eb0518caca01147, original CASES/BINDING bytes.
- Resolved-profile acceptance: be284b6f799e7501c793daff4d7bffc36ce4090b.
- Unit2 runtime/parser: stored 928be5585f05c15867fbbb5f4b5debe153b0734e blobs.
- Accepted derived composition: 26215b99cb379a9f825f803454f758fab5a3c8e9;
  full950 package 1fafce728b6346db4555449ba6259694346983d877a32e917fd7a15c6ebe64e4.
  This analysis reads selected source bindings, not that package or live HEAD.
- Arithmetic: design BINDING's stored revision
  67eab12e315054907ef4ef435c6bbca2f59e0c36, blob
  223101946d13ac9b44f4a898f58fd16004ba86b9, SHA256
  5e2d784b8fd333972e6e413f4c3478163462a3c1abf8cc5ff7173963420440bd.
- GNU: signed base plus patches001–015, signature commit
  fe5d87a215310cbe847bee99bbe3c7650aa3f6e3, source handoff
  efcd8b49a63ceb4276ae9d075da59bfb027b3510, inventory
  75c692f66095ad85848915f50e9357e506ed9664415f48ce6104cafa7269368e.
  Every inspected GNU file is checked against the stored inventory before read.

GNU line references below mean that exact retained source, not another release.
Product runtime line references mean product/runtime.stdout.raw, not current
src/shell/runtime.ts. SOURCE-01…08 result files bind paths/hashes/excerpts;
SOURCE-05 is a preserved preparation refusal, not successful coverage.

## Reference conditions and status boundary

Predictions concern the original literal programs in a fresh, noninteractive
GNU 5.3.15 default build with ARRAY_VARS and default config-top.h:36 ONESHOT,
ordinary Bash mode, no inherited -e/-u/POSIXLY_CORRECT/options, C locale, and
the design's future `--noprofile --norc -c PROGRAM bash-surface` invocation.
The signed source is not an executed/qualified native binary.

`expr.c:1190–1216` sets failure1, reports an unbound variable, then throws
FORCE_EOF in noninteractive mode. `builtins/evalstring.c:395–402` propagates that
throw. Default `shell.c:1457–1483` ONESHOT maps FORCE_EOF to **127** for -c;
DISCARD maps to1. `eval.c:104–125` instead handles file/stdin reader-loop EOF
without that ONESHOT127 mapping. Thus initial failure1 is NOT proof that the
final process status is always1. Subshell/command-substitution catch sites and
caller continuation are separate logical boundaries, not a reason to give every
fatal condition the same root status. Their complete dynamic tuples remain UNRUN.

## Exact eleven-row mapping

| ID | GNU source inference for original program | Frozen product / minimal author action |
| --- | --- | --- |
| U06 | set.def:723–771 scans each letter and calls change_flag immediately. flags.c:185,236–242 enables u before z fails. sh_invalidopt receives `-z`, usage is printed, and set returns failure1 in ordinary Bash mode; no implicit -e means the following printf can run. The script's last printf can therefore return0; u remains enabled. | runtime:3222 validates the entire token before mutation, then :3235–3238 exits2. This differs in mutation, continuation and status. Implement incremental supported-letter processing; do not globally change POSIX special-builtin behavior or enable unsupported options. |
| U07 | set.def:739–743 handles absent -o operand by listing option states and continuing; :293–314 iterates o_options. A missing operand is not a syntax/refusal error. Following printf can run. | runtime:3225 requires a named supported option and otherwise exits2. P1 explicitly excluded listing. ROOT must choose real listing support or retain an honest profile gap; do not fake GNU's full option table by labeling unsupported options implemented. Exact listing bytes depend on configured table/state and remain unmeasured. |
| U17 | subst.c:8216–8238 emits `missing: required`; :10412–10418 returns a fatal expansion descriptor for noninteractive execution. The explicit `:?` operator is distinct from generic nounset. Default -c fatal boundary implies127 and no trailing printf. | runtime:3561 creates ParameterExpansionFailure; :1610 already maps that class to127 outside isolation. Do not replace this with the nounset Flow(exit,1) branch. Prefix/line and nested-boundary tuples are not dynamically proved. |
| U27 | subst.c:7502–7516 detects absent/invisible/non-array a under-u. For @/* it truncates the subscript for diagnostic body `a: unbound variable`, returns -1, and :9955–9956 returns a NONFATAL expansion error. Expansion unwinding uses DISCARD, not FORCE_EOF. Original sole failing command implies no printf output and failure1; a later parsed input unit may continue. | runtime:3527 returns0 for missing aggregate storage. Add a distinct missing-aggregate-length error/continuation path, not scalar fatal nounset or a fabricated zero. Freeze same-line versus next-input-unit continuation separately. |
| U28 | arrayfunc.c:507–521 creates/finds array storage; empty assignment retains visible array storage. array.c:88 / array.h:121 define zero element count. subst.c:7528–7533 returns that count for both @ and *. The source predicts `0|0` plus newline, success, without unbound diagnostic. | runtime:3527 already counts empty binding as0. Preserve this; do not collapse array-object existence with aggregate expansion presence or route all zero counts through U27's error. No runtime pass is claimed. |
| U31 | expr.c:1190–1216 reports evaluated missing and FORCE_EOF; default -c boundary127. No printf/after output. | runtime:1043–1047 simply Reflect.get; arithmetic.ts:174–177 maps missing to0. Add nounset at evaluated reads and preserve its control through arithmetic-expansion catches. Current SOURCE path does not implement this requirement. |
| U32 | expr.c:1380–1401 peeks ahead with noeval; a plain assignment's LHS is not read. The RHS2 is evaluated/assigned, so later missing expansion can print2 successfully. | arithmetic.ts:193 evaluates only RHS for =, then :201 writes. Preserve this distinction; an eager identifier precheck would create a bug. No source need to reject an uninitialized assignment target was found. |
| U33 | expr.c:1395–1398 does read an identifier unless lookahead is plain EQ; compound assignment therefore reads missing, reports it and FORCE_EOF before binding a result. Default -c127, no after. | arithmetic.ts:195 reads LHS for compound assignment but the existing proxy supplies undefined→0. The same evaluated-read gate as U31 is required; do not convert a fatal nounset into a normal arithmetic status/diagnostic. |
| U34 | Increment's operand is a read; expr.c:1395–1398 / :1190–1216 produce unbound-variable FORCE_EOF from LET evaluation before the increment publishes a value. Default -c127, no after. | arithmetic.ts:182,188–190 reads before writing, but missing currently becomes0. Preserve fatal control through the LET wrapper, not only through $((...)). |
| U35 | expr.c:1241 maps a present empty scalar to arithmetic0. :1165–1166 short-circuits noeval; :639–669 and :685–699 protect the unvisited ternary/OR branches. Source predicts `1\n1\n4\n`, no missing diagnostic. | arithmetic.ts:180,196–197 is lazy. Keep empty-value handling and laziness; introducing a blanket scan for names would break this control. This is a source constraint, not a new runtime success. |
| U36 | expr.c:1241 recursively evaluates nonempty variable contents. Reading value then parsing its content missing reaches :1190 with the INNER token missing; diagnostic must name missing, not value. Default -c127, no after. | arithmetic.ts:174–178 recursively evaluates values, but missing currently becomes0. Add the gate without losing recursive token identity or existing recursion/budget/cancellation controls. |

## Diagnostic source and name/line origin

For a future C-locale one-line `-c PROGRAM bash-surface` capture, error.c:74–85
uses `get_name_for_error()` plus `executing_line_number()`, normally yielding
the `bash-surface: line 1: ` prefix under the stated fresh conditions. This is
a source-derived format, NOT a captured stderr golden.

- error.c:98–108 prefers BASH_SOURCE[0] when available, otherwise $0; then uses
  shell_name/PROGRAM fallback. Multiline/functions/source/eval require actual
  context binding, not global replacement with the engine's `shell` label.
- execute_cmd.c:412–435 uses the arithmetic/conditional command's own line when
  applicable; otherwise it uses line_number. Exact parser/input-frame updates
  across compound contexts have not all been traced or dynamically measured.
- err_unboundvar at error.c:447–449 delegates to report_error:170–187. It does
  not itself add `let:`. U31/U33/U34/U36 name missing; U27 names a (not a[@]).
- U17 uses the explicit operator's `missing: required`, not `unbound variable`.
- U06 uses builtin_error_prolog/common.c:90–108, which also prints `set:`;
  :196–198 formats `-z: invalid option`. Usage has its own `set: usage: ` prefix
  and generated current_builtin->short_doc (common.c:128–133; set.def SHORT_DOC).
- report_error's own -e handling is another branch. None of these eleven fresh
  original programs enables -e; do not extrapolate these tuples to -eu contexts.

Frozen product :1594–1610 uses io.scriptName/diagnosticLine/private failure class.
Its accepted cleanup/caller/limit/sink contracts are distinct from GNU longjmp;
this review does not authorize weakening them or globally rewriting statuses.

## ROOT/author decisions, now concrete

1. Ratify incremental supported `set` parsing and ordinary-Bash invalid-tail
   failure/continuation; separately keep POSIX mode and unsupported option scope.
2. Decide how to expose truthful `set -o` listing. A supported-subset listing is
   still a documented GNU byte-profile difference, not U07 parity acceptance.
3. Preserve empty array storage; implement U27's nonfatal parsed-unit abort
   separately from scalar/arithmetic fatal nounset. Do not generalize length
   presence into all `${a[@]}` / default / alternative expansions.
4. Gate only actual arithmetic reads; preserve pure assignment, lazy branches,
   recursive inner-name diagnostics and opaque caller/limit/error identity.
5. Resolve root -c versus file/stdin/isolation status with invocation-profile
   aware control. A global status1 nounset policy contradicts default -c source;
   a global127 replacement would also be wrong. Source proof is not permission
   to rebaseline native tests without an admitted reference and whole-cohort run.
6. Use versioned literal fixtures and explicit invocation/name/source conditions.
   Keep all original expected-runtime fields null and every native row UNRUN.

`FIXTURES-v1.json` preserves the eleven literal programs byte-for-byte and adds
seven named questions/controls, not seven executed successes. It does not run
the programs, import product code, use local3.2 as5.3, or modify author tests.

## Preparation refusals and finite qualifications

The original metadata lookup wrongly treated derived c83 as stored Git; its
exit128 and SOURCE-05 authority refusal are retained. ROLE-CORRECTION.md records
the exact frozen stored-blob correction, not a fallback to HEAD. SOURCE-05's
395210 already-read bytes remain charged despite no successful result record.
The unexecuted author-handoff job after the stopped batch is not claimed read.

No compiler flags, executable version, native process cleanup, full950 runtime,
interactive/POSIX behavior, arbitrary sourced/eval line coordinates, host error
precedence or whole Bash conformance is proved here. The data manifest reports
actual selected source-read membership/bytes and zero semantic/native executions.
All metadata children closed; no build/provider/P2 work was resumed.
