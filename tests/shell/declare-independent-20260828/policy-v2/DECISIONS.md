# Declaration policy v2 — four bounded root decisions

Friday, August 28, 2026, America/Chicago. Independent source-only leaf.
**All recommendations and example outcomes below are PENDING ROOT**, except
the explicitly identified ratifications/inherited contracts. No examples were
executed. No implementation, native parity, foundation acceptance, or public
acceptance is asserted. Source bindings/search limits are in PROVENANCE.md.

## Already resolved; additive, not rewritten history

The current root assignment ratifies: finish the matching finite reader/printer
before roundtrip/public acceptance (stages internal only); unchanged public AST
signature and scriptFile whole-AST preflight; replay only ordinary valid names
absent at replay start, control-variable listing inspection-only; reject a NUL/
lone-surrogate record before its first output byte, continue subsequent selected
records on ordinary serialization refusal, overall nonzero; stop on resource,
sink, abort or cleanup failure according to existing policies; charge new
declaration-shell formatting to the private ledger with checked pre-read/
preallocation reservations and no hidden diagnostic exemption, retaining the
existing downstream E_command exclusion; named `-p` ignores supported attribute
filters and never mutates, but unsupported flags still refuse.

These resolve portions of frozen R1/R3/R4/R5. They do not change the old H rows
into passes or retroactively settle old expected-decision cells. The four files
at `78ed08f009e9a9f1b8e2683655cae82027556139` remain byte-identical.

## G7 authority: exact chain and remaining provenance limit

The explicit recorded root-GO attribution is **author** commit
`3a363f2f9d749771a73a0e5b2f87688dbcfa02d4`,
`tests/shell/indexed-arrays-author-20260828/PRECODE.md:8` and `:32`.
It says root adopted addendum-v3 plus the closure choices. Its concrete referent
is `2a9d59c77c9a4d94fa56d61962c5d6dfd01c189f`,
`tests/shell/indexed-arrays-independent-20260828/closure-v1/DECISION-TABLE.md:74`
(E1): exported scalar **or exported-unset** conversion refuses at target entry
before array RHS; whole unset is an explicit eligible conversion path. E3 at
`:76` preserves local absence shadow and subsequent scalar assignment. The
earlier `c54db6863aa96c537778cf4dc85bd104a3155e90`,
`tests/shell/indexed-arrays-design-20260828/addendum-v3/DECISIONS.md:352` and
`:357` agrees. Closure `:19` itself labels G6/G7 recommendations pending then.

**Do not relabel that author attribution as a directly located root transcript.**
No separate G7 ratification was found in the searched root AGENTS, ledger,
integration-doc history or tracked Markdown G7 inventory. Thus the precise
historical root wording, particularly whether “whole unset” was exclusive,
cannot be authenticated here. The current assignment directly requires
preserving the exported-scalar guard; that requirement is not ambiguous.
P2 explicitly asks root to settle the separate-clear path, rather than infer
ratification from author's newer prose. There is no basis for an export-history
taint rule in the inspected source: `runtime.ts:1222` checks current readonly,
control name and `state.exported.has(name)` before array work.

## Current author proposal versus minimum consistent profile

`D` means `tests/shell/declare-design-20260828/DESIGN.md` at
`2832fdf1b6fb790995e2fcfcb9b203c71a13680e`, unchanged through attribution-only
correction `bd5a3d34205b41b3d49d71fb805ff0f6282e62a7` and this review's source
checkpoint. `R` means `src/shell/runtime.ts` at the bound checkpoint. No later
tracked declaration design or live design-byte delta was found.

| Root decision | Current author proposal | Recommended exact ratification — PENDING ROOT |
| --- | --- | --- |
| P1 — signed options and operand boundary | D:59–89: leading options only; negative a/r/x/p clusters; positive x-only clusters; last x sign; named p plus attributes usage2; any positive x in listing usage2. Scalar-syntax duplicates allowed; any compound/element operand forbids duplicate targets. D:213: global option validation, then sequential ordinary operands. | Validate the entire leading option region and invocation-wide usage constraints before any declaration-target publication. Scan tokens and cluster letters left-to-right; first unsupported letter/token gives2. Stop option recognition at the first operand or exact `--`; later tokens are operands. Negative a/r/p are sticky; last signed x determines scalar export, while **presence of any x operation** remains recorded for P2. Only positive x clusters are legal; `+a/+r/+p` remain2 even when named p would ignore a supported attribute. Named p ignores supported `-a/-r/-x/+x` after syntax validation; requested order/duplicates remain. Unnamed listing uses intersection of negative a/r/x filters; any positive x token remains usage2, not negated-export filtering. No listing mutation. |
| P2 — preserve G7 without final-bit loopholes | D:101–105: any x operation on an existing indexed binding fails1, including +x; new indexed creation with final x fails1; already-exported scalar conversion fails1 despite same-command +x; separate scalar +x permits later conversion. | At each operand entry, before export toggle, local shadow publication or value/attribute publication, reject converting a currently exported scalar, including exported-unset. A same-command +x cannot cure this. Permit a **separate successfully completed scalar +x** followed by conversion of that now-unexported scalar. Keep whole unset as another eligible path, not the only path. Any x operation on an existing **or requested resulting** indexed binding fails1 even if final x is false; this deliberately closes D's new-array cancelled-x gap while preserving scalar-only +x. Named-p ignored attributes are queries, not x operations on targets. Apply readonly/control guards too; no array export, +a conversion, new control exclusions or export-history state. |
| P3 — observable declaration versus scope barrier | D:119 removes membership on whole unset; D:125 calls an unset local a missing declaration, without specifying query visibility. R:1022 deletes value/export; R:3281 does not pop locals. A nested function's unset uses the same visible state; it does not create a restoring local save. | Whole unset removes value, kind, observable declaration membership and mutable attributes. An existing local save remains a **hidden absence barrier**, not a declaration: named p returns1/no record. Bare declare subsequently creates DECLARED_UNSET, reusing the current-frame save rather than saving over it. Nested unset of a caller local changes that caller-owned visible binding to hidden absence; return from the nested function does not restore it. Only the frame owning the original save restores its parent on exit. A nested explicit local declaration saves/restores the caller's hidden absence, never the concealed grandparent. Preserve control/getopts and complete saved flags; no new scope-unwinding semantics for ordinary unset. |
| P4 — phase/status/resource profile | D:238–255: ordinary failures1, usage2, private exhaustion1; loop failures continue, preparation/resource/I/O stop; parameter-expansion/EPIPE/public-limit paths preserved. Missing exact mixed-error aggregation and private diagnostic exhaustion policy. | Adopt the phase/status table below. Ordinary per-operand/per-record failures latch1 and continue; later success never clears1. Usage2 found by admitted invocation-wide validation prevents **all target publication**, not prior expansion/redirection effects. Private resource refusal stops the invocation, ordinarily1; do not continue merely because it shares numeric1. Diagnostics are charged too: use already admitted diagnostic capacity, or attempt checked reservation; if private diagnostic admission itself fails, stop as private refusal1 without emitting an uncharged diagnostic. Never catch/suppress an attempted sink/public-budget failure as this no-capacity case. Preserve infrastructure mapping/rejection and cleanup selection; no new universal limit status. |

For P2, allowing same-command `+x -a` on an exported scalar would **change** G7's
entry guard. The recommended separate-clear path does not: the later command
enters unexported. If historical root intended whole-unset-only eligibility,
P2's separate-clear sentence needs explicit authorization as an extension. This
is the exact outstanding authority ambiguity, not permission to weaken the guard.

## P1/P2 phases and atomicity

PENDING ROOT: a lone `-` or `+` before the operand boundary is option2; after
the boundary it is invalid-identifier1. Named-p operands must be bare valid names;
assignment and subscript forms are invalid-identifier1, not mutation requests.

“Validate invocation” does not mean source-wide pre-expansion option parsing.
R:1787 expands command arguments before dispatch; D:191–236 proposes special
preparation for authenticated compound/element operands. Literal compound
option incompatibilities and duplicate targets must be rejected before compound
RHS work; ordinary earlier eager scalar RHS can already have happened. Ordinary
scalar option validation occurs at builtin entry, after expansion and applicable
redirects/prefixes. Do not add pre-expansion option guarantees to computed argv.

PENDING ROOT: without compound/element operands, duplicate names observe earlier
successful publications in order, with refreshed own-publication watches.
Readonly takes effect after each successful operand, so a later duplicate value
write fails1 rather than delaying the freeze until the whole invocation ends. With
any compound/element operand, duplicate targets are global usage2 before its RHS
preparation. Invalid names and semantic type/export/readonly conflicts encountered
in the operand loop continue with sticky1. Compound preparation failure stops
before publication of any prepared declaration operands; earlier RHS/host effects
remain. Every operand pre-admits value, kind, declaration bit, attributes, scope
save and restoration together before publishing any of them. No all-operand
transaction or rollback, and no retry of an externally stale target.

## P3 state machine and dynamic ownership

PENDING ROOT: distinguish declaration visibility from ownership/save identity.
These ordinary-name states have independent readonly/export bits where legal;
indexed bindings cannot export. An attribute-only declaration does not create
an empty scalar value. Attribute-bearing scalar names count as declared even
without a value. `__proto__`, `constructor`, `toString` remain valid own-key names.

| State | Value/kind | Named `declare -p n` (no attributes shown) | Whole unset if writable |
| --- | --- | --- | --- |
| ABSENT | No declaration, value or kind | 1; empty stdout | 0; stays absent |
| DECLARED_UNSET | Scalar declaration, no value | 0; `declare -- n\n` | 0; ABSENT, or hidden local barrier |
| SET_EMPTY | Scalar value exactly empty | 0; `declare -- n=''\n` | Same removal |
| SET_NONEMPTY | Scalar value v | 0; `declare -- n='v'\n` | Same removal |
| INDEXED_EMPTY | Indexed kind, no members | 0; `declare -a n=()\n` | Same removal; member-only unset instead retains indexed kind |
| Hidden local absence barrier | No observable declaration; owning frame's saved parent still exists | 1; empty stdout, parent not revealed | 0; barrier remains |

Exported DECLARED_UNSET prints `declare -x n\n` but contributes **no key** to
child env (R:1922–1924); SET_EMPTY contributes `n=""`. Readonly DECLARED_UNSET
prints `declare -r n\n`, denies value assignment and unset1, but allows
idempotent attribute-only declaration and scalar export-bit changes. First local
declaration preserves the ratified typed-parent shadow policy; after whole unset,
no old indexed kind is resurrected by same-frame bare declare/ordinary assignment.

For nested frames F/G, only a declaration in G creates G's save. `unset` in G
against F's binding changes F's visible state, not F's saved parent. G return
does not undo that unset. If G then explicitly declares n, save the visible
absence owned by F and restore it on G return; F return alone restores the
original outer binding. Save once per frame/name, including declared-unset versus
absent and kind/export/readonly/getopts where applicable. Existing R:343–383 and
R:2050–2074 restoration paths must be extended for declaration membership, not
certified as already supporting it. Source summaries in frozen SOURCES O5 note a
GNU current-local/caller-local distinction; this proposal deliberately follows
the inspected current project path, **not a new claim of GNU parity**.

## E01–E18: supplemental decision examples, all UNEXECUTED

All names are ordinary; writable/unexported unless specified. Adequate admission,
working sinks and no abort/cleanup failure are assumed except E18. `Q` means
literal `declare -p n`. Status vectors give each shown operation in order, not
the final script's status. `\n` is LF, `""` is zero stdout bytes. Errors require
the existing bounded diagnostic category/name when admitted, not invented GNU
stderr text. These are proposed contracts, not executable fixtures or passes.

| ID | Initial state; command/data sequence | Status; exact stdout | State/effects under recommendation |
| --- | --- | --- | --- |
| E01 | n absent; `declare -rx +xx n=v; Q` | 0,0; `declare -r n='v'\n` | Last x clears export; readonly remains. |
| E02 | n=v; `declare -ap +x n; declare -p +a n` | 0,2; `declare -- n='v'\n` | First named query ignores supported attrs including +x; unsupported +a still invalid; neither mutates. |
| E03 | n=v; `declare -p -x +x; declare -p -ar` | 2,0; `""` | Unnamed +x is usage2; no readonly indexed matches; no mutation. |
| E04 | n absent; `declare -- n=v; declare n=w -x` | 0,1; `""` | Second -x is invalid operand, not an option; n=w, unexported. |
| E05 | n and seen absent; `declare -A n=${seen:=rhs}` | 2; `""` | Runtime unsupported option; eager scalar RHS leaves seen=rhs, n absent. No pre-expansion promise. |
| E06 | n absent; `declare n=one n+=two 'bad-name'=x later=three; Q` | 1,0; `declare -- n='onetwo'\n` | Duplicate sees first result; bad identifier does not block later=three. |
| E07 | exported SET_NONEMPTY n=v; `declare +x -a n; Q` | 1,0; `declare -x n='v'\n` | Entry guard; no export clear, conversion or value loss. |
| E08 | exported SET_NONEMPTY n=v; `declare +x n; declare -a n; Q` | 0,0,0; `declare -a n=([0]='v')\n` | Separate scalar clear then conversion; explicit P2 authorization. |
| E09 | exported DECLARED_UNSET n; `declare +x -a n; Q; declare +x n; declare -a n; Q` | 1,0,0,0,0; `declare -x n\ndeclare -a n=()\n` | Guard keys export membership, not a string-value lookup; separate clear preserves unset then converts empty. |
| E10 | INDEXED_EMPTY n; `declare -x +x n; Q` | 1,0; `declare -a n=()\n` | Any x operation on array refuses despite final false. |
| E11 | n absent; `declare -a -x +x n; declare -a -x n; declare -x +a n` | 1,1,2; `""` | Requested indexed+x operation refuses regardless of final x; +a remains unsupported2; n absent throughout. |
| E12 | n absent; `Q; declare n; Q; unset n; Q; declare n; Q; declare n=; Q` | 1,0,0,0,1,0,0,0,0; `declare -- n\ndeclare -- n\ndeclare -- n=''\n` | Absent → declared-unset → absent → declared-unset → set-empty, not one collapsed missing state. |
| E13 | n absent; `declare -rx n; Q; declare n=v; unset n; declare +x n; Q` | 0,0,1,1,0,0; `declare -rx n\ndeclare -r n\n` | Readonly unset blocks both value/unset; scalar +x succeeds without value. Child env omits n before/after +x. |
| E14 | exported n=outer; in F: `declare n=inner; unset n; Q; declare n; Q`; return F; Q | In F:0,0,1,0,0; outer Q:0; `declare -- n\ndeclare -x n='outer'\n` | First Q sees hidden absence. Redeclare is unset, unexported, reuses F save. F restores original exported value. |
| E15 | n=outer; F has declared n=inner; G called by F runs `unset n; Q; declare n; Q`; return G; Q in F; return F; Q | G:0,1,0,0; F Q:1; outer Q:0; `declare -- n\ndeclare -- n='outer'\n` | G unset affects F; G's later explicit local saves F absence, not outer. G return restores absence; F return restores outer. |
| E16 | no /early, n absent; VFS file text `: > /early\ndeclare -a n[-1]=x\n`; separately same initial state with second line `declare -A n` | Proposed declaration syntax case:2; runtime-option case:2; both `""` | Whole-file parse prevents /early only in syntax case. Runtime option may follow earlier file effect. Not Shell.exec unit-wise rollback. |
| E17 | already admitted scalar records a=ok, b units [0], c=later; `declare -p a b c` | 1; `declare -- a='ok'\ndeclare -- c='later'\n` | Root-resolved record refusal/continuation; no b bytes or mutation. Same policy for lone surrogate. |
| E18 | already admitted `declare -p n`, n=v; first record-format reservation refuses before output; remaining public diagnostic capacity adequate | Private refusal:1, `""`; instead, public Budget refusal: public exec rejects, no numeric result | Prior operands/records stay committed; no following record. If private diagnostic reservation also refuses, explicit P4 no-diagnostic1; if public budget/sink/cleanup fails, inherited outcome selection, not forced1. F=0 is not a valid promise of reaching this fixture. |

## P4 complete numeric/limit precedence profile

The table separates **new pending classification** from **inherited behavior**.
Numeric outcomes presuppose that output and settlement themselves succeed. There
is no global “syntax beats budget” or “semantic error beats budget” order: checks
must be admitted before reads, and an earlier resource failure stops discovery.

| Phase/conflict | Exact recommended disposition and source |
| --- | --- |
| Source grammar versus runtime option | New finite declaration grammar errors2 at parse time, including inactive branches/functions; scriptFile parses all units before file commands (R:2590–2603). Runtime unsupported options2 only after actual argv expansion/dispatch; earlier commands/redirections can remain. File loading/source-limit refusal can precede parsing. Other existing ShellSyntaxError codes are not globally rewritten; Shell.exec/source stay unit-wise. |
| Literal argv shape versus ordinary operand error | PENDING: leading-option/unsupported form/compound duplicate-target usage2 is globally validated before any target publication. This includes literal-argv unsupported subscript grammar and bare subscript-without-assignment; no shell reparse. Ordinary invalid identifiers/missing queries are1 per operand and continue. A canonical decimal outside 0..2147483647 is domain1, not grammar2. This explicitly resolves the previously unspecified mixture of usage2 and ordinary1 operands. |
| Semantic conflicts and aggregation | PENDING: invalid identifier, missing query, readonly/type/export/control/domain/stale failures1; ordinary loop failures latch1 even after later success. No numeric “last error wins.” Preparation failures stop the invocation instead of continuing to later operands; prior eager effects survive. Known array-entry readonly/control/export and certain range checks precede that array RHS; uncertain range follows the RHS once. At final publication check cancellation, then readonly, then stale; no license to bypass earlier charged preparation to discover later failures. D:195–226. |
| Serialization versus resource discovery | Root-resolved NUL/lone surrogate refuses the whole offending record, continues; recommend numeric1. Missing/invalid-name listing also1/continue. But if private scan/format/diagnostic reservation fails before discovering/refusing a record, that is resource failure: stop, not serialization continuation. Prior records retained; no claim of atomic sink writes. |
| Private counters/tickets | Inherited candidate mechanism: ArrayFailure, not FsError or ShellLimitError (arrays/ledger.ts:1). Lazily derive representable caps in order F,F,B,128F,8B+512F,8F,32B+256F; then requested generation/version/epoch tickets, then wrapper/Map slot/payload/metadata/allocated-byte/allocated-slot/work checks. Failed reserve changes no counters/tickets; only live counters refund. Ordinary mapping1 if its diagnostic completes (R:1569–1578). Declaration pre-read and preallocation charging is ratified; P4 adds explicit no-private-diagnostic-capacity disposition, not an uncharged fallback or counter reset. |
| Public shell budget | R:80 aborts the budget controller with ShellLimitError; R:1561 rethrows; shell.ts:163–191 and :279–293 preserve public rejection, not exit126 or125. Top-level maxSourceBytes can reject before runtime; stage/argv limits can fail before declaration dispatch. No “F0 means declaration1.” A rejected public exec supplies no ShellResult, though already delivered external bytes/effects remain. |
| EFBIG / differently named LimitError | No universal errno/status contract. R:2586 converts scriptFile EFBIG to the public maxSourceBytes budget failure. commands/internal.ts:106 maps ordinary caught errors to its configured failureCode (default1) only after diagnostic; its UsageError is2. The inspected class actually named LimitError is Xan-local (commands/xan/budget.ts:5), caught as XanError for1 (xan/index.ts:36–42), not a declaration/public-shell budget. EnvSplitError125 is env-specific (commands/execution.ts:53–57). File/interpreter admission126 is distinct (R:2579/:2587). No transfer of those numbers to declarations. |
| Sink faults / EPIPE | Stop record/operand work. Preserve reached infrastructure path: R:1568 maps EPIPE141; ordinary errors may become1 with diagnostic; an escaping diagnostic write failure can reject. Do not promise every sink exception rejects by original identity or every one becomes1. ArrayFailure diagnostic is awaited without the generic diagnostic catch at R:1569. Declaration code must not recursively diagnose a diagnostic failure; it must not skip admission to force numeric1. |
| Caller / invoke / cleanup | Inherited contracts/command.md:24–43 and :120–138: exact root-caller reason outranks actual escaping execution/control failure, then ranked invoke cancellation. Do not unmap an already mapped status or infer origin from reason equality. Drain all registered cooperative cleanup/root barriers; absent caller/execution rejection, one cleanup failure rejects unchanged or multiple aggregate, even after numeric nonzero. Existing pipefail/early-pipe selection remains; ordinary earlier effects cannot be undone. No new total ordering among opaque late failures. |

No additional root vote is needed to invent universal sink/abort/cleanup numbers;
the existing route-specific contracts already decide them. The actual remaining
P4 choices are global usage2 shape validation, sticky ordinary1, and the explicit
private-diagnostic-capacity refusal rule. They must be ratified together with P1
to avoid calling an after-first-operand flag both usage2 and invalid-identifier1.

## Copyable ratification strings — all PENDING ROOT

1. **P1:** Ratify leading-region whole-invocation validation, left-to-right clusters,
   sticky a/r/p, scalar last-x sign with x-operation provenance, scalar-syntax
   sequential duplicates, compound/element duplicate refusal, named-p supported
   +/-x ignoring and unnamed +x usage2; unsupported toggles always2.
2. **P2:** Preserve exported-scalar/exported-unset entry guard before same-command
   toggles/publication; authorize separate scalar +x then conversion; reject any
   x operation on existing or requested indexed kind, irrespective of final bit.
3. **P3:** Whole-unset local is hidden absence, query1, not declared-unset; retain
   owner-frame save/barrier through nested unset/redeclare and restore exact parent
   once. Explicit declare recreates observable unset membership without a value.
4. **P4:** Ratify the phase/status table: global usage2 before target publication,
   sticky ordinary1/continue, private quota1/stop, charged diagnostics or explicit
   no-private-capacity diagnostic omission; public budget/sink/abort/cleanup keep
   their existing mapped/rejected outcomes and precedence.
