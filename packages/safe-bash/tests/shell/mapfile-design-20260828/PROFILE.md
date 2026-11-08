# Proposed bounded builtin profile

Labels: **M** = GNU manual; **C** = static reading of existing GNU5.3 C source;
**R** = pinned accepted virtual source; **G** = root-ratified array policy,
implementation not yet accepted; **P** = recommendation needing ROOT selection;
**O** = future neutral observation. No C/R/G/P/O item is a new native pass.
Hashes and immutable source ranges are in `SOURCE-BINDINGS.json`.

## 1. Documented baseline and source-only ambiguities

**M:** `mapfile` loads indexed elements, defaults to MAPFILE, supports limit0 as
all rows, skip, explicit origin, delimiter selection/empty delimiter for NUL,
delimiter removal and descriptor selection. Omitted origin clears the array.
Callbacks receive index and row before assignment; default quantum is5000.
`readarray` is an alias. Invalid arguments or unassignable/non-indexed targets
are errors. EOF itself is not the failure status of ordinary `read`.

**C:** mapfile.def parses options before target lookup, uses the first delimiter
byte, validates numeric options through unsigned-range tests, and clears through
common.c before skip/read. Explicit origin disables clearing. Each read is chopped,
optional callback evaluated, then assigned; callback return is not tested there.
Only the first remaining target operand is selected by this source. zgetline
reads byte records including NUL, while later C-string handling suggests truncation
at an internal NUL. These are source interpretations, not executable guarantees.
The32 sealed O rows cover these ambiguities without expected results.

Primary references (read, not executed):

```
https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html
https://www.gnu.org/software/bash/manual/html_node/Arrays.html
GNU bash-5.3/doc/bashref.texi:5412
GNU bash-5.3/builtins/mapfile.def:137
GNU bash-5.3/builtins/common.c:988
GNU bash-5.3/lib/sh/zgetline.c:64
```

Search returned the primary GNU manual entries; direct page retrieval returned
no content in this tool session. The existing local manual matching the prior
f3d37d57 hash supplied the full section. The source archive/member authentication
in the binding record is a READ-ONLY source check, not fresh build/signature or
native execution. No GNU source is vendored into this packet.

## 2. Grammar and builtin identity — P

Both names share one implementation using the actual invoked command name in
diagnostics. They are ordinary, non-special shell builtins: discovery via type
and command, function precedence/bypass and existing prefix/redirection phases
remain. No registry/plugin substitute, new Shell or environment serialization.

Proposed first profile:

```
mapfile|readarray [-t] [-n count] [-s count] [-O origin] [-d delimiter] [--] [name]
```

- Parse leading short options, bundled flags and attached/separate option
  arguments left-to-right; last duplicate value wins. Stop at first operand.
  `--` ends options; literal `-` then fails identifier validation. Empty `-d`
  must remain an actual consumed argument, not be mistaken for a missing one.
- No operand selects MAPFILE. One target is an ASCII shell identifier, never an
  element reference or expression. Recommendation: reject extra operands before
  target effects, explicitly divergent if the C-source first-operand behavior
  is confirmed. ROOT may instead select native first-operand behavior.
  Valid JavaScript-looking names such as `__proto__` and `constructor` remain
  ordinary variable names; private storage must not interpret prototype keys.
- Counts/skip: unsigned ASCII decimal, leading zeros accepted;0..4294967295.
  `-n0` means until EOF **subject to actual budgets**, not a no-op. `-s0` skips
  nothing. Origin0..2147483647 is aligned with G's literal-index domain; `-O0`
  still disables clearing. No hex, sign, whitespace or arithmetic coercion in
  this recommendation; source indicates some native numeric forms may differ.
- Accept `-d ''` (NUL); otherwise first ASCII byte only, ignoring remaining
  characters as specified by first-delimiter semantics. Refuse a non-ASCII first
  character, rather than split a UTF8 character and imply byte-string parity.
- Recognize but refuse `-C`, `-c` and **every** `-u`, including0, with status2
  before target mutation/next(). They must not be silently ignored. `-c` alone
  can be a native no-op; that is a disclosed initial-profile gap. Unknown option,
  missing option argument, extra operand or unsupported help form:2. Numeric
  domain/syntax error:1; invalid/empty target:1 (empty target may differ natively).
  Final exact grammar/status choices await ROOT and O observations.

Already-expanded arguments retain existing word-expansion effects. Revalidate
literal host/middleware argv without re-expansion: argc including command<=F;
each command/argument UTF8<=B and no NUL. Reuse the existing per-word admission,
not aggregate-expansion or byte-as-command accounting. For malformed host input,
preserve existing invoke admission rather than inventing a global type contract.

## 3. Target phases and partial publication — P with G requirements

Order at builtin entry (generic expansion/prefix/redirection may already occur):

1. Check effective caller/child cancellation. Validate all option grammar and
   supported features, numeric bounds, target spelling. No builtin data pulls.
2. Resolve the dynamically visible binding with a typed private watch. Reject
   readonly first; reject conversion of any G control name or exported scalar/
   unset binding, and any unsupported binding kind. No unchecked unset/attribute
   removal. Absent/scalar-unset/scalar-empty/indexed-empty remain distinct.
3. Admit target creation/conversion, optional clear, saved owners, identity/epoch
   tickets and prepaid cleanup. Recheck cancellation, readonly then stale watch
   after the last await; publish synchronously. Failure here changes no target.
4. Omitted origin publishes indexed-empty before skip/first read, even on empty
   input. Explicit origin preserves existing members; an eligible scalar converts
   with its element0 preserved, and an absent/local-unset target becomes indexed-
   empty. This conversion is an observable target-entry effect, not deferred to
   the first row. Native O controls must confirm the intended distinctions.
5. Skip complete physical records without decoding/storing them. Skip may reach
   EOF successfully. Skipped byte scans, pulls and counters are bounded work.
6. Obtain one physical record. EOF without any bytes yields no element; a final
   unterminated nonempty physical record is an element, even if its representable
   string becomes empty. Prepare its private value/index write, recheck cancellation
   and readonly-before-stale, publish exactly once, advance index/count. No whole-
   input staging and no rollback of completed clear, rows or consumed bytes.
7. Stop immediately after `-n` committed rows: do not peek for another record or
   close the shared cursor. Exact EOF with unlimited count succeeds. On a later
   error retain prior rows; the current uncommitted row is not inserted. No retry
   after stale binding or cancellation.

G excludes exactly PATH/PWD/OLDPWD/HOME/CDPATH/IFS/OPTIND/OPTERR/OPTARG/REPLY/LANG/
LC_ALL/LC_CTYPE from conversion. Reject before read, unlike scalar `read` which
can consume before its write failure. Whole unset is not a mapfile workaround for
control names; they remain excluded by name. Existing exported prefix targeting
the same name therefore refuses conversion after existing prefix setup, with
that setup's normal restoration. No new blanket LC rule or DIRSTACK special case.

For `-O2147483647` and multiple rows: never form an out-of-domain numeric sentinel.
After the last valid write mark index exhaustion. Recommended boundary: if -n
does not already stop, read the next record to distinguish EOF; EOF succeeds,
a present row produces index failure1 after consuming that row, without inserting
it. Alternative is conservative pre-read refusal even on EOF; ROOT must select.
Do not reject solely because a large requested count might exceed index range
when actual input is shorter. Observation rows are finite, never large loops.

Locals use G's actual typed save/restore and absence shadows. `local A` can expose
an eligible local unset binding; mapfile fills it and function exit restores the
complete saved outer kind/value/attributes using prepaid restoration. Exporting
an array and conversion of an exported scalar stay refused under G; do not copy
native exported-array behavior into the foundation. Same-value/ABA typed writes
supersede middleware overlays as ratified; no general scalar-middleware repair.

## 4. Byte records, decoding and input ownership

**R:** InputCursor.take owns a copy of each producer chunk before advancing again
(input.ts:32), serializes consume operations (19), stores unread remainder, and
tracks the outstanding read. ShellInput wrapping ShellInput shares that cursor
and is a borrowed view (84); its close does not return the parent iterator (238).
The root creates its input view before command dispatch (shell.ts:234), so a
promise of **zero root iterator acquisition** on bad builtin options is false.
The correct proposed bound is no additional builtin acquisition/next/read/target
effect after dispatch rejects; existing root setup and redirects remain.

**R, reason not to reuse line unchanged:** `line` reports only value/escaped/
terminated. Empty EOF and a NUL-only partial row can collapse to the same result.
The plain path uses replacement decoding and NUL removal; the bounded path uses
fatal UTF8 decoding and NUL removal. Both omit the delimiter; neither is a new
array-ledger-owned record API. A mapfile implementation must not change read's
existing profiles while adding its own framing.

**P private operation:** on the existing cursor, a record-granular exclusive
consume lease yields an owned record or explicit empty EOF. Required information:
raw record presence/byte count, delimiter seen, and admitted content ownership.
It must return the unused chunk suffix to that SAME cursor before releasing the
lease, including failure paths. No independent iterator or global WeakMap of
raw sources. No lease held across a future callback or user code. Concurrent
commands sharing one stream may serialize/interleave at record boundaries; this
does not promise a transaction over an entire file or fair service of infinite
reads. Parent/sibling sequential consumers see the remainder after -n exactly.

Proposed byte profile, awaiting O/ROOT:

- Delimiter recognition happens on bytes before decoding, across any chunk split.
  Backslashes and IFS have no special meaning. Preserve the terminator unless -t;
  remove exactly one encountered terminator, not arbitrary trailing whitespace.
  CR is ordinary data for newline framing. Adjacent delimiters produce empty
  content records, with terminators retained when applicable. No extra element
  after a final delimiter. Empty input yields no row, not one empty row.
- Empty delimiter selects byte0. NUL terminates but cannot be stored in shell
  strings; -t does not make a NUL representable. For a nonzero delimiter, static
  GNU C-source reading suggests store the prefix before the first embedded NUL
  while still consuming the remainder of that physical record. **Do not silently
  substitute read's NUL deletion.** Confirm through O before choosing this rule;
  explicit NUL refusal is an alternative but a visible functionality gap.
- Decode representable payload as UTF8 only. Recommendation: completed malformed
  row fails1 after record consumption, earlier rows remain; valid skipped rows
  and invalid skipped bytes alike need no decoder. Decode no bytes discarded after
  a NUL-prefix cutoff. UTF8 decoder carry is per record, not across a delimiter.
  No native arbitrary-byte/locale or Unicode normalization claim. No encoding
  replacement quietly claimed equivalent to native byte-preserving strings.
- Source-buffer reuse tests must prove retained strings/chunks survive next and
  return. InputCursor's existing copy is E_input, not retrospectively private
  admission; new retained copies and carry are private. An opaque source can
  supply one huge chunk; this design cannot bound that existing E allocation/RSS.

If middleware replaces stdin with a raw ByteSource, ownership/adaptation must be
resolved at the invocation/input boundary, not cached globally in the builtin.
Normally context.stdin already is ShellInput. An owned replacement may be closed
by its existing invocation scope; a borrowed existing view must not be closed on
normal -n completion. Future source review must bind this path precisely before
claiming remainder across raw replacement middleware; a public API is not needed.

Accepted runtime also has a PRIVATE virtual descriptor map (1112/1256). That is
not host FD authority and is not exposed in CommandContext. The proposed initial
-u refusal is a deliberate scope choice, not a claim that virtual descriptors
could never be supported. ROOT can separately select a virtual-descriptor-only
design. Same-source raw middleware reuse must obtain a canonical view from its
actual invocation owner before a future complete remainder claim; a throwaway
builtin wrapper or global source-object cache is not an adequate substitute.

## 5. Budget and private bridge requirements

Use the same existing Budget and cancellation boundary. One normal command tick
is already admitted at runtime.ts:1119 and yields every128 commands. Do not add
per-byte command/loop charges, reset counters, create another Budget or introduce
a timeout race. Keep existing maxOutputBytes/error mapping for diagnostics; it
is not a new mapfile input-byte cap. Existing read's use of that limit is unchanged.

G4A explicitly distinguishes
`private logical storage + E_input + E_post-transfer-command-formatting`.
The existing cursor chunk copy and caller data belong to E_input. Every NEW
mapfile record buffer/carry/chunk vector/flat row/watch/staged binding belongs to
the shared array ledger, even before a target write. Calling it input does not
exempt a new array-owned allocation. No new registry formatting hooks: existing
registered handlers after admitted argv transfer remain E under492e65ba.

G caps remain B=maxExpansionBytes,F=maxExpansionFields: live wrappersF, private
Map slotsF (including watches), payloadB, metadata128F, cumulative bytes8B+512F,
cumulative slots8F, work32B+256F. Keep lazy representability, generation/version/
epoch ticket admission, then the seven counters atomically; failed reservation
changes nothing, cumulative charges never refund, cleanup is prepaid. Do not
claim F usable rows or B usable data independently of overlapping owners.

P accounting checklist: reserve before each NEW byte copy; charge per scanned
input byte including delimiter/NUL/discarded bytes, per empty pull and record,
per UTF16 unit validation and per token/slot/copy/release step. Carry one128-unit
checkpoint cadence through new cooperative helpers; before/after flat decoder/
join primitives check cancellation. Reserve worst-case3x byte input decoded
UTF8 accounting (checked arithmetic), overlap carry/input/decoded/old target,
then refund only unused LIVE reservation. Count transfer versus independent
retention correctly; no value-equality token sharing. Skip scanning requires
work credits but no whole skipped-row accumulation. At EOF/-n/failure/abort drain
prepaid temporary owners, never erase published array elements. No RSS bound,
opaque-source preemption, flat-engine preemption or global aggregate deadline.

Proposed diagnostics: called-builtin prefix, at most65792 UTF8 bytes of owned
payload, excluding the existing shell-origin prefix/newline; reserve12 bytes for
` [truncated]`, cut at a scalar boundary without first assembling unbounded text.
Await the existing sink. This cap is a P choice, not a currently installed limit.

## 6. State, errors and lifecycle

| Execution route | Target state / input / ledger requirement |
| --- | --- |
| One top-level exec, braces, functions, source | Same dynamic state; local restoration per G. Same cursor unless redirected. |
| Subshell / pipeline stage / substitution | Independent typed state snapshot, no mutable array alias; ordinary pipeline does not fill parent's array. Existing owned/borrowed input and consumer-close topology remain. |
| context.invoke | Child typed clone, not a parent mutation channel; omitted stdin borrows, replacement creates invocation-owned view; effective child cancellation only. Shared private ledger and Budget, not new capacity. |
| Separate Shell.exec / interpreted new process | Fresh process bindings/ledger at public exec as G; internal descendants share invocation ledger. Do not serialize arrays into env to cross a process boundary. |

Actual R clone construction is runtime.ts:281, pipeline clone/input1020/1039,
invoke2234, function1557, root shell.ts:234. These currently clone scalar state,
getopts, stack and dotglob, not implemented arrays. G must supply accepted typed
clone/retirement behavior first. A future callback cannot be context.invoke:
that is a child clone, whereas native callback evaluation can affect current
state and arbitrary shell code. Deferral avoids unsafe quoting/reparse semantics,
reentrant input leases, target invalidation and callback budget/flow ambiguity.

Cancellation must be checked before pulls, after awaits, at checkpoints and
immediately before publication. Preserve actual caller/local origin, falsy/equal
reasons, and the accepted escaping-error versus mapped handler-status distinction.
Do not convert all errors to usage1/2 or treat numeric nonzero as rejection.
Ordinary producer/decoding failures follow existing runtime diagnostics/status
policy; ShellLimitError and effective cancellation preserve existing identities.
Keep prior clear/rows/consumption on failure, no rollback/retry. Drain cooperative
registered ownership before public settlement without prematurely closing parent
stdin. Unknown opaque pending reads retain the existing documented limitation;
do not invent a guaranteed join of ignored aborts. Cleanup-only failure must not
be hidden behind a numeric success; existing root/child selection remains intact.

## 7. Minimal future PRIVATE needs; no interface request now

Required capabilities, not names or an implemented signature:

1. Resolve/watch visible typed binding and attributes with charged lifetime;
   inspect kind/control/export/readonly without converting it.
2. Prepare target-entry clear/convert and individual indexed-record publication
   using ledger-owned tokens; final checked identity/readonly/cancel validation,
   synchronous publication, and fresh observation after our own successful write.
3. Borrow the invocation's shared ledger/checkpoint and prepaid release owners;
   no fresh ledger on each row, function, pipeline or invoke.
4. Existing ShellInput cursor's private record-presence/remainder/lease operation,
   accepting admitted record-storage ownership, separate from read profiles.

Likely future write set: `src/shell/runtime.ts` dispatch/discovery/integration,
`src/shell/input.ts` private record operation, and a new private
`src/shell/mapfile.ts` parser/scanner only if useful. Reuse the accepted array
foundation's actual private helpers; exact names/paths remain Faraday's until
accepted. No present request to alter arrays/ledger/bindings, shell.ts, parser,
contracts, root exports/package or public limits. If accepted helpers cannot
provide these capabilities, report the precise gap before expanding ownership.

Required different-review holdouts include zero-pull rejected flags/targets,
EOF-empty versus NUL-only row, skip/limit remainder through read and invoked
consumers, Buffer reuse, rejected-read/abort after earlier writes, readonly/ABA
across awaited input, local typed restoration, exported/control exclusions,
pipeline parent isolation, shared-ledger exhaustion, prepaid cleanup and exact
diagnostic/sink/caller behavior. These are future requirements, not tests run now.
