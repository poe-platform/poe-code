# Directory-stack final design packet

Status: Proposed final bounded profile; ROOT choices R1-R4 await ratification.

Implemented Through: Not applicable to pushd/dirs/popd. The prerequisite is
accepted cd source `4641075df5355a91c83bf5b2cc3a88dfaf1f5153` on the fixed
5137 plus two accepted WebDAV blobs composition, not moving HEAD.

Purpose: define three genuine shell builtins with explicit state ownership,
native partial mutations, and bounded virtual filesystem/output work.

## 1. Authority and boundaries

This additive packet carries forward ROOT-approved ordering, separate-only dirs
flags and private ceilings from `../PROPOSAL.md`/50602367. Original evidence is
immutable. New implementation details below are recommendations, **not source
authorization**. MUST/MUST NOT describe the proposed conformance contract after
ROOT ratification. No implementation precedes Locke's different freeze and GO.

The sole commands are pushd, dirs, popd. They MUST enter existing builtin discovery
and dispatch, with ordinary function shadowing and command/type behavior; they
MUST NOT add plugin definitions/default command counts. No public option, stack
inspection/session API, shared limit, parser change or host cwd/env fallback.
DIRSTACK arrays/special-variable behavior, all stack-tilde expansion, physical
cd/-L/-P improvements, shell option emulation and Bash help text are deferred.
An ordinary scalar named DIRSTACK MUST NOT seed or change the private stack.

The GNU manual supplies the general command model, not proof that flag bundles
work. Pinned actual observations take precedence for this selected profile.
Primary online reference: `https://www.gnu.org/software/bash/manual/html_node/Directory-Stack-Builtins.html`.
Pinned local manual and implementation-source hashes are in BINDING.json; no GNU
implementation source is copied here. Source-only deductions are not native runs.

## 2. State and exact write scope — R1

Recommend exactly **runtime.ts and shell.ts**, with own new tests/docs. Neither
types.ts nor a new directory-stack production module is necessary. This replaces
the old optional helper-file layout, not the approved behavioral semantics.

Private representation in runtime.ts:

```
DirectoryStackState = { readonly entries: readonly string[]; readonly bytes: number }
State.directoryStack?: DirectoryStackState
State.directoryStackCwdPublication?: symbol
```

These are internal State members, not ShellOptions/Result or CommandContext fields.
Absence means empty, preserving existing internal State construction compatibility.
The full display vector F is `[state.cwd, ...entries]`; `$PWD` is not its top.
The tail contains raw strings and an exact cached UTF-8 accounting sum. A new
tail MUST be validated and constructed before one reference publication; it MUST
NOT be edited in place. Every child gets a distinct tail object/array, even empty.
String primitives may be shared. Bytes are logical accounting, not RSS/allocation.

Ownership map against accepted source:

| State path | Required treatment |
| --- | --- |
| shell.ts exec initializer, currently around246 | fresh empty tail; no publication stamp |
| runtime.ts processState, around1609 | fresh empty tail/stamp for bash/sh and script process |
| cloneState, around278 | copy tail object and array; copy primitive stamp value |
| pipeline around908; subshell1010; substitution2442 | existing cloneState path supplies isolation |
| simple isolated-inline input1298 | existing cloneState path supplies isolation |
| redirectState spread1324 | explicitly copy tail too; do not add a shared tail shortcut |
| shebangState1734, its forwarding/target paths | clone until the existing fresh process boundary |
| invokeScoped2100 | clone tail before child cwd/env replacement; no parent/sibling writeback |
| functions, brace groups, source/eval, successive input units | same State/tail; local variable restoration does not restore stack |

Each Shell.exec MUST start fresh, including consecutive/concurrent calls on one
Shell. Within one exec the stack persists across commands/input units until that
execution ends. No persistence is added to Shell itself. Invoke cwd replaces only
the child's implicit top; merge/replace env never seeds the tail or stamp. Success,
mapped failure, escaping rejection, cancellation and cleanup cannot write child
stack changes back. Clone cost is bounded by4096 reference copies; it is not a
new helper/command budget and does not copy the immutable strings' bytes.

### Actual cwd publication, including nested same-path changes

A private stack-originated cd callback MUST replace the State stamp with a fresh
symbol exactly after cwd assignment, before checked PWD. It MUST NOT run for -n,
clear, non-top pop, failed lookup or readonly OLDPWD. It MUST run for successful
same-path cd and readonly PWD failure after cwd assignment.

dispatchScoped snapshots this stamp before its middleware cwd overlay. Its current
conditional restore branch gains the condition that the stamp is unchanged.
The existing explicit cd exception and all no-stack-publication cases stay as-is.
This preserves actual stack-originated cwd changes through nested functions and
`command pushd`, even when the resulting path equals the borrowed middleware cwd.
A direct-callback-only boolean would miss those outer function boundaries.
Non-cd -n/dirs operations MUST still restore a borrowed cwd where baseline would.
Only stack-originated publications replace this stamp; ordinary cd is not given
a new unrelated restoration policy. Child clone stamps cannot mutate the parent.
Prefix PWD/OLDPWD restoration remains the existing checked-binding machinery.

## 3. Grammar, indexes and statuses — R2

Tokens are already expanded by the existing shell. No re-expansion/re-tokenization.
Exact single flags only: dirs -c/-l/-p/-v; pushd/popd -n. Bundled dirs flags remain
usage2, including -lp, -pv, -vp, -ll, -cpv. Repeated separate flags are idempotent.
Unknown options/invalid numeric syntax are usage2; direct pushd excess operands1;
empty/no-other stack and valid out-of-range index1; successful operation0, subject
to existing actual write/cancellation/error mapping rather than native closed-FD0.

Recommend the observed/source-supported parsing details, with no generic getopt:

| Command | Parsing/selection rule |
| --- | --- |
| pushd | initial `--` disables its selector/flag interpretation; no remaining token still swaps. Otherwise consume exact -n/selectors until -- or first path. Validate each selector's range immediately; last valid selector wins. Rotation wins over subsequent ordinary operands. If no rotation, -n stores the first path and ignores extras; ordinary direct push rejects more than one path. A late -n after a path is an extra operand, not a flag. |
| popd | consume exact -n and selectors; last selector wins; validate range after parsing. `--` or an empty token stops parsing and ignores following tokens; earlier selector/-n remains. Default selector is +0. Nonempty ordinary word is usage2. |
| dirs | consume separate flags/selectors; last selector wins. `--` stops and ignores following tokens, retaining earlier flags/selector. Parse errors still fail before clear. Valid -c overrides otherwise out-of-range selection, empties tail, prints nothing. |

Dash remains OLDPWD for a real direct push **even after `--`**, as newly observed
G06; -n stores raw dash. `-- -dash` and `-- +1` remain literal directory names.
Empty direct path inherits accepted cd's explicit empty-to-dot divergence; -n
stores the empty string as a genuine remembered entry. No-argument `pushd -n`
is silent success without swap; initial bare `pushd --` retains swap semantics.
HELP compatibility is not claimed: first `--help` is bounded unsupported usage2
in this initial profile, not reproduced GNU help output.

Recommend exact signed64 numeric parsing for the magnitude following the first
direction sign: ASCII leading/trailing whitespace, optional inner sign, at least
one ASCII decimal digit, value within [-9223372036854775808,9223372036854775807].
Leading zeroes are allowed. Scan boundedly; build at most19 significant decimal
digits, never pass an unbounded string to BigInt/Number or use wrapping arithmetic.
Out-of-range machine magnitude is usage2; valid magnitude outside the stack is1.
Use exact arithmetic for the final index; no C signed-overflow emulation. Full
index j is magnitude for +, and `tail.length - magnitude` for -. This proposed
safe extreme-negative behavior is not a claim about native overflow cases.
G05 observes max64 status1, next magnitude2, inner plus/space accepted, negative
magnitude status1. Trailing ASCII whitespace and large-index padding are supported
by inspected pinned source, not newly executed vector coverage.

## 4. Transitions and publication points

Let C be current logical cwd, T remembered tail, F=[C,...T]. A planned new tail
MUST pass count/byte/path/work admission before allocation/publication or cd.
There is no generic rollback. Readonly and output rules below are ROOT-approved.

| Operation | Ordered effects |
| --- | --- |
| pushd path | admit/preconstruct [C,...T]; run shared real cd; only on complete success publish new tail; then automatic display |
| pushd no args | require T nonempty; select T0; admit/publish [C,...T.slice(1)] **before** cd; then cd; display only on success |
| pushd +/-N | rotate F left by j to R; admit/publish R.slice(1) before cd to R0; display only on success. j0 retains tail but still performs real cd unless -n |
| pushd -n path | admit/publish [rawPath,...T], no FS/cwd/PWD writes; display |
| pushd -n no operand | silent0, no changes or display validation |
| pushd -n +/-N | same rotated tail publication, but keep C and skip cd/display; selected R0 is not reinserted. j0 silent no-op |
| popd default/+0 | require T nonempty; preconstruct T.slice(1); cd to T0; only complete success publishes removal; display |
| popd non-top j | remove T[j-1], no cd, then display |
| popd -n | bounds still use F; j0 and j1 both remove T0; other j removes T[j-1]; no cd; display |
| dirs -c | after successful parsing clear tail, keep C/PWD/OLDPWD, no display |
| dirs read | no stack/cwd/variable mutation or VFS request |

Singleton `pushd +0`/`dirs +/-0` succeeds; swap and pop on singleton fail1.
Capacity checks apply to *post-transition remembered entries*. Rotation/swap can
increase bytes by replacing a short raw entry with C despite unchanged count;
C MUST be checked before that pre-cd publication. Current cwd is not otherwise
counted against the4MiB remembered quota. Plain cd changes only the implicit top.

Concrete preserved S02 witness, starting F=[C,missing,A]: failed pop leaves it;
failed pushd +1 leaves [C,A,C]; failed swap from [C,missing] leaves [C,C]; failed
direct push leaves [C]. -n S01 rotation from [C,c,b,a] by+1 produces [C,b,a,C];
subsequent -0 produces [C,C,b,a]. These are native observations, not transactions.

### Reuse accepted cd; no hidden command invocation

Extract the accepted lookup/checked-publication/required-path-print sequence into
one private Runtime method, used directly by cd and stack operations. Do not invoke
a new Shell, dispatch an overridable cd function, call context.invoke, consume an
extra command tick, or duplicate provider/CDPATH permission logic. Preserve every
accepted cd input/status/diagnostic/cancellation behavior. Private call parameters
may select diagnostic command name, the stack cwd-publication hook and the awaited
stdout emitter; no parameter becomes a public API or environment channel.

Concrete private seam recommended for approval: `changeDirectory(context, state,
args, diagnose?, stackHooks?): Promise<number>`. The existing cd branch passes its
original argv with no hooks. A stack caller passes exactly `[selectedRawTarget]`;
hooks contain only its command label, synchronous `onCwdPublished()` stamp update,
and awaited `emit(text)` using the same original stdout. Stack parsing, capacity
planning and any pre-cd tail publication happen outside/before this method.
No overrideable host hook, global state channel, new cancellation scope or
diagnostic envelope is introduced. Returning1 for missing variables remains a
normal mapped result; the stack caller must not perform its after-cd publication.

The shared method completes stat-directory/X_OK, checked OLDPWD, cwd, checked PWD,
exports, and any CDPATH/dash path print. Stack **after-cd** tail changes occur after
that awaited path print succeeds; automatic stack display follows the tail change.
Thus a CDPATH-print failure can retain new cwd without an ordinary push insertion
or top-pop removal. This exact failure boundary is the proposed virtual policy,
not a new native sink-failure observation. A failed automatic display retains the
already-published tail. No failure removes readonly attributes or rolls back.

Readonly OLDPWD blocks cwd but not a swap/rotation tail already published before
cd. Readonly PWD can leave new cwd/OLDPWD; later exports and after-cd tail changes
do not happen. The stack stamp records that actual cwd publication. Caller/control
signals are checked before later publications and around awaits/yields. Existing
root/control/escaping-error versus numeric status and cleanup precedence remains.

## 5. Display, bounds and precise work proposal — R3

Previously approved inclusive ceilings remain:4096 remembered entries,4,194,304
remembered UTF-8 bytes,65,536 bytes per remembered/resolved path,8,388,608 display
bytes,8,388,608 helper steps,128-step yield cadence,16,384-byte output chunks.
No public cap or shared Budget reset/extra command charge is proposed.

Recommend these exact admission details for the different freeze:

1. After normal admission/expansion/prefix/redirection and signal check, parse
   only reached argv fields. Each reached field, and HOME only when formatting
   needs it, has an explicit65,536 UTF-8 byte scan ceiling. Ignored tokens after
   a grammar stop do not acquire helper charges/scans; existing expansion limits
   already apply independently. No-argument stack operations do not resolve HOME.
2. Validate planned tail count, added/raw remembered strings, exact aggregate sum
   and any inserted C before allocation/publication/provider effects. Reserve all
   new-tail copy-step costs before allocating the array. Invalid plan status1
   leaves tail/cwd unchanged and does not try a later alternative operation.
   This stack-plan admission precedes shared cd variable resolution: e.g. a full
   ordinary push reports its private count limit before a missing OLDPWD. Once
   delegated, missing OLDPWD still precedes cd's own path/CDPATH limit checks.
   A rotation's pre-cd tail publication also survives a missing-OLDPWD failure;
   do not delay it into the shared method and accidentally make it transactional.
3. Clear and silent no-ops do not validate unused HOME/display cwd. Existing tail
   accounting is maintained privately, not recomputed from env/DIRSTACK. Removing
   an entry scans its bounded string for subtraction; count/byte arithmetic uses
   checked subtraction/addition, never wrap/saturation into apparent success.
4. Step units: one per reached argv field; one per UTF-8 byte scanned for field,
   used HOME, added C/path or removed-entry accounting; one per UTF-16 code unit
   inspected during numeric grammar/HOME-prefix comparison; one per result-tail
   slot copied and per display entry visited; one per encoded stdout byte emitted
   into the bounded chunk. The first field scan and later number grammar scan are
   distinct charges; reuse a scan's byte length without silently rescanning it.
5. Each reservation first checks remaining steps in full; reject before that
   operation's allocation/work if it cannot fit. Advance admitted work to every
   reached128 boundary and await existing interruptible setImmediate with checks
   before/after. Before a transition publication or provider delegation, flush any
   remaining partial scheduling batch with one interruptible yield; before return,
   flush only if new unflushed work remains. No unconditional no-op yield.
6. The stack counter persists for the entire builtin. The reused CdLookup keeps
   its separately accepted per-call8Mi byte-work/cadence and its8194-public-call
   maximum; the new stack counter is not reset by cd. **These two bounded counters
   are not one8Mi global bound**, a new deadline, or an RPC/preemption guarantee.
7. The8Mi display counter includes both any shared-cd path print and automatic
   stack display. Route both through a private awaited emitter to the original
   stdout; do not replace/drop its owned-output enrollment. Reserve each scalar's
   bytes before appending, encode only chunks <=16KiB without splitting a surrogate
   pair, and await each write. Work/display cap failure during output retains prior
   bytes and published state. This is not atomic output or guaranteed success for
   every state below the separate remembered-byte ceiling.

Default display uses spaces and final newline. -p uses newlines; -v dominates -p,
and prefixes each selected entry with its original full index, decimal width at
least2, then two spaces. -l prints exact logical/raw strings and bypasses HOME.
Otherwise abbreviate only exact raw HOME prefixes on a slash/end boundary with
HOME byte length>1. Do not normalize HOME or consult host homes. Empty/unset `/`
do not abbreviate; a trailing slash is preserved, not universally trimmed/disabled.
Raw relative HOME may match raw relative entries by that same rule. Source-derived
large-index/relative-HOME details require different controls, not invented native
measurements. Whitespace/newlines in entries are data, not shell-escaped output.

## 6. Diagnostics and failure boundary — R4

Recommend the accepted cd-style65,792-byte **owned payload** bound for each stack
diagnostic, including command text and internal usage-line separators, excluding
the existing shell-origin prefix/final newline. On truncation keep the longest
scalar prefix <=65,780 plus exact12-byte ` [truncated]`; never build unbounded
own text first. Diagnostics have their own bounded formatter, not an attempt to
consume an exhausted stack-work counter; actual writes retain parent accounting.
No global exception formatter or diagnostic-envelope change.

Proposed exact private status1 payloads, with actual builtin name substituted:

```
NAME: directory stack exceeds 4096 entries
NAME: directory stack exceeds 4194304 UTF-8 bytes
NAME: path exceeds 65536 UTF-8 bytes
NAME: argument exceeds 65536 UTF-8 bytes
NAME: HOME exceeds 65536 UTF-8 bytes
NAME: helper work limit exceeded
NAME: display exceeds 8388608 UTF-8 bytes
```

Existing shared cd private messages retain its syntax, with stack command label
when delegated. Provider exception identity is retained and associated with a
bounded command-specific diagnostic, not replaced with a usage exception. Shared
limits, caller/invoke signals including falsy/equal/errno-shaped reasons, sink
errors, and cleanup failures retain accepted runtime mapping. EPIPE remains141;
ordinary caught write errors may map to1; numeric status is not promoted into an
escaping rejection. Native closed-output push/pop0 is an explicitly retained gap.

## 7. Evidence and required different acceptance

Original34 native/34 virtual observations, original0/34 matches, and four separately
presealed native-only topology followups stay unchanged. New G01-G08 are eight
separately presealed native-only grammar observations, not corrected original
inputs or virtual feature tests. They used the same pinned GNU5.3 Darwin binary
and startup-disabled environment, with one removed task-owned root/eight closed
direct children. No Linux/Bash3.2/native-service qualification follows.

Accepted cd qualification is precise: L24 ran the actual candidate Runtime in all
three layouts with a SCRIPTED provider, path `/` plus21845 lone high surrogates,
accounted65536 bytes and original string preserved; stat then access1/status0,
cwd/PWD and OLD are actual observations. Memory cannot represent its255-byte
component. The historical Memory batch stopped at L07 setup after61 passes; L24
was BLOCKED, not an executed failed assertion. Work/yield/private-state invariants
retain their frozen source-proof roles, including originally source-only I07;
no private dynamic-counter measurements are newly claimed or required here.

Locke's future matrix MUST cover: fresh/same-exec persistence; every clone/reset;
function/source sharing; middleware borrowed cwd/no-op/same-path/partial readonly;
literal and ignored-operand grammar; raw empty/nonexistent -n entries; selected
indexes and prefix formatting; capacity when rotation inserts C; pre-cd and
after-cd mutations; cancellation at planning/lookup/print/cleanup; partial output;
monotonic shared budgets; no metadata on no-cd/display; builtin discovery and all
accepted cd/getopts/invoke/owned-output regressions. Use exact admitted provider
profiles for unrepresentable strings and identify source-proof controls honestly.
Freeze before implementation; source/installed/moved authentication remains
required, without claiming a whole gate or full native parity.

## 8. ROOT decisions to release the different freeze

- **R1:** approve two-file implementation, optional internal tail/stamp fields,
  fresh-exec/fresh-process reset, deep tail clones, and stack-only publication
  stamp guarding the existing middleware restoration branch through functions.
- **R2:** ratify the complete parsing table, newly observed G01-G08 peculiarities,
  signed64/ASCII number profile, marked dash behavior, and explicit help/extreme
  overflow qualifications. No original corpus rescore is implied.
- **R3:** ratify the exact reached-token/HOME admission and work units/final flush,
  preconstructed-tail publication ordering, separate accepted CdLookup counter,
  and combined path-print/stack-display counter with possible partial output.
- **R4:** ratify the bounded diagnostic payload and exact private failure messages,
  plus after-cd tail publication only after awaited CDPATH/dash printing. No new
  shared formatter, public limit or rollback behavior is authorized implicitly.

Until those choices, different freeze and GO: production remains unchanged.
