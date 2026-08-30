# Independent finite holdouts — DATASTATIC / FUTURE RUNTIME

**12 families, 48 rows, zero runtime/native executions; no pass denominator.**
Question families were frozen before deep author-body reading (PROVENANCE).
Concrete rows were written afterward, with knowledge of root proposals, author
design, and current source. They are independent reviewer-authored cases, not
blind/preimplementation claims and not relabelings of the author's 40 rows.
No harness, executable fixture, native script, or authorization is supplied.
Any future implementation review needs a new source binding and explicit grant;
all array rows depend on a separately accepted foundation, not acceptance of c7.

## Interpretation

Each row is one finite case/fixture, not an expandable fuzz mandate. Source
examples are **data**, never run by this review. `\n` in an output cell denotes
one LF; `out=""` means zero stdout bytes. Initial ordinary names are absent unless
the input establishes them. For mechanical fixture vectors, the listed lengths,
bytes, order and injection points are exact; no “and similar” extra inputs.

`P` = conditional on root ratifying the author profile as corrected; numeric
statuses and quoted output are proposed project expectations, not GNU captures.
`D(Rn)` = a decision row: alternatives in REVIEW Rn remain unresolved, so no
single expected runtime answer is sealed. `C` = existing contract/source
invariant; runtime proof still pending. Diagnostics are checked by category,
offending name and original failure identity where applicable; exact stderr
strings must be frozen with the next authorized implementation, not invented here.
Success rows have empty stderr. Required state/namespace effects supplement
status/output; final script status is not substituted for intermediate statuses.
Rows mentioning printf or a handler use explicit existing virtual fixtures, not
a native command or an assertion that registered printf is a genuine builtin.

| ID / family | Exact source or finite fixture | Future expectation / decision |
| --- | --- | --- |
| H01 / F01 options | Empty registry; `type declare typeset; command -v declare typeset` | P: both discovered as genuine runtime builtins, statuses0; command-v output `declare\ntypeset\n`; no default registry additions. Freeze existing type wording separately. |
| H02 / F01 options | `typeset -rrxx n=v; typeset +xx n; typeset -p n` | P: statuses0,0,0; out `declare -r n='v'\n`; readonly retained, export removed. |
| H03 / F01 options | `declare -- n=v; declare n=w -x` | P: statuses0,1; out empty; n becomes w, `-x` is bad identifier after operand boundary, not export option. |
| H04 / F01 options | Four separately initialized inputs: `typeset +r n`, `declare -aQ n`, `declare -`, `declare -- -` | P: statuses2,2,2,1 respectively; out empty; no n created; invalid option versus invalid identifier distinguished. |
| H05 / F02 listing | `declare n=v; declare -p n missing n` | P: query1; out `declare -- n='v'\ndeclare -- n='v'\n`; missing-name diagnostic; n unchanged. |
| H06 / F02 listing | `declare n=v; declare -ap n` | D(R1): author2/empty versus supported-flag-ignore0/`declare -- n='v'\n`; never convert n. |
| H07 / F02 listing | `declare -ar Z=(); declare -ar A=(); declare -r scalar=s; declare -arp; declare -axp` | P: query statuses0,0; out `declare -ar A=()\ndeclare -ar Z=()\n`; intersection filtering, ASCII order, empty ax match; no other readonly fixture names. |
| H08 / F02 listing | `declare -p n=value` with n absent | P: status1/out empty; invalid identifier, n remains absent; query cannot assign. |
| H09 / F03 presence | `declare n; declare -p n; declare n=; declare -p n; unset n; declare -p n` | P: statuses0,0,0,0,0,1; out `declare -- n\ndeclare -- n=''\n`; no value versus empty versus absence. |
| H10 / F03 presence | `declare -x n;` then an explicit read-only environment-inspection handler; `declare n=;` inspect again | C/P: first environment omits n, second contains own n with empty string; no synthetic `undefined` or `n=` for unset. Handler output need not be formatted into a new shell protocol. |
| H11 / F03 presence | `declare -r n; declare n=v; unset n; declare -p n` | P: statuses0,1,1,0; out `declare -r n\n`; readonly unset binding survives both failures. |
| H12 / F03 presence | `declare __proto__=p constructor=c toString=t; declare -p __proto__ constructor toString` | P: status0; exact three ordinary scalar records in requested order; prototypes unchanged, own-key lookup only. |
| H13 / F04 arrays | `declare -a args; args+=(one 'two words'); typeset -p args` | P: statuses0; out `declare -a args=([0]='one' [1]='two words')\n`; ordinary useful build/append/inspect workflow. |
| H14 / F04 arrays | `declare a=seed; declare -a a; declare a+=tail; declare -p a` | P: statuses0; out `declare -a a=([0]='seedtail')\n`; conversion preserves scalar zero and append is not whole-array stringify. |
| H15 / F04 arrays | `declare -a a=([9]='' [2]=two); declare a=zero; declare -p a` | P: statuses0; out `declare -a a=([0]='zero' [2]='two' [9]='')\n`; sparse slots preserved, sorted numerically. |
| H16 / F04 arrays | `declare -a a=([7]=v); unset 'a[7]'; declare -p a` | P: statuses0; out `declare -a a=()\n`; kind survives final member removal. Re-read that text in fresh state: stage-one gap must be closed, not waived. |
| H17 / F05 attributes | `declare -x n=v; declare +x -a n; declare -p n` | D(R1): proposed conversion1 retaining scalar/export; sequential interpretation would clear export and convert0. Freeze exact choice and downstream record. |
| H18 / F05 attributes | `declare -ar a=(v); declare a=w; declare -p a` | P: statuses0,1,0; out `declare -ar a=([0]='v')\n`; readonly applies to whole initialized binding. |
| H19 / F05 attributes | `declare -a PATH; declare -a DIRSTACK; declare -p DIRSTACK` | P: statuses1,0,0; PATH unchanged; out `declare -a DIRSTACK=()\n`; no invented extra control name. |
| H20 / F05 attributes | `unset OPTIND; declare OPTIND='1+1'; declare -p OPTIND`; separately `unset PWD; declare PWD; declare -p PWD` | D(R4): original values/presence are inspectable; fresh replay changes integer OPTIND or retains initialized PWD. Explicitly exclude these replay claims or design exact state restoration. |
| H21 / F06 locals | `n=outer; f(){ declare n=inner; unset n; declare -p n; }; f; declare -p n` | D(R2): inner query0/unset record versus1/empty; outer query0/`declare -- n='outer'\n` in either choice; outer never exposed inside f by unset. |
| H22 / F06 locals | `declare -a a=([7]=outer); f(){ declare a=inner; declare -p a; return 7; }; f; declare -p a` | P: f7; out inner `declare -a a=([0]='inner')\n`, then outer `declare -a a=([7]='outer')\n`; typed-local choice, not GNU proof. |
| H23 / F06 locals | VFS `/local-declare` text `declare n; declare -r n=inner; return 0\n`; source `declare -x n=outer; f(){ source /local-declare; declare -p n; }; f; declare -p n` | P: final0/out `declare -rx n='inner'\ndeclare -x n='outer'\n`; source return does not pop function locals; save once, restore value/export and remove local readonly. |
| H24 / F06 locals | `n=outer; f(){ declare n=inner; g; declare -p n; }; g(){ unset n; }; f; declare -p n` | D(R2): explicitly freeze caller-local unset behavior; distinguish own-frame tombstone from caller-frame visibility. Never infer it from H21 alone. |
| H25 / F07 parser | `command -- declare -a a=([2]='v v'); command -- typeset -p a` | P: status0/out `declare -a a=([2]='v v')\n`; supported literal command prefix, no extra builtin dispatcher. |
| H26 / F07 parser | Literal invoke argv `['declare','a=(x)']`; separately source `declare 'a=(x)'` | P: both scalar `(x)`, status0, no compound metadata/eval; subsequent query prints `declare -- a='(x)'\n`. |
| H27 / F07 parser | Three parse-only strings: `cmd=declare; $cmd -a a=(x)`, `'declare' -a a=(x)`, `builtin declare -a a=(x)` | D(R3): freeze source syntax2 for non-admitted compound contexts; no dynamic compound recognition. Scalar expanded-name dispatch is a separate supported-runtime question, not proof for compounds. |
| H28 / F07 parser | VFS `/case.sh` exact text `: > /early\nif false; then declare -a a[-1]=x; fi\n`; run via existing virtual script-file route | C/P: syntax2/out empty, `/early` absent even for dead branch. Pair public parseShell rejection with file preflight; do not execute an earlier unit first. |
| H29 / F08 effects | `declare -r n=old; declare n=${seen:=rhs}; declare -p seen n` | P: assignment1, seen exists as rhs; query outputs seen then unchanged readonly n; eager scalar effects survive. |
| H30 / F08 effects | `declare -ar a=(old); declare a=(${seen:=rhs}); declare -p seen a` | P: compound preparation1 before its RHS; seen absent; query1 prints only readonly a. Distinct from H29, not global rollback. |
| H31 / F08 effects | `declare good=one 'bad-name'=two later=three; declare -p good later` | P: mutation1, both good and later committed; query0 has their two records in requested order; bad name absent. |
| H32 / F08 effects | `declare -a a=([2147483647]=${seen:=first} next)` | P: statically certain cursor overflow1, out empty, a and seen absent. Failure is domain admission, not arithmetic evaluation or sparse dense allocation. |
| H33 / F09 quoting | Single scalar n with exact value `O'Brien`, then named query | P: status0/out `declare -- n='O'\''Brien'\n`; public reader reconstructs all7 code units; no extra newline in value. |
| H34 / F09 quoting | Scalar n has exact code units `[65,10,66,9,127,67]` | P: out `declare -- n='A'$'\x0a''B'$'\x09'$'\x7f''C'\n`; one physical LF, exact control values on public source and VFS replay. |
| H35 / F09 quoting | Scalar n contains exact units `[36,40,98,111,111,109,41,59,92,96]` (substitution-looking text, backslash, backtick) | P: output is ASCII prefix `declare -- n='`, those ten units unchanged, then apostrophe/LF; no invocation named boom or file effects; no eval replay harness. |
| H36 / F09 quoting | Scalar n: exactly1006 ASCII a, then U+0065 U+0301 U+1F642 U+FFFD | P: literal Unicode inside single quotes, no normalization; query/replay0 and exact units. With14-byte record prefix, astral UTF-8 starts at byte offset1023, crossing proposed1024-byte chunks; never independently encode surrogate halves. |
| H37 / F10 encodings | Fixture n has exact JS units `[65,0,66]`, supplied through an authorized internal value fixture, not constructor env | D(R4): recommended query1/out empty before record bytes; source/constructor routes that reject NUL are separate. No `\x00` native fidelity claim. |
| H38 / F10 encodings | Two isolated value fixtures `[0xD800]` and `[0xDC00]`; query each | D(R4): recommended1/out empty per record; never silently emit U+FFFD. U+FFFD itself remains valid (H36). |
| H39 / F10 encodings | `/bad.sh` bytes `[0x3A,0x0A,0xC3,0x28]`; virtual script-file route | C:126/out empty before execution; malformed UTF-8 refusal, not proof of lossless handling by other nonfatal byte-to-text paths. |
| H40 / F10 encodings | Scalars a=`ok`, b units `[0]`, c=`later`; `declare -p a b c` | D(R4): status1 and only a's completed record guaranteed by proposed prefix semantics; choose continue-with-c versus stop. No partial b record; no state mutation. |
| H41 / F11 accounting | Read-only ledger arithmetic fixture B=64,F=4; then internal already-admitted listing activation with F=0 | C/P: caps `[4,4,64,512,2560,32,3072]`; not proof that listing fits. Internal zero-capacity reserve refuses without output; public F=0 may fail argv expansion earlier, so do not pin its result as declaration1. Tentative tickets remain atomic. |
| H42 / F11 accounting | B=4096,F=32; 33 empty declared ordinary names `n00` through `n32`, attempted in order | P: freeze role-derived first refusal before runtime; no presumed exact threshold or success. Bound empty-name/wrapper metadata; prior successful operands retained; no unbounded enumeration to discover failure. |
| H43 / F11 accounting | One value: exactly1024 alternating apostrophe/LF pairs; two attempted named listings under B=65536,F=4096 | P: finite fragments, both scan passes and allocations precharged; no per-character unbounded admissions or quadratic concatenation. Record ledger deltas and refusal point, not guessed success. |
| H44 / F11 accounting | `n=v; declare -p n; declare -p n \| sink` with explicit bounded sink fixture; inject refusal at second listing's first fresh reserve after snapshot admission | C/P: earlier committed counters remain cumulative; refused reserve changes no counters/tickets; live releases only; pipeline clone shares ledger. Capture stage statuses, not just final pipeline status. |
| H45 / F12 lifecycle | Output sink pauses its first admitted record write; caller aborts with a frozen non-Error object; release cooperative write and registered cleanup | C: preserve exact abort reason, await registered/root-owned cleanup, no new output admissions, no declaration state mutation; existing prefix bytes may remain. |
| H46 / F12 lifecycle | Borrowed input chunks reuse one Buffer for bytes `61`, then `62`; retained fragments feed a declaration-value fixture; output-close called twice while a sibling file operation remains admitted | C: retained input is owned before advance/finalization; close shares completion and does not cancel sibling work. Opaque never-settling input is not a resource the contract suddenly requires draining. |
| H47 / F12 lifecycle | Internal metadata-admission fixture: five variants—cross-realm exact own-data record, hole in entries, accessor in name, extra key, serialized AST clone without private metadata | C/P: no prototype-identity admission shortcut; reject four malformed/unauthenticated variants without coercion/getter execution where that validator applies. First variant's data validity is distinct from private provenance. No public AST execution API or hostile-host safety inferred. |
| H48 / F12 lifecycle | Function declares a local, then a transparent registered handler invokes `typeset -p n` with replaceEnv true and an empty map; separately inject an escaping throw at the admitted handler boundary before function return | C/P: invoke inherits intended clone state without exporting n or mutating parent, clears function frames as current architecture; restoration/cleanup occurs on throw with exact reason. Freeze concrete handler and sink fixtures later; no scalar-state/array certification here. |

## Bounded additions needed before future runtime work

The 48 IDs are fixed. Rows that need a handler/sink/internal admission injection
remain recipes, not runnable tests; a future harness must bind its own source and
derive admissible numeric capacity thresholds without changing these questions.
H36 fixes the proposed1024-byte boundary; if that design changes, retain the
original vector and explicitly version any additional boundary fixture. For H47
do not create a new public AST entrypoint solely to run the case.
If only internal metadata accepts the relevant shape, label that coverage internal.
Mechanical success cannot be substituted for semantic acceptance or vice versa.

Future proof also needs finite route coverage without adding unrelated language
features: function ordinary return/throw/abort, source inside a local frame,
pipeline/substitution isolation, actual registry invoke, and script-file replay.
These are coverage requirements for mapping the sealed rows to the implementation,
not extra counted rows or permission to run anything now. Exact mappings and
uncovered routes must be disclosed at the next freeze rather than called passes.
