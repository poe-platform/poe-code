# Proposed mechanics and unresolved boundaries

This is additive to the immutable proposals and independent findings. **NEW**
marks an author proposal requiring root disposition, not normative product
behavior. **ROOT** marks requirements in the present task. **OBSERVED** refers
only to exact N-row bytes in observation commit `4e8f8a13`. **OPEN** means no
implementation-ready closure. R denotes accepted `c26892c3:src/shell/runtime.ts`;
B denotes `5137a74e` with the named source path. These are not live-HEAD anchors.

## G1 — Publication, indices and error phases

ROOT: one staged target transfer; no intermediate stage visibility, RHS once,
no rollback of completed RHS effects, scalar path unchanged. R:1293 expands
command arguments before R:1301's sequential scalar assignment/RHS/readonly
sequence. Preserve its redirection branches and R:1358 restoration too.

NEW phase table, in this order:

| Phase | Proposed failure/continuation |
| --- | --- |
| Parse complete unit/script-file units | Malformed or explicitly excluded syntax: existing syntax2 path, before execution. B parser.ts:274,439; R:1935. |
| Resolve exact target once | Known readonly, then control/export restrictions: command failure1 before array RHS; do not retrofit scalar Flow rules. |
| Index and private admission | Canonical decimal out-of-domain or statically certain implicit overflow: failure1 before RHS. Private failure follows G6. |
| Expand/stage in source order | Existing expansion/control failures keep their existing class/profile status; do not copy native127 into product expectations. Completed RHS effects remain. |
| Publish after final await | Root cancellation precedes escaping execution/control failure. If expansion already failed, do not replace it. Otherwise current readonly precedes stale generation/version, each failure1. Transfer synchronously only after final signal/identity check. |

All ordinary failure1 proposals are subject to existing surrounding shell
control/errexit behavior, not unconditional continuation or new assignment Flow.

NEW cursor rule: retain an **exhausted sentinel**, not an invalid stored index.
Demand a valid cursor only when an implicit field will actually be inserted.
Explicit valid indices reset the cursor, even after an exhausted sentinel.

| Boundary | Proposed disposition, not a native observation |
| --- | --- |
| Maximum existing index; `a+=()` | No index demand; empty append succeeds without mutation/version advance. |
| Maximum existing index; `a+=([0]=x)` | Explicit zero succeeds, subject to normal staging/admission. |
| `[2147483647]=x [0]=y` | Both explicit indices valid; unused overflow cursor is not an error. |
| Unquoted RHS produces zero fields | No cursor consumption. Preserve its already-completed effects. |
| Field-dependent overflow | Expand that RHS once; before inserting the first out-of-domain field, fail and discard stage, preserving RHS effects. |

Static preflight uses only provably fixed field counts from syntax, never
evaluates a substitution/default/glob to predict arity. After uncertain arity,
cursor position remains unknown until execution or a later explicit reset.
Certain later overflow can be refused before any RHS; this precedence is a NEW
choice requiring ratification. Quoted aggregate emptiness is not automatically
one field. Replacement `a=()` still publishes an empty indexed binding.

OBSERVED: N09/N10 read prior values; N11 suppressed fresh RHS assignment; N12/N15
preserved old target and unrelated effects. N13 instead successfully replaced
its target after a bare-name default write. None proves generation-conflict,
asynchronous readonly, cancellation or resource semantics.

## G2 — Bounded identity and tombstone ownership

R:160,293,297,2342 require complete saved state and save-once local behavior.
NEW: allocate a name-watch record only for a live array operation/frame/overlay
that observes that scope/name, including absence. Charge its64-byte header,
owned name token/header/payload, references and cleanup credits under existing
private caps. No uncharged permanent per-name history. Retire a record after its
last stage/frame/overlay observer; absence then needs no retained tombstone.

Each watched successful mutation, including same-value write, unset/recreate,
attribute change and restoration, advances checked identity/version. Never
compare only value equality. A lazy per-exec checked counter supplies unique
generations; reserve frame/overlay restoration generations and all ownership
before temporary publication. Reserved identities need uniqueness, not temporal
numeric ordering at restoration. No wrap, reuse or capacity discovery in finally.
Reserve any replacement watcher/version storage before the guarded mutation.

An unobserved ordinary scalar-only execution does not instantiate this ledger.
Within an array-bearing invocation, watches and restoration reserves remain
charged until actually released. An absent local shadow remains until frame
return; repeated local never overwrites the first saved outer snapshot. Retain
presence/kind/empty/missing-zero distinctions, export/readonly and OPTIND metadata.
Restoration publishes pre-owned saved state first, then detaches/releases the
temporary state; cancellation cannot abandon the saved binding.

OPEN: ratify watcher cost and reservation-counter ordering; prove every mutator
participates before treating this as an ABA defense. No lease/host-memory claim.

## G3 — Consistent asynchronous copies

R:278 is currently synchronous. NEW choice: optimistic **whole-source snapshot
epoch**, not unverified Map stability and not silent retry. Before a copy, pin
charged source owners, capture the epoch and target identities, and reserve the
destination. Each bounded chunk acquires value references before yielding.
Check epoch after every await and immediately before exposing the completed
clone/frame. Any intervening relevant state mutation discards the partial copy
with failure1; no RHS/copy restart and no mixed snapshot publication.

The epoch covers all accepted clone-visible fields, not only a target array:
variable values/kinds/absence, exports/readonly, functions, positional and scope/
getopts/cwd metadata. Cross-variable changes conservatively invalidate the whole
copy. Source header/owner pins and acquired values remain charged; unvisited
mutable slots cannot be assumed stable across a checkpoint. Same-state changes
must advance the epoch even when bytes compare equal.

This avoids requiring immutable full-map copying on every element write, but
introduces a deliberately conservative conflict policy. R:794/817 setters and
R:824 arithmetic stay synchronous: async callers prepare/reserve, then publish
with a synchronous guard. Bare and bracket indexed arithmetic reads/writes refuse;
no promise-returning setter or Map stringification. Ordinary scalar arithmetic
remains governed by accepted LET limits.

OPEN: complete mutation-site instrumentation and coherent scalar snapshot
admission are not proven. No current/native observation exercises parent
reentrancy; N14 is isolated substitution state only.

## G4 — Expression and output ownership

R:135 capture copies, R:2508 decode, R:2525 alternate joins and R:2658 word buffers
already precede setters. NEW boundary: existing scalar-compatible source/expansion/
substitution materializations remain explicitly under their existing Budget and
owner until handoff; do not claim that the private array ledger pre-admitted
those existing allocations or bounds their combined physical peak.

New array-derived outputs, slots, sorted indices, split/glob field vectors,
escaped forms, concatenation intermediates and encoded copies require explicit
tokens and admission **before their own allocation**. Retained input from the
existing phase needs private destination reservation before insertion/ownership
transfer; retain the source owner until it really releases. Copying means two
charged owners during overlap. Expansion/argv/consumer references delay release;
an awaited transient sink write is not permission to release still-retained argv.
Output enrollment must respect destination-specific ownedOutput; no implicit
ownership of siblings or arbitrary trusted-host retention.

Tokens identify logical storage, not string equality/V8 internals. Independent
equal strings charge independently. UTF8 measurement counts a valid surrogate
pair as four bytes/two UTF16 scan units; a lone surrogate as three bytes/one
unit, matching replacement encoding. Code-point length scans incrementally,
without Array.from; repeat scans/copies charge again. Numeric sort pre-admits two
N-slot vectors and both headers; fields keep real boundaries, not joined sentinels.

OPEN: the final flat-JavaScript-string bridge and all overlap owners need a
mechanical design before claiming complete preallocation or128-unit checkpoints.
This explicit existing-Budget phase narrows the claim; it is not a hidden free
allocation or an assertion that existing Budget bounds live memory.

## G5 — Cleanup credits and checkpoint schedule

NEW exact additive schedule extending ACCOUNTING:59,72:

| Acquisition | Prepaid release work |
| --- | --- |
| Map slot | Three structural units: visit, Map deletion, slot release. |
| Any owned reference | One decrement unit, reserved when that reference is acquired, including the slot's value reference. |
| Wrapper/header/value/name/frame/watch object | One final object-release unit at allocation; outgoing references reserve their separate decrements. |
| Detached cleanup queue entry | Pre-admitted queue storage and its eventual release; no fresh queue allocation after exhaustion. |

Thus a slot with one value reference needs four release units, not one. Its
value's eventual1→0 object release uses that value token's existing reserve;
2→1 refunds no payload. Ordinary acquire/lookup/insert/copy work is additional.
Credits count toward cumulative work when reserved, are consumed once on release,
and are never refunded into spendable work. Idempotent ownership transitions and
refcounts determine dependencies; B cleanup.ts:46 concurrent close is not LIFO.

Saved binding restoration uses pre-owned state/identities synchronously, without
new cancellable admission. Detached releases consume reserved bounded batches;
settlement waits through the existing cleanup barrier. Carry the checkpoint work
counter across helpers and ref operations, not one counter per helper; bounded
scanning/copying/sorting pieces must fit remaining128-unit allowance. Preserve
root cancellation over escaping execution/control failure over cleanup failure.

OPEN: charging a large join/encode up front does not make its native JS primitive
cooperatively interruptible. The terminal flat-string operation is unresolved;
no claim that this credit table alone closes the every128-unit requirement.

## G6 — Private admission and recovery

ROOT: fresh independent public exec, shared internal descendant ledger; B
shell.ts:162 and R:1609/2100 distinguish fresh variable state from shared Budget.
Keep ACCOUNTING's B/F caps and exact checked arithmetic; instantiate lazily at
first array admission. Compute derived bounds with exact arithmetic/checks
before conversion to safe counters, never rounded multiplication then comparison.
Scalar-only exec remains valid even if a derived private cap would overflow.

NEW fixed check order: derived-cap representability, wrappers, sparse slots,
live payload, metadata, cumulative bytes, cumulative slots, work (including
release reserves). Select the first refused counter in that order. Diagnostic:
`indexed array: private <counter> limit exceeded`, command failure1 in both shell
profiles, not a new ShellLimitError or forced assignment Flow. Existing shell
control may stop or continue; later scalar commands are not barred merely by a
spent private ledger. Releasing storage restores live capacity only, never spent
cumulative counters. Repeated array attempts cannot reset the ledger.

Pre-owned diagnostic labels use the ordinary bounded diagnostic/output path,
not fresh private-array work after exhaustion. Existing output/source/command/
loop limit failures and caller/control precedence remain distinct; diagnostic
output itself may fail under the existing budget, so no unconditional message
delivery promise. Ratify this category/mapping before implementation.

Low-cap consequences remain explicit: F=0 admits no wrapper; B=0 cannot hold a
nonempty name; empty named array metadata160 exceeds F=1's128. Full-map append
retains old+stage slots, so F is not a usable-member guarantee. No native timing
or resource experiment validates any of these logical caps.

## G7 — Scalar bridges, attributes and phases

Retain exactly thirteen proposed conversion refusals: PATH, PWD, OLDPWD, HOME,
CDPATH, IFS, OPTIND, OPTERR, OPTARG, REPLY, LANG, LC_ALL, LC_CTYPE. No LC-prefix
rule, invented special variables or DIRSTACK policy. Exported-unset membership
also blocks conversion. Arrays never serialize into CommandContext.env, whether
as zero, JSON or Map; preserve null-prototype/own-key names.

NEW phase choices grounded in R, not native output:

| Bridge | Proposed timing |
| --- | --- |
| Scalar command prefix resolving indexed | Preserve R:1293 command-word expansion and R:1301 RHS timing, then refuse1 before target mutation/dispatch. Preserve prior prefix restoration and already-completed effects. Indexed/compound prefix syntax remains parse2 before execution. |
| export/local/readonly operands | Expand all command arguments at the existing phase, then validate/mutate operands sequentially. No new promise of pre-expansion refusal. Known readonly array compound assignment remains G1's separate pre-RHS rule. |
| read into indexed explicit name | NEW scalar-style zero write at R:2441, after existing input consumption and earlier field writes. Preserve readonly/error phases; no new no-read guarantee. Default REPLY remains scalar. |
| getopts result indexed name | NEW zero write at R:2245 after the existing scanner/cursor/OPTIND/OPTARG effects. No rollback of completed scanner state. Control names remain scalar. |
| for variable indexed name | NEW zero write at R:1049, after R:1046 list expansion, before body; no array-kind destruction. |
| Child env / middleware overlay | Validate every explicit scalar env entry and readonly collision before publishing shadows. Admit full snapshots first; preserve replaceEnv exactness and parent isolation. Middleware restore uses token/version ownership, not R:1479 equality. |

All new zero writes need G3's explicit async preparation/synchronous publication,
not hidden async changes to existing helpers. Scalar-only paths are unchanged.

R:2331 selects readonly names for readonly and exported names otherwise,
including current no-argument local. Only **selected** indexed bindings cause
the proposed listing refusal2 before any stdout; unrelated unexported arrays do
not poison export listing. Preserve scalar JSON formatting and option support.

OBSERVED contrasts requiring explicit root choice: N01/N02 allow native exported
arrays; N05/N06 create scalar locals rather than the historical proposed fresh
indexed local; N16 permits a scalar prefix shadow. Retaining those project
restrictions/typed-local proposal is an intentional difference, not native parity.
N07 readonly-local refusal and N08 scalar restoration are only narrow observations.
None demonstrates external environment array encoding.

## G8 — Restricted grammar, operators and scalar boundaries

NEW grammar closure candidate: assignment/subscript/unset contexts accept exactly
one canonical decimal digit token, either bare or wholly single/double quoted.
Concatenated quote fragments, leading-zero multidigit forms, whitespace/signs,
empty/dynamic/arithmetic/base/negative indices refuse; never use R:309's permissive
OPTIND parser. Ordinary quoted command arguments remain ordinary outside these
contexts. Canonical digits beyond2147483647 are domain failure1 at G1 admission,
not a dense allocation. Source-span validation can reject long digit lengths
without numeric conversion; complete invalid-token lexical scanning stays under
existing synchronous parser/source bounds, not an invented128-unit parser yield.

Reads proposed for indexed bindings are only `${a}`, `${#a}`, `${a[index]}`,
`${#a[index]}`, `${a[@]}`, `${a[*]}`, `${#a[@]}`, `${#a[*]}`. Bare value/length uses
zero; aggregate count counts present members. Default/pattern/substring/assignment
operators on indexed bindings remain excluded, as do `${!a[@]}`, array slicing,
indirection, namerefs, associative/multidimensional arrays, integer/case attributes,
array arithmetic (including bare-name reads/writes), and array presence forms
such as `[[ -v a[0] ]]`. Declaration-a/typeset/mapfile/readarray stages remain later.
Existing operators on actual scalar bindings stay unchanged.

OPEN conflict explicitly retained: historical N13 PROJECTcandidate assumes a
bare indexed-name default assignment; the earlier blanket array-operator exclusion
does not approve that carveout. NEW conservative recommendation keeps exclusion
until root chooses an explicit bare-name policy. The native row remains valid
evidence, not an approved product recipe. Parameter defaults on unrelated scalar
names, as in N12/N15, are not prohibited by this indexed restriction.

Quoted @ emits one field per present member in numeric order, including present
empty members; no members yields zero fields unless surrounding literal text
itself remains. Prefix attaches to first, suffix to last. Quoted * emits one
field, empty for no members, joined using space for unset IFS, no separator for
empty IFS, otherwise its first Unicode code point. Unquoted @/* preserve member
boundaries through existing split/glob behavior; no flattened sentinel or dotglob
change. Repeated aggregate fragments require the existing word-composition model
to be specified before fixtures, not assumed by this single-aggregate rule.

Keep all internal states: absent; scalar-unset with attributes; scalar-empty;
indexed-empty; sparse missing-zero; present-empty-zero; last deletion retaining
indexed kind; whole unset removing eligible binding. Approved reads alone need
not distinguish every state, but subsequent scoped assignment/readonly/unset
must preserve the distinctions. No live product was imported to simulate them.
