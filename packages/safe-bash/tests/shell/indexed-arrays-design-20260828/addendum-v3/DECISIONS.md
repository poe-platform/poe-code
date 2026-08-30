# Indexed-array policy recommendation v3 — August 28, 2026

**Decision document, not ratification, an implementation-ready freeze, or execution
authorization.** This bounded addendum replaces no historical bytes or results.
The table recommends one policy per finding; supporting sections make its costs,
effect order and remaining proof obligations explicit. All examples are unexecuted.

## Authority and bindings

The earlier `addendum-v2` “root-settled” staging/index labels were unsupported:
earlier root direction was a proposal/preference, not full ratification. **Now**
root explicitly chooses staged TARGET publication, no rollback of already-observed
RHS effects, and canonical literal decimal indices 0..2147483647. This settles no
other ordering, overflow, attribute or cap rule. Fresh independent public
`Shell.exec`/fresh ledger versus shared internal descendants/`invoke` was already
settled; no cross-exec or RSS guarantee follows. RHS-once and unchanged scalar
sequencing remain requirements, not permission to redefine accepted scalar paths.

Anchors are immutable: **R** = `c26892c3:src/shell/runtime.ts`; **B** =
`5137a74e:src/shell/<named file>`; **S** = `3e4cd743:src/shell/runtime.ts` and
`src/shell/shell.ts`. S runtime blob is
`9ff4aa32354f15901ed18e7e57aa30f812d34b14`; S shell blob is
`0ebf7efa77df77707d594fa55c89af4db891ee87`. Accepted selected composition
`099455f232870fa1ea59e1a0ae482e003fd170db` is a reconstructed composition identifier,
not an available loose object here; this packet does not reconstruct or certify
its entire tree. No moving-HEAD source substitution. DOTGLOB d2502 stays FROZEN,
not accepted by a new independent gate; neither its source nor investigation is
reopened. The user-supplied G039 reviewer-fixture/11-mutant-refusal correction is
not array evidence.

Locke `d4f3d9f91a8549ebdd3a222fbac04d379c6ce770` and Plato `0d70a9d4` are the
finding authority, not implementation approval. The native record has 16 launches,
14 exit0 and N12/N15 exit127, **not 16 passes**. N13 contradicts the historical
candidate. No observed capture escape, cleanup or byte violation; five STATIC
supervisor gaps and `STOPPED_FINAL_INTEGRITY` remain. No clean old document seal.

## One recommended policy table

| Finding; prior disposition | Concrete recommendation | Root choice / different-review prerequisite |
| --- | --- | --- |
| G1; partial | Whole-unit syntax refusal, then target checks and whole-assignment certain-overflow preflight; field-dependent overflow only after that RHS. Staged single-target transfer; readonly before stale only absent earlier failure. | Ratify §1 timing/status/no-op rules; independently review effectful neighbors, not native status imitation. |
| G2; partial | Finite charged scope/name watches, equality-only checked unique tickets, prepaid restoration identities, retire at last observer. | Ratify §2 costs/check order; review all same-value/ABA/restoration mutation paths. |
| G3; partial | Pinned, whole-state epoch-validated full copies; no retries, no mixed publication; synchronous guarded writers with async preparation. | Review §3 mutation inventory against the exact future candidate, including accepted STACK Symbol cloning. |
| G4; unsettled | Explicit existing-Budget input phase; token-owned array storage; pre-reserve private copies and overlaps. Narrow yielding claim to cooperative loops, not flat JS primitives. | Root must accept §4's narrower claim; different review must prove every ownership bridge or leave this open. |
| G5; unsettled | Intrusive prepaid release graph, dependency-ordered restoration and reference transfers, single-flight drains; no cleanup admission. | Review §5's operational schedule and concurrency/failure proof; names and credits alone are not closure. |
| G6; partial | Retain seven PRIVATE equations, lazy checked admission, fixed identity/counter order, private command-failure1 and existing bounded stderr. | Ratify §6 equations/low capacities/status; verify complete candidate peaks, not just this mathematical witness. |
| G7; partial | Exact 13 control names; refuse exported conversion/array export/prefix; typed local shadow; selected-only listing refusal; scalar child env. | Root explicitly chooses intentional N01/N02/N05/N16 differences; review §7 attributes and source bridges. |
| G8; partial | Exact literal grammar; blanket operators-on-indexed refusal before alternates; explicit field-splicing algebra, missing/empty and arithmetic boundaries. | Ratify §8 including N13 rejection and repeated aggregates; different review before expected fixtures. |

## 1. Observable effects and refusal order

1. Parse the complete admitted unit, retaining existing script-file unit boundaries
   (B parser.ts:274,439; R:1935). Malformed/excluded indexed syntax is syntax2
   before that unit executes, even in an unselected branch. Canonical decimals
   outside the domain are valid syntax, runtime command-failure1, not syntax2.
2. Preserve command-word expansion and redirect branches at R:1293–1355. At each
   array assignment's entry, capture the exact scope/name identity once. Check
   caller cancellation; known readonly; control-name/export restriction; then
   privately admit the planning walk. Check literal domains and statically certain
   cursor overflow in source order, admitting each next scan/work batch first;
   after successful planning admit stage ownership/publication tickets. Planning
   exhaustion wins over an error not yet reached. A later overflow reached by
   this walk suppresses **all RHS in that
   assignment**, but not earlier assignments, command words or completed redirects.
   Readonly therefore wins over a later domain error. No evaluation predicts arity.
3. Preflight tracks only syntax-proven field counts; unknown arity poisons cursor
   knowledge until an explicit reset. Traverse once for planning, never expand
   during planning. At execution each RHS expands once in source order. A demanded
   out-of-domain field fails before insertion, after that RHS's completed effects;
   no later RHS runs. Read old/live target, never partially staged entries.
4. At final publication/no-op validation after the last await: caller cancellation
   wins over an already escaping execution/control error, which wins over local
   cancellation. Without those outcomes, current readonly wins over stale
   scope/generation/version. Both latter
   conflicts are failure1. Never turn an already mapped result status into a new
   escaping failure. Publication uses pre-reserved tickets/ownership, not another
   admission; transfer stage synchronously after the final checks.
5. Failure releases only operation-owned storage, never resurrects the old target
   over RHS mutations. Existing expansion/Flow/ShellLimitError classes remain.
   New private/domain/conflict refusals are ordinary command-failure1 in bash/sh;
   surrounding `&&`, `||`, errexit and existing special-builtin rules still apply.
   Scalar R:1301 RHS-before-readonly/sequential writes/restoration remain unchanged.

| Cursor case | Exact recommended result, subject to entry/final guards |
| --- | --- |
| Maximum present index; `a+=()` | Validate even though no fields; success, no publication/version advance. |
| Maximum present index; `a+=([0]=x)` | Explicit zero resets cursor and can publish. |
| `[2147483647]=x [0]=y` | Exhausted sentinel after first insert, reset by second; no unused-increment error. |
| Implicit RHS yields zero fields | No cursor consumption; effects persist. If entire append yields zero, final guards still run, but no publication/version advance. |
| Exhausted cursor; next RHS has a demanded field | Syntax-certain demand fails at preflight; otherwise expand once, fail before first invalid insert. |
| Replacement `a=()` | Publishes indexed-empty, including same-value empty replacement; this is a mutation. |

Zero-field append is not a “successful mutation”; this resolves the old no-op
versus same-value-write wording conflict. Explicit indexed assignment has one
unsplit RHS field (including empty); implicit compound words use normal fields.
Maintain a charged cached maximum on each indexed binding; no unadmitted map
scan to initialize append preflight. Deleting that maximum recomputes it by
scanning only present slots under charged work, never the numeric range.

## 2. Names, identities, reservations and retirement

Allocate a watch only while a stage, frame, prefix/overlay or snapshot observes
a scope/name. One watch is 64 metadata bytes, one owned name token (32+UTF8),
embedded reference edges and prepaid release work. Absent watches/tombstones have
the same charge. Scope objects, observer records and saved frames cost 64 each.
No permanent per-name map survives final observer release; retirement removes
the scope/name table entry and releases its edges. A later watch receives fresh
identities. No content-keyed string deduplication.

Use one lazy invocation ticket allocator, safe integers starting at 1, never
wrapped/reused. A guarded mutation reserves distinct generation, version and
whole-state epoch tickets **before mutation**; changing every publication's
generation is deliberately conservative. Same-value writes, repeated unset while
watched, attribute writes, absent local shadows and restoration all invalidate.
No-op append alone does not. Snapshot/reference pins keep old tickets meaningful.
Allocator exhaustion refuses before state changes, not after counter wrap.

Before installing each temporary local/prefix/overlay, reserve its saved typed
state, restoration edges, THREE restoration tickets and restoration work. Saved
absence includes an explicit shadow preventing early outer lookup. Repeated local
saves only once; restoration reinstates presence, kind, members, export/readonly
and OPTIND cursor/integer metadata. Reserved restoration tickets may numerically
precede tickets published later; compare **equality only**, never time ordering.
Transfer saved edges on restoration; no fresh allocation, ticket or finally
admission. Overlays whose ownership was superseded release their unused reserves
without restoring; issued tickets and cumulative credits remain spent.

The finite allocator is invocation-wide, not unbounded name history. Unobserved
scalar-only execution does not instantiate it. Once active, every clone-visible
mutation advances its state's epoch; only watched/typed names need binding tickets.
Synchronous scalar arithmetic may reserve fixed tickets/checks synchronously;
it must never trigger an asynchronous private string-copy setter.

## 3. Snapshot algorithm and actual mutation sites

Choose optimistic **whole-state** validation, not immutable-map copy-on-every-write.
Before a full copy, register ownership, pin the source state/map owner, capture
its epoch, and reserve destination headers. Within a synchronous chunk: check the
epoch, visit slots, acquire owned value references and copy attributes; charge the
sum. Never retain a borrowed slot/value across an await before acquiring its edge.
After every await and before exposing the clone/saved snapshot, require the same
epoch. Mutation of any clone-visible variable, attribute or field invalidates the
entire copy: failure1, discard partial destination, **no retry or repeated RHS**.
Pinning prevents source-owner reclamation, not writes; validation prevents mixed
publication. Synchronous chunks cannot interleave ordinary JavaScript callbacks.

Epoch coverage includes values/absence/kind, exports, readonly, functions, locals,
positional/version, cwd, getopts, flags, depths, status/substitution status,
redirect assignments and STACK entries/bytes/publication token. Clone snapshots
do not silently preserve a mixture of cross-variable or attribute moments.
All newly retained scalar/name/positional tokens and new state/Set/Map/frame
metadata in an array-bearing clone also require admission; shared AST/source
references keep their existing source owner pinned. The small §6 witness does
not exempt a larger real clone's scalar or function-table inventory.

| Source-backed writer/copy (R unless S stated) | Required future integration, not an existing helper claim |
| --- | --- |
| `saveVariable`/`restoreVariable` R:293,297; `cloneState` R:278/S:280 | Full typed snapshots; guarded chunks; preowned restoration; clone epoch starts as a distinct state identity. |
| `writeVariable` R:794/S:924; `unsetVariable` R:817/S:947 | Scalar-to-zero, element deletion, same-value, whole unset and control metadata all publish via reserved guard. |
| `arithmeticVariables` R:824/S:954 | Add checked reads as well as writes; indexed bare/bracket access refuses. No async Proxy setter. |
| assignment/prefix/redirect copy-back R:1301–1360/S:1430–1490 | Cover direct object writes, temporary exports, saved-prefix edits and finally, not only setter calls. |
| middleware R:1407–1420,1477/S:1539–1614 | Cover env insert/delete/export, cwd, positional restoration and token-owned typed overlays. |
| declaration/unset R:2331–2370/S:2610–2645 | Cover export/readonly Sets, absent local deletion, frame creation and PATH flag. |
| read R:2413,2441/S:2695,2721; getopts R:2219–2246/S:2373–2377; for R:1049/S:1179 | Async caller prepares zero-write; preserve consumed input/scanner/list and earlier writes. |
| substitution R:2488; invoke R:2102/S:2234; shebang S:1867; process S:1748 | Copy whole typed state for clone paths; process env-only construction does not inherit arrays; keep shared ledger. |
| function definition S:1130; function frames S:1559–1576; source/positional/control S:2204–2217,2572–2595 | Include function Map insertion, local push/pop, non-variable fields and restoration, not a variable-only epoch. |
| pipeline/subshell/inline-input clones S:1038,1140,1428; expansion fast reads S:2798,2954 | Every clone uses the same snapshot protocol; every fast variable read resolves typed zero/aggregate semantics, not Map coercion. |
| accepted STACK S:280–287,2445–2453,1608; S shell.ts:246–247 | Preserve copied stack entries/bytes and the exact Symbol value through spread clone; publish a fresh Symbol only on accepted cwd publication. Epoch is additional, not a replacement for Symbol ownership. |

This is a source-grounded integration checklist, **not proof of complete future
instrumentation**. Different review must enumerate direct assignments/Set/Map
writes in the exact candidate, including exception paths and every state clone.

## 4. Ownership phases and the explicit flat-string limit

Private token identity is an allocated ownership record, not observable identity
of primitive strings. Sharing requires passing that token; independent equal
strings pay independently. UTF8 scan: surrogate pair costs two UTF16 scan units
and four bytes; lone surrogate one scan unit/three replacement bytes. Code-point
length counts incrementally. Repeated scans and materializations cost again.

| Phase | Admission, overlap and release |
| --- | --- |
| Existing source/literal/scalar/substitution input | R:135 Capture chunk copies, R:2508 capture concatenation/decode/trailing-newline removal, R:2525 alternate joins and R:2658 value/escape buffers are existing-Budget allocations, NOT private preallocation. Keep their source owner until private handoff finishes. Existing Budget does not bound total live input memory. |
| Retain an existing input string | Scan under existing input ownership, reserve token/header/payload and release graph before retaining it. Transfer logical ownership only if source actually relinquishes it; otherwise charge a separate retained private owner while the existing phase remains live. No retroactive allocation claim. |
| Array-derived expression | Reserve chunk headers, reference vectors, UTF8 payload and work before copying/concatenating/escaping. Slices are not presumed zero-copy. Split/glob results and pattern escapes have separate tokens/fields; unknown expansion admits each chunk/result before retention. Existing filesystem enumeration internals remain a named existing phase, not free private storage. |
| Capture/decode of new array-owned bytes | Reserve owned byte-copy capacity before advancing producer; borrowed Buffer views are not ownership. Streaming decoder retains an admitted carry buffer; reserve decoded string capacity using checked worst-case 3×input bytes, then release unused live reservation only after actual size known. Cumulative reservation remains spent. |
| Numeric sorting/aggregate fields | Two N-slot index vectors plus two headers, retained through merge sort; fields reference tokens. Charge each comparison/move; no builtin sort or `Array.from` for new array loops. |
| Flat join/escape/argv bridge | Precompute checked UTF8/UTF16 totals, reserve destination token and full payload while all input chunks/fields remain charged; reserve join-vector metadata too. Then one flat primitive materialization. Transfer only that token into argv; input refs release when no longer retained. A second independently constructed flat string pays again. |
| Encoding/output | Reserve encoded byte token/full capacity while flat string and argv remain live. Prefer bounded encoding pieces; if a synchronous builtin makes a whole buffer, precharge the whole bridge and disclose it. Await sink writes; release output only after its declared destination-specific ownership ends, not on sibling stdout close. Opaque host retention is outside this guarantee. |

Each vector costs 64+32 per field/chunk; byte/string tokens cost 32+payload.
Escaped and unescaped strings overlap and both count; a zero-copy ownership
transfer moves the existing edge/credit, not allocation totals. Owned input
chunks, full flat output and encoded output may all coexist; §6 includes them
for its selected flat bridge and explicitly carries existing-phase memory E.

**Recommended narrower claim:** every 128 charged units in new cooperative scan,
copy, sort, split and release loops checks/yields using the existing checkpoint,
with one carried counter across helpers. No claim of yielding within a synchronous
flat join, engine string allocation, builtin encoding, accepted parser, existing
Capture/decode or regexp primitive. Charge/reserve a flat bridge before invoking
it and checkpoint immediately before/after; this is not preemption, deadline or
RSS control. Do not introduce a new API/framework or main-thread regexp evaluator.
If root requires per128 yielding inside those primitives, G4/G5 remain blocked;
calling a primitive “chunked” cannot satisfy that requirement.

## 5. Operational cleanup, not fresh finally work

Register one idempotent operation close callback synchronously with existing
`InvocationScope` before acquisition (B cleanup.ts:33). Each scope/object header
contains its preallocated intrusive pending link and completion state; no queue
node/promise creation per released slot. Admission prepays these logical actions:

| Acquired item/action | Exact reserved release units |
| --- | ---: |
| Map slot | visit1 + delete1 + slot-release1; value edge separately decrements1 |
| Vector field/index slot | visit1 + slot-release1; object edge, if any, separately decrements1 |
| Strong edge | decrement1, once; transfer moves that existing credit |
| Header/token | enqueue1 + dequeue1 + final-header-release1 |
| Scope/ledger admission gate | close1 |
| Saved binding restoration | five publications: pointer1 + attributes1 + generation1 + version1 + epoch1 |

Reserve all outgoing-edge decrements and eventual final-release headers at
acquisition, including values currently shared. A 2→1 decrement frees no payload;
the last decrement queues the already-owned final release. Never charge twice or
refund cumulative work. Live reservation slack may fall only when no allocation
can still consume it. Restoration transfers saved edges; displaced edges use
their existing decrement credits. Watch-table removal is a Map slot and must be
charged as such (§6 explicitly includes it).

Closing seals admission synchronously, requests the preowned dependency drain and
returns the same completion promise to overlapping callers/finally. A single
logical drainer consumes intrusive nodes in bounded batches. Parent frames have
prelinked child-completion dependencies: restore inner frames/overlays before
outer frames on the same state, then release displaced owners. Independent
states may drain concurrently through shared refcounts; no reliance on callback
registration order or `InvocationScope.close()`'s concurrent `Promise.all`
(B cleanup.ts:46). Child work already admitted must settle through its tracked
cooperative owner before its restoration becomes eligible; no polling/retry
allocation and no new host acquisition in cleanup.

Restoration bypasses readonly checks on the temporary binding but restores saved
attributes; it never bypasses saved ownership/dependency checks. Overlay restoration
requires its installed token/version still owns the name; local restoration does
not disappear merely because the inner value changed. Primary caller abort and
escaping execution/control failure keep their existing priority; cleanup errors
are observed, not substituted or silently swallowed. Public settlement waits for
registered cleanup/root barrier, not arbitrary uncooperative host work.

The algorithm requires different-review proof of queue capacity, all reference
edges, scope dependency acyclicity and no new allocation in restoration. This
document supplies a schedule, **not a demonstrated no-fail implementation**.
In particular, attribute restoration must transfer preowned typed attribute
storage, not allocate new Set entries in finally. Dependency links occupy the
reserved owner headers; if a candidate materializes additional nodes/promises,
their storage and release credits must be added before acquisition.

## 6. Private caps, diagnostics and a complete logical peak witness

Retain B=maxExpansionBytes, F=maxExpansionFields and the seven prior equations:
wrappers F; sparse Map slots F; payload B; metadata 128F; cumulative allocated
bytes 8B+512F; cumulative slots 8F; cumulative work W=32B+256F. Map slots now
explicitly include watch-table entries: this widens the charged category, not
its equation, and needs root approval. No public limits. Derive lazily with
exact integer arithmetic; reject unrepresentable derived caps, never saturate or
invalidate unrelated scalar-only exec. For each reservation check: derived-cap
representability; generation capacity; version capacity; epoch capacity; then
wrappers, Map slots, payload, metadata, cumulative bytes, cumulative slots, work
(including cleanup credits). All checks precede ticket issuance/counter updates
and allocation. Check additions using amount <= cap-current, not rounded sums.

First failing check selects one fixed diagnostic/category, e.g.
`indexed array: private metadata limit exceeded`; identity failures name
`generation`, `version` or `epoch`. Failure1 is an ordinary command failure,
not a new ShellLimitError or unconditional assignment Flow. Subsequent scalar
commands may run when existing surrounding control permits; spent array counters
never reset. Use the existing diagnostic sink, one fixed-size private message per
failed operation, without interpolating an unbounded name. Existing maxOutputBytes
and command budget still bound repeated diagnostics. Caller cancellation wins;
an escaping sink/public-output failure keeps its existing class. No emergency
unbudgeted output, fallback write or claim of guaranteed diagnostic delivery.

### Peak witness (arithmetic only, no resource or product execution)

`PEAK.json` is the recomputable schedule. B=4096,F=64; old has two ASCII values
of lengths3,5; stage has those plus length7; saved local copies old; child clone
copies stage. One name length1; shared tokens only. Both three-index sort vectors,
one three-field join vector, one flat join of length17, its encoded bytes17 and
one argv field remain live immediately before sink emission.
There are no additional private input chunks in this selected token-to-flat bridge.
Any other actual chunks, alternate/pattern copies or existing input E must be
added, never inferred free. Four wrapper/map owners coexist: old, stage, saved,
clone. This is a deliberately held-overlap graph, not a claim one native recipe
produces it or a universal peak for all expressions.

| Simultaneous storage | Metadata bytes | Payload | Slots |
| --- | ---: | ---: | ---: |
| Ledger + four owner records (root, operation, saved frame, cloned state) | 320 | 0 | 0 |
| Watch + restoration record + snapshot-pin record | 192 | 0 | 0 |
| Watch-table header + one entry | 128 | 0 | 1 Map |
| Four wrappers + four map headers | 512 | 0 | 0 |
| Ten value-map slots | 640 | 0 | 10 Map |
| Name and three value token headers | 128 | 16 | 0 |
| Two three-slot sort vectors | 320 | 0 | 6 scratch |
| Three-field join vector | 160 | 0 | 3 scratch |
| Flat join + encoded output token headers | 64 | 34 | 0 |
| Argv vector + one field | 96 | 0 | 1 scratch |
| **Peak** | **2560** | **50** | **11 Map; 10 scratch** |

Objects=27; embedded edges=45 (enumerated in JSON), no extra out-of-line reference
allocations. Wrapper/name/map/header references are not omitted. Cumulative
bytes=2610; cumulative slots=21; wrappers4; each cap fits. The witness performs
one bulk prepaid graph admission and no discarded copies; cumulative equals live
allocation here, not generally. Its complete DECLARED logical work schedule is
in JSON: header creation, slot construction/visits/lookup/insertion, references,
scans, payload materializations, sort comparisons/moves, identity/admission/guard
actions, output emission and the full final-release graph. This is an accounting
witness under these declared unit costs, not a count of executed JS operations.
Candidate-specific extra guards/copies/edges cost additional units.

Cleanup credits=3×27 headers +3×11 Map slots +2×10 vector slots +45 decrements
+5 gates +5 restoration publications =189, all charged to W BEFORE acquisition.
No reuse of these credits for forward work; no refund at teardown. Whole-graph
release leaves live counters zero, cumulative bytes/slots/work unchanged.

Private combined payload peak is50, metadata2560, allocation2610. Total logical
cross-phase storage is **2610+E**, where E is independently owned existing
input/capture/source/output storage, not supplied a finite live cap by this proposal.
An existing sink's retained output copy increases E; it is not a private transfer.
Physical string width/ropes/GC, builtin temporaries and host retention are not RSS.
At B=0 no nonempty name is admitted; at F=0 no headers, at F=1 metadata128 cannot
hold even wrapper+map+name-header160 before mandatory watch/owner overhead. F is
not usable member capacity. With F=4, old2+stage3 already exceeds Map slots before
watch/save/clone overhead. At default B=16777216,F=10000 cumulative bytes139337728
and W539430912 remain merely finite logical ceilings, not latency evidence.

## 7. Scalar, control, attribute and environment boundaries

Recommend exactly **PATH PWD OLDPWD HOME CDPATH IFS OPTIND OPTERR OPTARG REPLY
LANG LC_ALL LC_CTYPE** as conversion refusals. R:1579,2029 path; R:2264–2281 cd;
R:2418,2515,2695 IFS; R:795–821,2219–2246 getopts; R:2413 read; B locale.ts:1–4.
S STACK additionally reads HOME for display (S:2458) and uses existing cd/PWD
paths; it adds **no DIRSTACK binding**. Preserve internal STACK, not invented
array/env semantics. LC_COLLATE/TMPDIR were boundary-only consumer observations
in old CHOICES, not new core refusals. No blanket LC rule or invented RANDOM,
SECONDS, TERM, COLUMNS/LINES semantics. Any newly discovered consumer is a
separate source-bound proposal; moving HEAD cannot enlarge this inspected list.

| Boundary | One policy, including effects |
| --- | --- |
| Exported scalar or exported-unset to indexed | Refuse1 before array RHS, retain membership/value. Whole unset then indexed assignment is the explicit path. |
| Export indexed / `export a=value` | After existing all-argument expansion, refuse1 at that operand, before zero write or export bit. Earlier operands remain. No array serialization. N01/N02 allow GNU arrays: intentional gap. |
| Standalone `a=value`, `a+=value` when indexed | Write/append zero preserving other members/kind, with accepted scalar sequencing and readonly timing; convert scalar to indexed only for explicit indexed forms. |
| Scalar prefix on indexed `a=RHS command` | Expand command words; follow existing redirect branch; expand this prefix RHS once; then refuse1 before temporary publication or dispatch. Earlier effects/prefixes are not undone except their existing temporary restoration. N16 permits native scalar shadow: intentional gap. Indexed/compound prefixes remain syntax2. |
| Local | After declaration argument expansion/identifier/readonly checks, save once; indexed outer gets fresh indexed-empty or zero=initializer, not copied members. Scalar/absent outer retains scalar local behavior. N05 shows scalar GNU local; N06 does not inspect initial initialized-local kind. Typed shadow is an explicit project choice. |
| Unset local / readonly / restore | Unset keeps absent local shadow; next plain assignment is scalar. Readonly outer forbids local. `readonly a` freezes entire indexed binding; `readonly a=value` writes zero then freezes only on success. Missing readonly name remains scalar-unset+attribute. Restore all saved attributes even after inner readonly; N07/N08 are narrow observations only. |
| Listing | Preflight selected names only: readonly set for readonly; exported set otherwise, including current no-argument local (R:2331/S:2611). Selected indexed binding => refusal2 before stdout. Unselected arrays do not poison listing. Preserve existing scalar JSON/options; do not add export -p. |
| read/getopts/for | Zero write after existing input consumption/earlier fields, scanner OPTIND/OPTARG effects, or for-list expansion respectively; before subsequent body. Refusal never promises no prior input/effects. |
| Child env / replaceEnv | Own-key iteration into null-prototype records, including `__proto__`, `constructor`, `toString`; validate all scalar entries and readonly collisions before any child shadow. Explicit env shadows whole binding, never zero; omitted unexported arrays survive clone paths. replaceEnv true uses exactly supplied exports (omitted empty), no inherited PWD/local promotion; process interpreters retain documented initialization distinction. Parent untouched. |
| Middleware | Pre-admit all typed saves/scalar shadows after upstream effects, before overlay publication; readonly collision refuses before dispatch. Restore only matching overlay token/version, not R:1479 value equality. Downstream same-value write counts as new ownership and survives. Keep accepted cwd/STACK Symbol ownership separately. |

No integer/case/nameref/declaration-a attributes become supported here. Whole
unset removes eligible kind/export/readonly bookkeeping; readonly prevents it.
The exact new attribute semantics need root choice and different review, not an
inference from native listings or existing scalar tests.

## 8. Grammar, operators and field algebra

| Context | Supported / refused |
| --- | --- |
| Assignment-only | `a[index]=word`, `a[index]+=word`, `a=(words)`, `a+=([index]=word words)`; compound explicit words set cursor, implicit words produce fields. Scalar conversion retains zero except replacement clears it. No command prefixes. |
| Literal index | Exactly bare `0` or `[1-9][0-9]*`, or the entire same literal singly/doubly quoted. Reject concatenated fragments, signs, leading zeroes, whitespace, empty, expansion, arithmetic/base/negative/multidimensional forms. Canonical out-of-domain decimal fails1 at evaluation, before RHS, not parse2. Scan arbitrary invalid length under existing source/parser bounds; no fictitious ten-character invalid-input bound. |
| Reads | `$a`, `${a}`, `${#a}`, `${a[index]}`, `${#a[index]}`, `${a[@]}`, `${a[*]}`, `${#a[@]}`, `${#a[*]}`. Bare uses zero; counts count present members, not max+1. Length counts code points. |
| Element/subscript operators | Default/error/assignment, pattern/removal/replacement, substring/slice operators on explicit subscript/aggregate syntax: syntax2 for the complete unit, before any execution. Also reject indirection/`${!a[@]}` and array presence tests. |
| Bare-name operators | Existing syntax remains parseable for scalars; if resolved binding is indexed, **all** default/alternative/error/assignment/pattern/substring forms refuse ordinary command-failure1 on reaching the expansion, before alternate/pattern/replacement/offset evaluation, even when an alternate would not be selected. Earlier word effects persist. Actual scalar behavior unchanged. This rejects historical N13 candidate; no special `${a:=...}` exception. |
| Unset operands | Whole name or expanded operand spelling `a[index]`/`a[@]`/`a[*]`; literal canonical subscript only. Element removal retains indexed kind; aggregate unset clears members and retains kind; whole unset removes binding. Bad operand grammar fails2 after argument expansion; canonical domain failure1 before deletion. Missing scalar/array element is a no-op; scalar zero deletion clears value while preserving scalar attributes. Readonly check precedes domain/mutation. |
| Arithmetic | Both bracket syntax and bare-name reads/writes of indexed bindings refuse; bracket exclusion syntax2 where statically recognized, runtime kind-dependent bare access uses existing arithmetic ExpansionFailure path. No indexed coercion or mutation; scalar LET limits/semantics remain. |
| Exclusions / ordinary argv | Associative arrays, namerefs, arithmetic indices, declaration-a/typeset/mapfile/readarray remain excluded. Quoted normal argv resembling `a[1]=x` is not reclassified as assignment; only actual assignment/parameter/unset contexts apply. No parse-all relaxation. |

Absent, scalar-unset+attributes, scalar-empty, indexed-empty, missing-zero sparse
array and present-empty-zero stay distinct. Scalar `[@]`/`[*]` yields one member
iff scalar value is set (empty counts); unset scalar/absent yields none. A scalar
literal index0 reads its value; other indices are missing. Missing element/bare
zero expands empty; quoted value form produces one empty field, unquoted normal
splitting may remove it; length0. Indexed-empty aggregate counts0, present-empty
member counts1; last deletion retains indexed kind. No silent array-to-scalar
conversion on missing reads.

**Field algebra (proposed, not GNU evidence):** preserve ordered member boundaries
and quote flags. A word accumulator has a current field plus a `present` flag.
Literal/ordinary scalar fragments append to the current field. Quoted `@` emits
numeric-order members: attach first to current, emit boundaries for subsequent
members, leave last current for suffix; zero members do nothing. Entire word
containing only zero-member `@` expansions yields zero fields; surrounding literal
text or an explicit empty quoted scalar fragment retains its field. Repeated
aggregates use the same left-to-right splice, **not Cartesian product**: members
`[A,B]` then `[C,D]` with literal `:` between give `[A,B:C,D]`. Zero-member fragments
never delete previous text or invent separators. Adjacent/repeated `*` fragments
are ordinary scalar concatenation.

Quoted `*` always produces one scalar, including empty for no members, joining
with space when IFS unset, no separator when empty, else its first Unicode code
point. Unquoted `@` and `*` both splice member boundaries without a join, then
apply existing splitting/globbing to unquoted spans; empty unquoted members may
vanish, quoted empties do not. Prefix/suffix/repeated aggregates use the same
splice rule before split/glob. IFS unset/empty/Unicode splitting remains the
accepted scalar profile; this adds no locale/dotglob change or Unicode oracle
claim. Every intermediate vector/escape/string is subject to §4 accounting.

## Exact disposition required next

Root should explicitly accept/reject the eight table rows and numbered sections,
especially whole-assignment static overflow suppression; no-op validation; finite
watch/ticket rules; conservative whole-state conflict; narrowed flat-primitive
yield claim; cleanup schedule; equations/status/check order; intentional attribute/
environment gaps; and blanket operator/refused/repeated-aggregate grammar.
Different review must then reconcile actual candidate mutation coverage, full
ownership peaks and release dependencies before any implementation-ready claim.
This static addendum seal authenticates only its own documents/referenced blobs:
**it does not clean, replace or reopen STOPPED_FINAL_INTEGRITY**. No supervisor
repair, whitelist, retry, new native recipe or resource experiment is proposed
as part of this bounded task.
