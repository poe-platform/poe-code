# Concrete design findings — not frozen behavior expectations

Source references use R=`c26892c3` runtime and B=`5137a74e` other files, never
current HEAD. Proposal references are the immutable addendum `abe53e03` and
original `2cb93988`. Examples below are **unexecuted questions**, not fixtures,
native predictions, test passes or implementation instructions.

## G1 — Publication, indices and error phases need one ratified table

The original PROFILE proposes sequential visible compound writes; CHOICES:64–73
instead stages replacement/append, makes earlier stage entries invisible to RHS,
then checks cancellation, current readonly and stale generation/version before
one transfer. The latter is coherent and more precise, but needs root ratification
as a deliberate target-atomic profile. Neither policy rolls back RHS effects.
N09–N15 can observe selected native behavior; they cannot ratify the project rule.

Literal canonical indices `0` or `[1-9][0-9]*` through 2147483647 avoid dense
allocation and evaluator changes. However “append starts at maximum+1” and
“reject statically knowable overflow before RHS” leave concrete neighbors open:

- At maximum index, does `a+=()` succeed without needing an implicit index?
- Does `a+=([0]=x)` succeed when all supplied entries have explicit valid indices?
- Does `[2147483647]=x [0]=y` require an unused overflowing cursor increment?
- When an unquoted RHS yields zero fields, when is the next implicit index
  actually required, and which RHS effects precede any overflow refusal?

Choose these explicitly rather than eagerly rejecting every maximum+1 calculation
or silently extending the domain. Also pin malformed syntax versus valid decimal
out-of-domain versus dynamic implicit overflow: original PROFILE permits parse2
and runtime1/existing Flow, whereas the addendum specifies ordering but not a
complete status/continuation table. The readonly-before-array-RHS rule must not
retroactively change scalar assignment RHS-before-readonly (R:1301).

## G2 — Identity/tombstone storage must itself be bounded

Full snapshots must distinguish absence, scalar unset+attributes, scalar empty,
indexed empty, absent element zero, present empty zero, and nonzero sparse members.
Deleting the last element or clearing members retains indexed kind; whole unset
removes an eligible binding. A local unset leaves an absent local shadow until
function return; it must not expose the outer array early. Repeated local must
not replace the original frame snapshot (R:2342). Restore kind, contents, export,
readonly and OPTIND metadata with a fresh generation, not only element zero.

CHOICES:64,66,75 correctly require absent-name generation, mutation version,
same-value-write detection and no wrap. The lifecycle of those records remains
unspecified. A permanent per-name tombstone map would retain names after arrays
are released and escape the stated wrapper/name accounting; using only current
value equality would miss unset/recreate and same-value writes. Specify ownership
of watched-absent identities, their charged storage and eviction when no stage,
frame or overlay can observe them. Do not accidentally charge a new persistent
array ledger to unrelated scalar-only executions.

The frame must reserve its restoration generation and ownership before publication.
No finally path may discover exhausted counter/storage capacity and abandon the
saved outer binding. This includes overlays and prefix snapshots, not just local.

## G3 — Async full-map copy changes the snapshot problem

R:278 currently clones scalar state synchronously. ACCOUNTING requires full-map
copies for child and saved-local bindings plus cooperative checkpoints every128
work units. Merely changing a copy loop to `await` can let parent/shared state
change midway, yielding a mixture of old and new entries or attributes.
CHOICES' target-stage version guard does not by itself specify clone consistency.

Choose a concrete mechanism: pin immutable published maps across a copy, or
validate an appropriate binding/state version and explicitly refuse stale copies,
or another bounded snapshot protocol. Do not silently retry RHS/copy work or
assume a mutable Map stayed unchanged across checkpoints. All element-zero,
element-unset, readonly and middleware mutation paths must participate.
If immutable maps require copying for each element mutation too, account and
document that additional peak/cumulative cost; the current copy list does not
state it. Cross-variable/attribute snapshot order also needs definition.

The accepted synchronous `writeVariable`, unset/restore helpers and arithmetic
proxy cannot await string scanning or clone admission. Async call sites must
prepare/reserve before a synchronous guarded publication; synchronous arithmetic
must refuse indexed access, not hide an async setter or stringify a Map.

## G4 — Setter-only charging misses expression and output storage

R:135 Capture keeps chunk copies and `bytes()` makes a second whole buffer;
R:2508 decodes and strips substitution output. R:2525 joins alternate fields;
R:2658 builds both value and escaped-pattern strings. Those allocations happen
before the assignment setter. Existing Budget/source/output/word ceilings bound
different quantities; they do not establish the proposed array live-byte ledger.

Define the ownership boundary for array RHS literal/split/glob/substitution data,
intermediate concatenation, escaping, encoded copies, sorted index vectors,
quoted aggregate fields, and `${#a[index]}` scanning. Measuring a finished string
before inserting it in the Map is too late to claim *that string's* preallocation.
Unknown input needs a reservation/streaming strategy or an explicit separate
existing-budget ownership phase with an overlap-safe transfer. Reserve the
destination before releasing source ownership; do not release fields while they
are still retained by expansion, argv or an owned consumer operation.

Preserving Unicode code-point **semantics** does not require reusing the collecting
`Array.from` in R:2535; ACCOUNTING expressly forbids it for new array work. UTF8
measurement must specify surrogate-pair and lone-surrogate handling consistent
with current encoding, and charge repeated scans/materializations honestly.
String primitives have no observable storage identity: use explicit owned tokens
for logical sharing, not content deduplication or an asserted view of V8's heap.
Arbitrary trusted plugin retention after the declared ownership boundary remains
outside a cross-exec memory guarantee; do not wait for opaque promises to fake one.

## G5 — Work/cleanup schedule is not yet operationally complete

ACCOUNTING:59 adds lookup/insert/delete, reference operations, slot visits/copies,
comparisons and copied/emitted bytes. Its cleanup reservation at :72 says one
release unit per object/slot plus each reference decrement. State whether a
slot release includes its visit and Map deletion or those require additional
reserved credits. Otherwise the summed schedule and the no-fail cleanup promise
can disagree precisely after exhaustion. No release should need fresh work
admission, and no cleanup credit should be silently refunded twice.

Similarly, charging N bytes and then doing one large synchronous encode/copy/join
does not satisfy “checkpoint every128 units.” Specify bounded chunks for actual
materializations, a counter carried across helpers, and signal checks before
publication. Numeric sort must pre-admit both vectors and headers, charge each
comparison/move, and preserve existing ascending numeric semantics; the hand
example explicitly shows only one index vector, not sorting peak.

Cleanup must restore published bindings without a fresh cancellable admission;
release of now-detached storage may use pre-owned bounded batches. Register
idempotent scope cleanup before acquisition (B cleanup.ts:33), but scope.close
drains callbacks/children concurrently, not as a guaranteed reverse-order stack.
Choose dependency-safe ownership/refcount release; preserve root caller reason
over execution/control failure over cleanup failure through existing settlement.

## G6 — Arithmetic is coherent; cap policy still needs ratification

The cap equations and the B=1024/F=16 allocation example reconcile as written:
live bytes1024, metadata2048, cumulative bytes16384, cumulative slots128,
work36864. The example's live/cumulative event sums agree; it intentionally does
not simulate work credits or a two-vector sort. This is static arithmetic only.

Important consequences to freeze deliberately:

- Zero F admits no wrappers; zero B cannot retain a nonempty binding name even
  for an empty array. With the stated distinct wrapper64 + Map64 + name-header32,
  an empty named array needs160 metadata bytes, so F=1's128-byte cap also refuses
  it. A single-element binding needs256 metadata bytes with a distinct value
  identity. Do not sell F as a guaranteed usable element capacity.
- Full-map append keeps old N plus stage N+new live slots. Thus it can refuse
  below F logical members; a clone or saved local adds its own slots/wrappers.
  Refcount2→1 does not refund payload. Failed stages refund only actual released
  live storage; cumulative bytes/slots/work remain spent.
- Default B=16777216/F=10000 yields cumulative139337728 bytes and539430912 work
  units. These are finite logical ceilings, not evidence of small latency,
  resident memory or hard preemption. No timing/resource experiment was run.
- Checked arithmetic must precede multiplication/addition; use an exact method
  or preconditions, not a rounded overflow then comparison. A public safe-integer
  B/F that overflows a derived private cap must not invalidate scalar-only exec;
  choose lazy array admission and a fixed private-counter check order.

Ratify status1's diagnostic/category and continuation behavior when private
admission fails: ordinary command failure versus assignment Flow in each shell
profile, whether later non-array commands may continue, and how diagnostics are
charged after array work is exhausted. Existing ShellLimitError, source/command/
loop/output accounting and caller/control precedence must remain distinct.

## G7 — Scalar boundaries are viable with exact selection and phase rules

The thirteen explicit conversion refusals in CHOICES:9 are grounded in inspected
core consumers: PATH/PWD/OLDPWD/HOME/CDPATH/IFS/OPTIND/OPTERR/OPTARG/REPLY and
LANG/LC_ALL/LC_CTYPE. Treat them as a project restriction, not a universal Bash
special-variable set. Do not extend it to all LC names or invent meanings for
RANDOM/SECONDS. Revisit future accepted STACK consumers separately; this review
does not authorize DIRSTACK behavior based on unaccepted source.

Exported-unset membership must block conversion just as an exported scalar does.
Reject export of arrays; never serialize element zero, JSON or a Map into
CommandContext.env. Preserve own-key/null-prototype behavior for names such as
`__proto__`, `constructor` and `toString`. Validate all explicit child env entries
before publishing any scalar shadows; keep replaceEnv exact and parent state
unchanged. Middleware restoration must use token/version ownership rather than
R:1479's scalar value-equality test for newly typed overlays.

Do not broaden listing selections accidentally: R:2331 selects readonly names
for readonly, otherwise exported names even for current no-argument local.
Under the new invariant an unexported array is not selected by export listing;
a selected readonly array should trigger the proposed all-or-nothing refusal
before stdout. Merely having any array elsewhere must not fail unrelated scalar
listing. Preserve scalar JSON formatting until a separately authorized formatter.

Pin exact effect phases for prefix `a=$(effect) cmd`, export/local/readonly
argument expansion, read/getopts/for writes to an indexed name, and middleware
validation. “Before mutation” is not “before argument/RHS/input effects.” The
addendum explicitly preserves local argument expansion, but not every bridge's
phase. Do not import a stronger stdin or host-ownership guarantee while fixing
typed variable access; mapfile/readarray remains a later stage.

## G8 — Close the restricted grammar before authoring expected fixtures

The domain and unsupported arithmetic/negative indices are explicit and useful.
Do not reuse R:310 decimalIndex, which accepts whitespace/signs for OPTIND, for
the new canonical array grammar. Bound invalid long literal scanning as well as
valid ten-digit input; existing parser source admission and synchronous parsing
remain separately qualified.

The first-profile read list does not settle element/default/pattern/substring
operators, `${!a[@]}`, `[[ -v a[0] ]]`, or concatenated quote fragments in indices.
Choose supported versus explicit refusal; never route an unsupported subscript
to a scalar name or arithmetic evaluator. Ordinary quoted command arguments
that happen to resemble array syntax must stay ordinary arguments outside the
assignment/parameter/unset grammar contexts.

Keep the following internal distinctions observable through the approved forms:
absent binding; unset scalar with attributes; scalar empty; empty array; sparse
array missing zero; present empty element; last element deletion; whole unset.
`${a}` uses zero while member length counts present entries, not max+1. Quoted
`@` and `*` need empty-array, surrounding-text and IFS-unset/empty/Unicode rules;
unquoted aggregates need actual field boundaries before split/glob, not joins.
Specify whether **bare** indexed-name arithmetic reads/writes also refuse (as
the addendum appears to intend), not only bracket tokens. R:824 needs a checked
read boundary too; accepted LET's synchronous parser/evaluator limits remain
unchanged. None of these unsettled cases is frozen as an expected output here.
