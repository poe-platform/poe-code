# `[[ =~ ]]`: independent bounded feasibility/design

2026-08-29. SOURCE/DATA only. **Feasible as a substantial bounded matcher extension,
not a flag flip or JS-RegExp substitution. No implementation is authorized.**
All32 proposed reference programs and8 host protocols are UNRUN. Existing native
37/40, accepted Unit3, pending Unit4 and other accepted features are unchanged.

## Frozen inspection, not a new composition certification

Accepted source `7a5c620005fb04518d44bb284f4e99284e4a7c33`, selected
`74dfe69135a3fc5ba89396b20dd32d9c9daae131`, full954
`46a845f6c12933308aef11dbbf8f861afcc38ff9973b83bcccea13c3329c0a09`.
Pending Unit4 is runtime commit `9bb91c370a0672687399c0a9da4ce1b161f79615`,
runtime SHA256 `b14268b38f9a156c45cae80e6871a646086746654803c2b05eb0a7ec7438443b`,
derived `37e793ce6dce48a958030e7cc86fa8315d0b112e`, not accepted or executed here.
The inspected16 Unit3 product blobs match the selected SOURCE-v4 manifest;
the seventeenth product observation is Unit4's different runtime. This is a
selected-source audit, not fresh293-input/full-package reconstruction.

`SOURCE-BINDINGS.json` records exact blobs, hashes, sizes and source roles.
The private GNU5.3.15 source root was already retained by reference work, not
downloaded/extracted/built here. Six C/parser files were checked against the authenticated
final source inventory from the `41d488`/`efcd8b49` reference lineage before reading.
No Bash executable or libc behavior was tested. No private engine was accessed.

## What is reusable, and what is not

| Frozen source | Actual mechanism / consequence |
| --- | --- |
| `src/commands/expr/bre-worker.ts:42–93,189–227,282–334` | Parser supports32 numbered groups, compiles two save slots per group, clones all capture slots at branch splits. Only its public result exposes group1. It is **not internally a one-group matcher**. |
| Same file:284–296,330–334 | Starts only at input0; chooses a larger overall end, retaining first traversal on ties. No POSIX subexpression tie comparator. Exporting all slots alone is incorrect. |
| Same file:161–186,290–292 | Nullable repetition/backreference restriction and program-only zero-progress visited guard are BRE-profile mechanisms, not proof of full ERE repeated-capture semantics. |
| Same file:18–33,252–280 | Explicit cumulative work/allocation/state/node limits; byte or fatal UTF8-scalar symbols with byte boundaries; Worker-only guard. Useful foundations, not an RSS bound. |
| `src/commands/regex-execution/protocol.ts:59–84,124–153` | `expr-match` reply has overall plus one capture; overall must begin0. New operation/reply validation required, not weakening the existing expr contract. |
| `src/commands/regex-execution/matching.ts:36–55` | Existing search path uses JS RegExp. Its dialect, alternative order and capture choices cannot stand in for POSIX. |
| `src/commands/regex-execution/client.ts:28–52,131–198,264–297` | Existing exact Worker entry, queue/timeout/session/retirement machinery. Register cleanup before opening/acquiring. Reuse lifecycle, not a fake grep invocation. |
| `src/shell/parser.ts:74,305–310,617–654` | Conditional AST already represents `=~` with original Word operands and a regex lexical mode. No new public AST union required for the admitted syntax; lexical bracket/group delimiters still need holdouts. |
| `src/shell/conditional.ts:133–176` | Evaluates visited LHS then RHS once and refuses reached `=~`; skipped branches never reach it. Preserve this sequencing. |
| `src/shell/runtime.ts:1523,3741–3757` | Current glob-pattern escaping omits ERE metacharacters such as dot, dollar and braces. Joined RHS loses literal-fragment provenance. Add a private ERE fragment mode, not a regex over the already flattened string. |
| `src/shell/runtime.ts:1238–1322`; `arrays/{bindings,state,ledger}.ts` | Staged typed bindings, watches, pre-admitted names/tickets, readonly-before-stale validation, atomic publication and awaited retirement exist. `arrayAssignment` also re-expands syntax and rejects exported/control targets: do not call it with fabricated source to publish captures. |

Static discriminator, NOT a new native or product result: an ERE-mode adaptation
of the current traversal on `(a|aa)(a?)` against `aa` can keep `(a,a)` because its
later `(aa,empty)` alternative ties on total length. POSIX's overall-then-subpattern
priority requires a different selector. This is an extension blocker, not a claim
that accepted expr's explicitly narrower profile has newly failed.

## Normative references and important scope conflict

Primary references are in `REFERENCES.json`. POSIX2017 section9 defines earliest
start, longest whole match, then subpattern priorities; participation in an empty
match differs from nonparticipation. Its rationale explains context-dependent
submatches. Capture histories/reset rules under repetition need explicit proof,
not branch order or a vector comparator assumed correct for every repetition.

The Bash manual describes substring search, quoting of literal portions,
status2 for invalid regex and captures0..N. Its global-only BASH_REMATCH wording
conflicts with the inspected GNU5.3.15 implementation and maintainer's5.3 release
notes: local BASH_REMATCH is now supported. Source chain:
`lib/sh/shmatch.c:79–144` -> `builtins/common.c:988–1014` ->
`arrayfunc.c:454–501` uses ordinary variable lookup/conversion and readonly checks.
This replaces the old global-unbind/create sequence, retained under `#if 0`.
**ROOT must choose pinned5.3 visible binding versus historical global-only policy.**
Recommend pinned5.3: ordinary global storage when no local shadows it, ordinary
local restoration when one does. Do not silently implement global bypass.

The source compiles with REG_EXTENDED, optionally REG_ICASE, not REG_NEWLINE,
then delegates to the build's regex library. A GNU Bash version does not establish
GNU-libc regex behavior on Darwin. New native observations require separate GO
and actual binary/libc/profile binding. POSIX2024 adds features beyond the selected
2017 baseline; this proposal does not silently promise its shortest-match modifiers.

## Recommended bounded first profile — decisions pending ROOT

1. C/POSIX locale, ASCII subject/pattern first; no ambient locale. Add a separately
   named UTF8-scalar extension only after ROOT chooses it. C byte matches can split
   UTF8 sequences, while shell arrays store JS strings: replacement decoding would
   corrupt captures. Reject non-ASCII/NUL/lone-surrogate input before encoding in
   the first profile; this is an explicit compatibility gap, not native behavior.
   Resolve LC_CTYPE and LC_COLLATE independently from own-key virtual LC_ALL,
   category and LANG values, with an explicit C fallback; the current single
   conditional collation string is not sufficient for regex character semantics.
   Reject unsupported effective locales rather than consulting host Intl/libc.
   Existing refusal of `shopt nocasematch` remains; this does not add that option.
2. Admit literals, dot, anchors, grouping, alternation, `* + ? {m} {m,} {m,n}`,
   ordinary/negated bracket lists/ranges and the12 existing ASCII classes. Whole
   subject search, not whole-string matching; anchors refer to original endpoints,
   not each suffix. With the source's no-REG_NEWLINE flag, newline is not secretly
   line-delimited. Empty matches are real matches, including end-of-input.
3. Return every group in the admitted grammar, including overall0, unambiguously
   distinguishing nonparticipation from a zero-length span internally. Publish
   every index0..N on success (empty strings for unmatched captures, pending pinned
   confirmation), not a one-group limit or dropped trailing empties. Group cap32
   is an explicit grammar boundary; cap excess is never silent truncation.
4. Refuse reached ERE backreferences initially (BRE support does not establish an
   ERE extension), lookaround, named/noncapturing groups, collating/equivalence
   elements, locale-dependent non-ASCII classes and ambiguous extension escapes.
   Do not mark quoted lookalikes unsupported. Refuse stacked/shortest modifiers in
   this first profile. POSIX-undefined constructs require a documented choice,
   not invented native goldens.
5. Captured nullable repetition is the highest algorithmic risk. Recommend first
   refusing a repetition with maximum>1 whose nullable operand contains captures,
   until reset/history/zero-progress proof is supplied. Ordinary nonnullable
   captured repetition must still implement last-iteration/nested participation
   correctly; `(a(b)?)+` cannot reuse stale inner capture state by assumption.
   Refusal is profile2, not false. This is a useful subset with complete captures,
   **not full POSIX ERE**. ROOT may instead fund the larger tagged-history engine.

## Matcher and transport design

Prefer an additive `shell-ere` operation in the existing qualified RegexExecutor:
new private `src/commands/regex-execution/ere/{syntax,matcher}.ts`, additive
`protocol.ts`/`client.ts`/`worker.ts` changes, private
`src/shell/ere.ts`, and focused `conditional.ts`/`runtime.ts` integration.
No root exports, public command, registry/default count, dependency or new AST
variant. A lexical repair to `parser.ts` would need a reproduced admitted-pattern
counterexample and separate scope approval, not speculative parser expansion.

Lexing qualification: GNU `parse.y:5439–5462` special-cases regex parentheses and
alternation while still reading a shell word; it does not make arbitrary shell
delimiters literal. Accepted `parser.ts:305–310` also has delimiter/parenthesis
rules. Patterns supplied via an unquoted variable and direct unquoted patterns
must be distinguished. Do not invent a native success for a raw `[ ]` or `[)]`
fixture merely because its contents are valid ERE when passed as data.

Reuse the bounded VM design/ASCII class tables, but leave expr's entry/result/
tie behavior unchanged. A shared extraction from `expr/bre-worker.ts` is optional
and separately scoped; avoiding it initially reduces regression exposure.
Extend syntax directly for ERE rather than translating by backslash replacement.
Preserve `{text,literal}` fragment provenance through expansion and perform
context-aware literal admission, including brackets/backslashes. A blanket glob
escape or `RegExp.escape` equivalent is not a proof of Bash quote-inside-bracket
behavior; ambiguous combinations stay a source/reference holdout, not a guessed
golden. No serialization/cloning promise for existing private quote metadata is added.
New reply: exact own-data `{matched, groupCount, spans, steps, allocatedUnits}`,
with spans0..N and null participation, validated finite integer boundaries and
group count before copying. No caller-supplied regexp object, eval or host regex.

Enumerate starts left-to-right with one cumulative budget, retaining all viable
tag histories until the earliest matching start is exhausted. Select maximum
whole end, then the specified capture history ordering; charge comparisons,
cloning, resets and zero-progress tracking. Stopping on the first successful
alternative is wrong. Do not merge states by program counter/input offset alone:
their capture histories differ. A tagged-NFA optimization is a later equivalence
proof, not assumed linear time. Exhaustive bounded search can refuse difficult
inputs; it must not return a provisional shorter match or false on exhaustion.

Worker ownership is viable but not already wired into shell builtins: Runtime
needs a private invocation-root executor/session enrolled in its InvocationScope,
shared by internal descendants, closed before public settlement. Fixed operation
and Worker URLs only; no plugin-name dispatch or borrowing arbitrary host context.
Existing `withRegexSession` accepts CommandContext/CommandResult, so a narrow
runtime lifecycle adapter is required, not a pretend registered command. No
blanket Worker permission. Worker timeout/crash/protocol/retirement failures remain
errors, not status1/no-match. Registration/cleanup preserves caller > execution >
cleanup precedence and raw reason identity, including falsy reasons.

Alternative: a new cooperative main-thread interpreter avoids Worker transport,
but requires awaited checkpoints in parser/compiler/search/tag-comparison loops
and explicit ownership of its async task. Merely removing expr's isMainThread
guard or wrapping its synchronous50M-step loop in a Promise is unacceptable.
This route needs larger loop-scheduling review. A licensed native/WASM regex
dependency or host fallback is outside this zero-dependency proposal. JS RegExp
is lower effort but cannot satisfy the specified matcher/capture semantics.

## Budgets and publication transaction

Proposed private grammar ceilings:4096 compiled/parse nodes,depth64,32 groups,
interval counts0..255. They are regex admission rules, not changes to shell AST
caps. Check before repetition unrolling, token-array growth and history cloning.
Malformed/unsupported/grammar refusal: budgeted diagnostic/status2; exact GNU
diagnostic bytes unclaimed. Real resource exhaustion remains ShellLimitError.

Let B/F be existing maxExpansionBytes/maxExpansionFields; proposal only, not current
behavior: subject<=min(B,1048576), pattern<=min(B,65536), output sum<=B and N+1<=F;
logical work<=min(50000000,32B), cumulative allocation units<=min(4000000,8B+128F),
state admissions<=min(65536,8F). Use checked arithmetic/zero-cap refusal and shared
invocation consumption across starts, retries (none), conditional leaves and
internal invokes. These are logical units, not physical bytes/RSS. ROOT must ratify
the formulas/error mapping; no public Budget knob or resetting parent budgets.
Reserve pretransfer copies, posted buffers, reply vectors and decoded capture
strings before creation. The current client copies arrays before postMessage;
that copy is not magically covered by the worker's Work counter.

Every new array-owned staging/name/watch/snapshot/join/bridge stays within the
existing private ledger; overlapping old/staged arrays are counted. Existing
registered-command formatting after admitted argv transfer remains E_command,
not charged back into private array storage. Worker memory is also a separately
qualified envelope, not a combined-memory promise.

Publication sequence proposed:

1. Expand visited LHS then quote-preserving RHS once; earlier substitutions and
   arithmetic side effects remain. No publication or compilation for skipped RHS.
2. Admit/compile/search under shared bounds. Syntax/profile failure preserves
   prior BASH_REMATCH; this follows compile-before-flush source, not a runtime golden.
3. On a valid match or no-match result, identify the chosen visible/global target
   according to ROOT's scope decision. Capture current watch/epoch **after operand
   effects**, pre-admit tickets/name/complete staged binding, decode exact captures.
   No-match stages an empty indexed binding; success stages0..N. No eval/re-expansion.
4. At publication check caller/control, readonly then stale, with no retry. Publish
   once atomically; await old/staged retirement through registered ownership. Abort,
   resource failure, unexpected error or cleanup failure is not false/syntax2.
   Async concurrent mutation after the snapshot rejects rather than mixing states.
5. Nested/recursive same-state matches replace the relevant binding in execution
   order, not a hidden result stack. Functions restore only real local shadows;
   subshell/command substitution use cloned state; internal invokes share the
   ledger. Current scalar-overlay equality and typed-supersession rules remain.

Readonly needs an explicit choice: inspected5.3 code performs regex work, then
diagnoses an unwritable capture binding without changing the regex result0/1.
Recommend this narrow source-backed special-variable policy with unchanged data;
diagnostic sink/caller failures still propagate. If ROOT instead wants existing
ArrayFailure/status1 for every refused write, label that a project divergence.
Exported scalar BASH_REMATCH is another choice: current array assignment refuses
conversion; recommend initially refuse that profile without altering env or
silently dropping export. Namerefs/associative/integer attributes remain unsupported.

## ROOT decisions needed before code

| ID | Recommended decision / alternative |
| --- | --- |
| D1 | Target inspected5.3 visible/local binding semantics, not stale global-only manual wording; otherwise authorize a dedicated saved-global-frame writer and mark divergence. |
| D2 | ASCII C/POSIX first; explicit Unicode/UTF8-scalar extension later. Byte-exact arbitrary UTF8 captures need a shell string representation decision, not lossy decoding. |
| D3 | Complete0..N captures for the bounded grammar; refuse captured nullable repetition/backrefs initially, or authorize a larger full tagged-history algorithm before claiming those forms. |
| D4 | Add `shell-ere` to existing Worker executor with private root-invocation ownership; no main-thread synchronous reuse and no new public executor options. |
| D5 | Ratify proposed grammar/work/allocation/state ceilings and ShellLimitError mapping; private per-invocation charges do not change existing shell Budget counters. |
| D6 | Match/no-match atomically replace/clear only after successful matching; preserve old data on compile/profile/resource failure. For readonly, diagnose but keep regex status per5.3 source; exported scalar conversion remains explicit refusal initially. |

If D2/D3 exclusions are too narrow for the user's compatibility target, prefer the
larger tagged engine/representation work, not a silently weakened matcher. The
highest-cost work is capture disambiguation plus nullable iterations, followed by
scope/byte-publication rules; Worker wiring and ERE token syntax are secondary.
No schedule, performance superiority, native equality, full Bash or implementation
readiness is claimed. These decisions need not block already accepted features.

## Administrative history and readiness

The first metadata request incorrectly treated derived `37e793ce` as a stored
commit. It refused with Git128 after two successful metadata reads and before
any product import. The captured refusal remains in `captures/metadata`; the
versioned request uses actual stored runtime commit `9bb91c37`, never a derived
tree-object requirement. This is an administrative role correction, not an
integrity failure of the accepted product and not a product test result.
A separate directory-list helper looked for absent `src/internal`; its ENOENT
was tool-context only, with no child/product execution. Neither is erased.

Source captures are retained in this owned namespace but only compact bindings,
design/data and metadata receipts are committed. No archive was created; no
source/private/native process or Worker was run. Git subprocesses here are
repository metadata/publication only, not product-Git/native-oracle cases. The
observed foreign `src/shell/runtime.ts` edit was neither read as an input nor
modified/staged. No instruction plaintext is copied into artifacts.
`inspect-source.mjs` is an administrative reader, not a proposed product/test
executor or an OS-process safety qualification. Its finite reads authenticate
specific blobs; they do not certify the whole selected source or package.
