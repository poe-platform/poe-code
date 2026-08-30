# Declaration author profile — ratified-v3

Status: Complete author profile for independent closure; DESIGN ONLY, no source GO.
Implemented Through: Not applicable; declarations are not implemented by this packet.
Date: August 28, 2026. Purpose: one finite reader/printer, declaration-state and
publication contract for `virtual-bash`, without changing public surfaces.

## 1. Authority, boundaries and evidence labels

**R** is explicit ROOT ratification `7719f39e416a401588c83d355888f6b82202c109`,
`tests/shell/declare-independent-20260828/ratification-v3/RATIFIED.md`: P1–P4,
diagnostic capacity (**DC**), and prior reader/printer (**RP**), absent ordinary
replay (**AR**), record refusal/continuation (**RC**), shell-ledger (**SL**) and
unchanged public AST/whole-file preflight (**AST**) approvals. P1–P4 incorporate
the phase table and concrete examples in policy-v2/DECISIONS at `3d340bbd`.
Its historical PENDING labels stay historical; this profile states the resolved
rules, not a second policy vote. Earlier independent `78ed08f0` is review evidence,
not the authority that chooses a fork.

**I** is an inherited array/command contract, including ROOT G8 and G4A as
attributed in PRECODE and CONTINUATION-G4A; exact references are in SOURCES.md.
**A** means **unchanged author design carried forward in this complete revision**
from `2832fdf1`/`bd5a3d34`, with reviewed clarifications compatible with R/I.
It is a fixed closure requirement, not an independently ratified user mandate.
ROOT-RESPONSE.txt explicitly confirms this distinction. **C** means inspected
source only. **H** means immutable historical evidence. **N** means a prepared
native observation question, never an expected native result. MUST/MUST NOT
below prescribe this author profile; R/I/A labels identify their authority.

This is the complete replacement author profile for closure, not an addendum
requiring old contradictory paragraphs to remain active. Old bytes, counts and
results are unchanged. R controls where old A differs. No new public AST/API,
limit, default registry count, provider, command family or dependency is added.
No `-A/-n/-i`, aliases, `expand_aliases`, `builtin` dispatcher, mapfile or broad
framework enters scope. Unsupported attributes MUST refuse, not succeed as stubs.

The arrays successor `c0adae539c736db0e4023d401562ce958d9ebb00`, selected
composition `30f88590b66b88dc9694a56c85f1ee690f02218b`, full 862-file package
SHA256 `e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3`
remains **FROZEN UNACCEPTED**, with Plato reviewing. Composition is not that
commit's repository tree. No package extraction/requalification occurred.

## 2. Finite command, option and operand surface [R:P1/P2/P4; A]

`declare` and `typeset` MUST be genuine runtime builtins sharing semantics,
not registry aliases or default plugins. Diagnostics identify the invoked name;
records always use `declare`. Existing function shadowing and `command` bypass/
discovery stay intact. Literal-argv invocation works without aggregate plugins.
Names are ASCII `[A-Za-z_][A-Za-z_0-9]*`; values remain JS strings. Own-key names
`__proto__`, `constructor`, `toString` are valid, not prototype exclusions.

| Rule | Required behavior |
| --- | --- |
| Leading option region | Scan tokens and cluster letters lexically left-to-right. Entire region and invocation-wide usage validate before any declaration-target publication. First operand or exact `--` ends recognition; all later tokens are operands, even flags/`--`. |
| Negative clusters | Only a/r/p/x; a/r/p sticky, repeats idempotent. Last signed x wins for scalar export; separately retain whether ANY x operation occurred. |
| Positive clusters | ONLY one or more x letters. `+a/+r/+p`, mixed unsupported letters, long options, help/version and option arguments refuse2. Lone `-`/`+` before boundary refuses2; after it invalid-identifier1. |
| Unsupported negative attributes | `-A/-n/-i/-l/-u/-f/-F/-g/-G/-I/-t` and every other unsupported letter refuse2 at first offending token/letter. No semantic stubs. |
| No operands | `declare` and `declare -p` list the same visible scalar/indexed set; negative a/r/x filters intersect. Any positive-x request refuses2, even if later -x. Empty intersection succeeds0. No mutation. |
| Named -p | Supported a/r/x/+x are IGNORED after syntax validation, not applied or filtered. Requested order and duplicate records remain. Unsupported flags still2. Bare valid names only; assignment/subscript operands are identifier1 and continue; absent name1/no record. No local shadow/publication. |
| Mutation | `name`, `name=value`, `name+=value`; literal-decimal `name[index]=value` / `+=value`; authenticated source `name=(...)` / `name+=(...)`. Element/compound imply indexed kind. |
| Duplicate targets | Scalar-syntax-only duplicates sequentially see previous successful publications, with refreshed own-publication watches. Any compound/element operand makes duplicate target names global usage2 before its RHS work. No rebasing externally stale stages. |
| Literal argv | `a=(x)` is scalar data `(x)`, or element-zero data under -a; never compound shell text. Element argv parses only name/index/delimiter, retaining the already-expanded remainder as data, never evaluating it. |
| Index grammar | Canonical decimal 0 or nonzero-leading digits; existing single/double-quoted literal decimals accepted. Negative, arithmetic, substituted, noncanonical, nested/associative forms refuse source syntax2 or literal-argv usage2. Bare subscript without assignment is unsupported2. Canonical decimal outside 0..2147483647 is domain1, not grammar2. |

Global usage2 prevents ALL declaration-target publication, even after an earlier
otherwise valid operand; it does not undo eager argument/prefix/redirect effects.
After the first operand a token `-x` is invalid-identifier1, not a late option.
Unsupported literal-argv subscript grammar is a global usage check; ordinary
bad identifiers and out-of-domain canonical numbers remain operand1. Named
print is the explicit exception treating its non-bare names as query identifiers1.

## 3. Binding states, attributes and local ownership [R:P2/P3; I:G7; A]

| Observable state | Named print (plain attributes) | Writable whole unset |
| --- | --- | --- |
| ABSENT | 1, no record | 0, absent |
| DECLARED_UNSET scalar | 0, `declare -- n` + LF | Remove membership/value/kind/mutable attributes |
| SET_EMPTY scalar | 0, `declare -- n=''` + LF | Same removal |
| SET_NONEMPTY scalar | 0, quoted scalar record | Same removal |
| INDEXED_EMPTY | 0, `declare -a n=()` + LF | Remove binding; member-only unset instead retains kind |
| INDEXED sparse | 0, ascending-index record, missing zero omitted | Same whole removal |
| Hidden local absence barrier | 1, no record; concealed parent remains hidden | 0, barrier stays |

Declaration membership is distinct from string presence and frame ownership.
An attribute-only scalar declaration creates no empty value. Exported unset
prints `declare -x n` but contributes NO child-env key; empty contributes `n=""`.
Readonly unset prints `declare -r n`, denies assignment/unset1, permits
idempotent attribute-only redeclaration and scalar export-bit changes.

`-a` creates empty indexed from absent/unset, preserves scalar value at zero on
conversion, and preserves members of existing arrays. Scalar syntax writes or
appends zero only on arrays; other members remain. Compound `=` replaces;
compound `+=` appends from existing maximum+1, with explicit indices resetting
the cursor and duplicate indices taking the last expanded value. Explicit
elements do not split/glob; implicit entries use existing field expansion.
Empty compound append validates but makes no array-value publication; requested
declaration membership/attributes still require their own admitted atomic stage.
Readonly applies to the WHOLE binding after successful initialization. No-value,
no-kind-change redeclaration is idempotent; value writes/conversion still refuse1.

At each operand entry, before toggling export, local shadowing or publication,
converting a currently exported scalar OR exported-unset scalar MUST refuse1.
Same-invocation `+x` cannot evade this. A SEPARATE successful scalar `+x` followed
by later conversion is authorized; whole unset is another eligible path, not
the only one. No export-history taint. ANY x operation on an existing OR requested
indexed result refuses1, regardless of final x sign; named -p ignores supported
attributes instead. Thus new `declare -a -x +x n` refuses1 without creating n.

Only PATH/PWD/OLDPWD/HOME/CDPATH/IFS/OPTIND/OPTERR/OPTARG/REPLY/LANG/LC_ALL/
LC_CTYPE are the inherited indexed-conversion controls. DIRSTACK is ordinary.
Scalar control semantics remain, including OPTIND integer/getopts state, PATH
unset state and PWD/cwd distinction; -i or new control exclusions are not added.

In a function, first declaration saves once per current frame/name. An indexed
parent gets a fresh empty indexed local; scalar initializer fills zero. A scalar
parent gets unset scalar local unless initialized; existing export visibility
remains unless +x. Readonly parent refuses shadowing. Repeat declarations update
the local without replacing the original save. Complete saved state includes
absent versus declared-unset, kind, value/members, export, readonly and applicable
getopts state. All exits restore the exact saved parent once; no -g/-I behavior.

Whole local unset removes observable membership, NOT the owning save/absence
barrier. Same-frame bare declare recreates DECLARED_UNSET with no value and no
old kind/attributes, retaining that original save. Ordinary assignment after
unset creates a scalar, not the previous array. Nested G unsetting caller F's
local changes F's visible binding to hidden absence; G return does not restore
it. If G subsequently explicitly declares n, G saves/restores F's absence, not
the concealed grandparent. Only F's exit restores its original saved parent.

`source` uses the current frame; source return does not pop function locals.
Subshell/substitution/pipeline clones isolate mutations and share the ledger.
New process/interpreter/scriptFile state gets existing exported scalar values
and its existing control initialization, not array/local/readonly/declaration
attributes. Top-level declarations persist only within this exec.

Literal `context.invoke` clones parent state, clears local/function-depth/source
frames as currently, retains function definitions/nonexported cloned bindings,
and leaves parent untouched. Explicit scalar env shadows child typed bindings
subject to readonly collisions. replaceEnv true uses EXACT supplied exports
(omitted means empty), adds no PWD and promotes no locals; false/omitted retains
merge compatibility. Preserve borrowed signal, stdin provenance and shared budget.

## 4. Reader, preparation and atomic target publication [R:P1/P4/AST; I:G1/G8; A]

Only literal UNQUOTED declare/typeset, optionally through the existing literal
`command`/its `--` chain, admit source compound grammar. Scalar prefixes retain
temporary overlays; indexed prefixes remain refused. Computed/quoted command
names, `builtin declare`, aliases and arbitrary prefixes do not acquire compound
grammar. Compound-bearing commands require literal options/target names.
Quoted ordinary `a=(x)` is data. Grammar validates inactive branches/functions.
`scriptFile` MUST parse every unit before executing any; later declaration syntax2
prevents earlier file effects. Runtime unsupported flags2 do not have that
guarantee. Shell.exec/source/runCurrentText keep existing unit-wise parsing.

Keep public Script/Command/Word/WordPart shapes, parseShell signature and offsets.
Private metadata binds actual parser-owned identities/positions; it is not a
public executable-AST API or validation of arbitrary mutable host objects.
The matching reader and printer MUST both cover this full finite profile and
receive independent verification before any roundtrip/public completion claim.
Internal milestones are permitted; a printer emitting unreadable empty/compound
arrays is not a completed surface.

1. Before RHS, admit watches for known targets; expanded-name scalar operands
   use a conservative whole-state epoch until the name is known. Validate
   authenticated source shape, literal option incompatibilities and duplicate
   compound/element targets before compound RHS. No uncharged prescan.
2. Walk argument words in source order. Scalar RHS stays eager, assignment-context
   no split/glob. Before each compound/element RHS check known readonly, control,
   entry export and statically certain full cursor demand. Such preparation
   failure stops later RHS; it does not undo earlier scalar/RHS/host effects.
   Expand each admitted RHS exactly once, left-to-right. Uncertain field-count
   overflow checks after that RHS once. No retry, double expansion or eval.
3. Before dispatch, retain a private evaluated operand tied to original AST,
   target/options, exact argv position/content and an admitted deterministic
   quoted spelling of concrete entries. This is a shell-owned argv bridge, not
   E_command. Transparent middleware forwarding is permitted. Changed command,
   args, cwd or env for compound-bearing dispatch refuses2 before publication;
   function/registry resolution cannot receive an executable hidden initializer.
   Scalar-only middleware forwarding behavior MUST NOT be repaired or restricted.
4. Keep simple() redirect/prefix ordering. At genuine builtin entry globally
   validate expanded argv usage before any target publication. Preparation
   failure means none of the prepared declaration operands publishes; earlier
   expansion/redirection effects remain. Ordinary operand failures then latch1
   and continue; earlier successful declaration operands remain committed.
5. For each successful operand prepare a fresh stage containing value/kind,
   declaration membership, attributes, name/watch, local save and prepaid
   restoration together. Immediately before atomic publication check cancellation,
   then readonly, then stale. Earlier charged preparation is never bypassed to
   discover a later failure. No partially installed target or half attributes.
6. Retain RHS changes to target/other variables/files/output. Target mutation
   invalidates its watch rather than being overwritten by stale staged data;
   readonly beats stale if both changed. Scalar-only duplicate publication refreshes
   its own watch; it does not retry external staleness. No invocation transaction.

Function-local compound RHS observes the pre-local visible binding; only then
is its local stage installed. Standalone arrayAssignment currently combines RHS
and publication: future extraction MUST preserve its algorithm, not call it twice.
Inherited G8 supports existing bare-name operators through element zero with lazy
alternates/checked writes. Explicit indexed operators and unsupported scalar
operations stay refused; repeated aggregates splice left-to-right, not Cartesian.
Historical N13's different native effects stay contradictory, not rescored.

## 5. Deterministic printer and exact replay domain [R:RP/AR/RC; A]

All/filtered names sort ascending ASCII/code units; named requests retain order
and duplicates. Sparse indices sort numerically, never densely or by locale.
Attribute order is a/r/x, otherwise `--`; each record ends in LF. The state table
defines unset versus empty. Examples: `declare -rx n='v'`,
`declare -ar a=([2]='two' [9]='')`. No function records or invented empty-array
initialized/uninitialized distinction. Invalid imported host names refuse that
record1, not silent omission or invalid emitted shell code.

Encode maximal non-control runs in single quotes; apostrophe uses concatenated
`'\''`; C0 except NUL and DEL use individual `$'\xHH'` segments with exactly two
lowercase hex digits, closing each segment before following text. Empty is `''`.
Unicode scalar text stays literal UTF-8; no locale-sensitive Unicode escapes.
LF/CR/TAB are escaped, keeping one physical line per name. All substitution-looking
text is data. Exact scalar-value fragments (the record adds name/header/LF):

| Value | Encoded fragment |
| --- | --- |
| empty | `''` |
| `a'b` | `'a'\''b'` |
| `a` + LF + `b` | `'a'$'\x0a''b'` |
| TAB, CR, DEL | `$'\x09'$'\x0d'$'\x7f'` |
| literal dollar/backtick/backslash | literal inside a single-quoted text run |
| `é😀�` | `'é😀�'` (U+FFFD itself is valid) |
| NUL or lone UTF-16 surrogate | whole record refused1, zero bytes from that record |

Prevalidate representability of each entire record before its first output byte.
Ordinary refusal continues subsequent selected records with sticky1. For a=ok,
b containing NUL, c=later, named print emits only a and c in order, not a prefix
of b. Resource/cancellation/sink/cleanup failure stops instead. Record validity
is not atomic sink I/O: a sink failure can retain a partial valid record.

Replay covers ONLY ordinary valid names ABSENT at replay start, top-level in a
compatible virtual state with sufficient existing budgets. Compare exact declared
presence/kind/indices/values/readonly/export; do not merge into existing names,
readonly/local state or controls. Controls are inspection-only: OPTIND/getopts,
PWD initialization etc. are not roundtrip promises. No whole-process replay,
arbitrary byte-string claim or automatic eval. Existing ansiWord NUL truncation,
UTF-8 replacement and script-file decoding rules are not globally changed.
Future proof MUST exercise both public parseShell/Shell.exec and VFS scriptFile.

## 6. Private ledger, diagnostics and failure precedence [R:P4/DC/SL; I:G4A]

All declaration work, INCLUDING scalar listing and post-dispatch builtin
formatting, activates the SAME existing invocation ledger. Let B=maxExpansionBytes,
F=maxExpansionFields. Derive representable caps lazily in EXACT order:

| Counter | Cap |
| --- | --- |
| Live wrappers | F |
| Live private Map/WeakMap/watch slots | F |
| Live payload bytes | B |
| Live metadata bytes | 128F |
| Cumulative allocated bytes | 8B+512F |
| Cumulative allocated slots | 8F |
| Reserved work | 32B+256F |

After derivation, tentatively check requested generation/version/epoch tickets,
then those seven demand counters in order, atomically. Failed reservation changes
no counters/tickets. Only released live counters refund; no cumulative reset,
retry reset or per-declaration budget. Admission adds metadata64/work15.

**A private-role mechanics:** pre-admit names/membership/watch/dedup slots,
operand descriptors/text, pinned bindings, target stages, typed/scalar local saves,
snapshots, index/name vectors, comparisons, quoting fragments, argv spellings,
encoded chunks and diagnostics BEFORE reading/constructing them. Reuse logical
slot32, text metadata32, typed-wrapper128 charges; vector cells reserve metadata32
and allocatedSlots1 (not Map slots); headers metadata128/work8. Charge each scanned
UTF-16 unit and each numeric comparison before inspection; string comparison pays
for scanned units. Checked sums/products cannot overflow into under-admission.
Epoch-guarded enumeration cannot first allocate Object.keys/spread and charge
later. Reserve overlapping selection/scratch vectors for stable bottom-up merge;
reserve each copy/comparison before work. Pin values; scan/validate/count exact
UTF-8 bytes, then reserve fragments AND joined destination while sources remain
owned. Charge both passes. Encode in preadmitted chunks <=1024 bytes without
splitting surrogate pairs. No whole-list join/dense-index scan or uncharged
diagnostic fallback. Conservative coexistence refusal is valid, early source
release to hide overlap is not.

**G4A distinction:** new declaration-shell sorting/escaping/encoding, even inside
the builtin, is private. Only EXISTING registered-command formatting AFTER admitted
argv transfer is E_command under existing Budget/IO. Preserve the qualification
`private logical storage + E_input + E_post-transfer-command-formatting` and sink
retention's existing contract. No global stderr budget contract, total memory/RSS
claim, command-family budget change or hooks into command formatting are implied.

| Phase / failure | Required selection and continuation |
| --- | --- |
| Completed mutation/listing, empty filter | 0, unless ordinary1 already latched. |
| Admitted global usage / unsupported grammar | 2 before any declaration target; prior eager effects survive. Source grammar2 can be whole-file-preflight; computed runtime flags cannot. File loading/source admission may fail before parsing. |
| Identifier/query/readonly/type/export/control/domain/stale or serialization | Ordinary1 latches, applicable later operands/records continue; success never clears it. Preparation occurrence stops, not loop continuation. |
| Earlier preparation/private resource failure | Stops discovery and publication; normally1. Undiscovered usage/semantic error cannot supersede it. No global syntax-over-budget ranking. |
| Diagnostic capacity | Use already admitted capacity or checked reservation. If private capacity cannot admit diagnostic, stop1 with NO diagnostic; no uncharged bytes, reset or continuation. This is not suppressing an attempted sink/public-budget failure. |
| Public ShellLimitError | Public exec rejects, no ShellResult or invented125/126. Existing maxSource/argv/stage/output failures may precede declaration admission; F=0 does not promise builtin1. |
| Final target checks | Cancellation, then readonly, then stale, only after admitted preparation. Earlier external effects remain. |
| Escaping expansion/control | Preserve existing route: ParameterExpansionFailure127 non-isolated,1 isolated; other ExpansionFailure1/control flow. Do not normalize to declaration1. |
| Sink/EPIPE | Stop. Reached runtime EPIPE mapping141 remains; ordinary caught faults may map1; escaping diagnostic write can reject. Never recursively diagnose diagnostic failure or promise a universal sink mapping. |
| Caller/invoke/cleanup | Exact root-caller reason > actual escaping execution/control failure > ranked local invoke cancellation. Never infer provenance by reason equality or unmap an already mapped status. Drain registered cleanup/root barriers. Without caller/execution failure, sole cleanup failure rejects unchanged, multiple aggregate, even after nonzero result. Existing pipefail/early-pipe selection remains. |

Numeric results presuppose successful output/settlement. Resource refusal before
serialization discovery stops; discovered ordinary invalid record continues only
if its required diagnostic can be admitted/delivered. Existing ArrayFailure
diagnostic escape and generic runtime catch differ; integrate DC in declaration
paths without silently changing all shell stderr or opaque host outcomes.
File/interpreter126, source-EFBIG public budget and other commands'125/status
policies are distinct, not declaration numbers.

Register cleanup synchronously BEFORE ownership/resource admission; use the same
idempotent completion in finally. Close seals admission and drains cooperative
owned work/child scopes/root holds. Prepay restoration before local/temporary
publication, never in finally. Checkpoint cooperative scans/copies/merges/escapes/
drains; no preemption of flat primitives or opaque host work. Preserve bytes,
awaited backpressure, maxOutputBytes, destination-ownedOutput and chunk ownership;
closing stdout cannot cancel sibling file/header/stderr or the entire context.
Snapshot epoch changes refuse without retry. Already delivered bytes remain.

## 7. Integration and closure requirements [R:AST/RP; I; A]

SOURCES.md binds exact inspected private signatures/callsites and four necessary
FUTURE source touchpoints, with no edit authorization. Lazy internal declared-scalar
membership MUST be monitored, copied, saved, restored and cleared across initial
state, mutation/unset, local frames, overlays, snapshots, process and invoke paths.
No undefined-string/empty-string surrogate for absence. Existing value/attribute
membership remains visible before activation. Preserve scalar middleware overlay
A/B/write-B/restores-A behavior; successful same-name typed publication alone
supersedes that overlay. Preserve G8, controls and existing listings: no-arg set
refusal, scalar export/readonly JSON quoting, readonly-array listing refusal and
bare-local exported listing are NOT repaired or advertised as roundtrip paths.

**Public identity risk:** c0ada has private quote provenance. Identical public
shapes do NOT alone prove semantic compatibility; JSON cloning loses WeakMap/
WeakSet identity. Actual parser text merging, empty quote handling, prefix slicing,
alternate copying, declaration lowering, reader and runtime expansion MUST preserve
the right provenance together. Future evidence on the actual accepted successor
must cover same-input public AST descriptors/keys and distinct empty-aggregate
versus literal-empty/member/scalar behavior through source/installed/moved paths.
That successor is not accepted yet. No claimed public AST execution API or new
public marker/key/symbol/export is allowed.

MATRIX.md is finite required FUTURE proof, never passes; native-prepared data
is a separate observation-only set. Native capture needs a later independently
reviewed supervisor/control seal and explicit ROOT GO; none exists here. No
product/native/test/build execution occurred. All old40/8/2455 and independent
holdouts/history remain immutable, including N13 and historical supervisor defects.
Dirac can close the design against R/I/A labels and the matrix without inventing
new forks. Independent design closure is still required; it is not implementation
GO, arrays acceptance, native parity, a current full gate or superiority evidence.
