# Indexed arrays: precode closure recommendations

2026-08-28. Additive to `100685da` / `a3023e0d`; those inputs/results stay sealed.
Only independent design evidence changes. No product/native/model execution,
package build, XAN action or implementation window is implied.

## Disposition, correcting the earlier circular gate

**No inherent inconsistency was found in finite watches, shared tickets or
reserved cleanup.** The choices below give a coherent design that can be
implemented; demonstrating that a particular implementation obeys it is a
**post-code acceptance obligation**, not a prerequisite to authoring code.
The earlier request for a mechanical certificate before GO is narrowed accordingly.

Root has now ratified G8's existing bare-name operators as indexed element-zero
views and the exact frozen splice vectors. G1/G4 are closed; G3 is conditional on
complete candidate mutation coverage. No further G8 policy vote is requested.
G2/G5 can be **normatively ready** with the concrete mechanisms in table M.
Tables C/E/O recommend the remaining G6/G7 choices for root to ratify; they are
not silently promoted to root decisions here. After those choices, there is no
remaining design-level blocker identified by this review.

## M — mechanisms, not pre-implementation proof demands

| ID | Concrete recommended rule | What remains after implementation |
| --- | --- | --- |
| M-A | One invocation-wide allocator holds `lastIssued`, initially0, within 0..MAX_SAFE. Tentatively reserve the requested generation, version, epoch tickets in that order against a local cursor; check all caps; then commit the cursor/counters together. Never form a Number MAX_SAFE+1 sentinel. Watched/typed binding publication uses all three; an otherwise unobserved clone-visible state mutation needs epoch only. No reused or rolled-back issued tickets. | Actual reservation helper, all writer paths and near-end capacity controls; M01–M03. |
| M-B | A watch has a bounded external-observer count distinct from strong refcount. Its table edge is not an observer. Last external observer synchronously detaches the table slot using its prepaid credit; queued final release then drops table/name edges. A reacquired watch gets fresh identities, even for absence/equal strings. | Actual detach/refcount/ABA/retirement behavior; M04–M06. |
| M-C | Use a rooted acyclic ownership graph: parent owns child; any child-to-parent link is borrowed and valid until child drain settles. Reference-counted payload sharing is separate. Admission preallocates intrusive close links/completion state; close seals admission, returns one completion, drains children, restores, then releases. Each header queues at most once. | Candidate-specific graph, lifetime and overlapping-close traces; M07–M09/M21. A different implementation may satisfy the same invariants with an explicitly proved edge-breaking protocol, not unbroken refcount cycles. |
| M-D | Before temporary publication, reserve saved typed state/attributes, restore tickets and all release/dependency work. Restore transfers those owners/tickets; no new admission/Set growth/per-slot promise in finally. Reserved tickets can be numerically older than current tickets: identity comparison is equality only. Unused reserves stay cumulatively spent. | Loaded candidate failure/abort/restore controls and source accounting, not a prospective promise that all finally paths are already fixed. |
| M-E | All array-active clone-visible mutations, including direct writes, status/control fields and accepted `dotglob`, update epoch. Any publication guaranteed to finish during cleanup uses its pre-reserved epoch ticket/work. Ordinary transitions reserve before visible mutation; no retry after mixed-snapshot detection. | Exhaustive writer/clone inventory against exact candidate; M17/M22 and additional candidate-specific paths. This is G3's existing condition, not a new public API. |

Two tempting implementations are wrong, not contradictions in this design:
independent `remaining >= 1` checks on one shared allocator; and waiting for a
table-owned watch's total refcount to reach zero before removing the table edge.
The local cursor and external-observer detach rules resolve them finitely.

## C — G6 counters and refusal order

| ID | Recommended decision | Alternative not selected |
| --- | --- | --- |
| C1 | Keep seven caps: wrappers F; **all private Map slots including watch table** F; payload B; metadata128F; cumulative bytes8B+512F; cumulative slots8F; reserved work32B+256F. Vectors cost metadata/cumulative slots, not the Map-slot cap. Live counters refund only released ownership; cumulative counters/tickets never refund. | Counting only value slots, silently increasing F, or promising F usable members. |
| C2 | Derive exactly/lazily on first private admission. Check representability in equation order: wrappers, Map slots, payload, metadata, cumulative bytes, cumulative slots, work. First unrepresentable result wins; no saturation. Unrelated scalar-only exec never instantiates this admission. | Rounded Number products, clamping, or rejecting scalar-only execution at shell construction. |
| C3 | One reservation checks derived capacities; tentative generation/version/epoch availability for tickets actually requested; wrappers; Map slots; payload; metadata; cumulative bytes; cumulative slots; reserved work **including cleanup**. No ticket/counter/allocation changes from a failed reservation. Prior successful reservations remain spent. | Arbitrary diagnostic order or rollback of prior admissions after later failure. |
| C4 | W measures **admitted/reserved logical work**. A successful reservation includes its checks; a rejected reservation is one terminal fixed-size admission probe, with no retry inside that operation and no failed counter commit. Existing command/output/error handling remains bounded by existing policy. Do not claim W counts every interpreter instruction or that a failed gate consumes zero CPU. | Requiring a failed gate to reserve work by recursively calling the same failing gate; secretly retrying denied work; or a universal CPU/latency claim. |
| C5 | Private/domain/conflict refusal is ordinary command-failure1 with the existing diagnostic sink/control rules, not a new unconditional Flow/ShellLimitError. Caller/escaping errors retain their existing identity/priority. A mapped child status does not become an escaping error. Fixed diagnostic core below, no unbounded name interpolation. | Blanket fatal exit, emergency output outside Budget, or replacing a sink/caller error with the private refusal. |
| C6 | Admission is phase-local, not a global error oracle. G1's entry checks and static planning occur in their ratified order. Selected scalar operator alternate runs in its existing lazy phase; final readonly precedes stale. A failed reservation can prevent a later scan/guard from being reached; already completed effects are not undone. Pre-reserve final guard work before the last publication checks. | Running all possible checks at the start, undoing RHS effects, or treating final readonly-before-stale as readonly-before-every-cap-in-every-phase. |
| C7 | Delete-maximum computes the replacement maximum over **present slots**, under charged work, validates the watched target, then publishes deletion plus cache together. Failure before publication preserves both. Bulk same-name updates likewise publish their pre-admitted fields/attributes/tickets in a synchronous no-await step. | Delete then scan, leaving corrupt cached maximum on failure, or scanning 0..2147483647. |

### Diagnostic cores (new private failures only)

Use labels `wrapper`, `Map slot`, `payload`, `metadata`, `allocated byte`,
`allocated slot`, `work`, respectively, in C2/C3's order. Recommended cores:

- Unrepresentable: `indexed array: private <label> capacity is not representable`.
- Limit: `indexed array: private <label> limit exceeded`.
- Ticket: `indexed array: private generation capacity exhausted`, then version,
  then epoch, according to tentative reservation failure.

The existing shell supplies its contextual prefix/line/newline. This does not
replace existing readonly, expansion, caller, output-limit or syntax diagnostics.
For B=MAX_SAFE,F=0, C2 selects allocated-byte representability before work; for
simultaneously failing metadata/work with representable capacities, C3 selects
metadata. Empty/header costs still apply at B0/F0/F1. Fixed rejection probes are
an explicit boundary of reserved-work accounting, not an uncharged traversal.

## E — G7 exact effects and scope

R denotes `c26892c3:src/shell/runtime.ts`; D denotes accepted
`d2502aae:src/shell/runtime.ts`. No mutable HEAD authority.

| ID | Recommended decision / phase | Source behavior or intentional difference |
| --- | --- | --- |
| E1 | Refuse conversion of PATH/PWD/OLDPWD/HOME/CDPATH/IFS/OPTIND/OPTERR/OPTARG/REPLY/LANG/LC_ALL/LC_CTYPE and exported scalar/unset at the ratified target-entry phase before array RHS. Whole unset is the explicit eligible conversion path. | No new blanket LC rule, DIRSTACK variable or array serialization. New array conversion restriction; not a claim native arrays refuse these names. |
| E2 | For export of indexed bindings, expand existing arguments first, process operands in order, refuse that operand before zero write/export bit. Earlier operands/expansion effects survive. Scalar prefix on indexed: preserve command-word/redirect sequencing, expand that RHS once, refuse before shadow/dispatch; restore only existing temporary earlier prefixes. | R:1293–1360 and declaration loop R:2331 onward define scalar phases. Native N16 permits prefix shadowing and stays different. |
| E3 | Local of indexed outer creates indexed-empty, or zero initialized, after argument/identifier/readonly checks and save/restore admission. Repeated local saves once. Unset retains local absence shadow; next ordinary assignment is scalar. Restore full saved kind/attributes despite inner readonly/writes. | Existing R/D `restoreVariable` restores scalar value/export, but general readonly restoration is not implemented there (OPTIND special case only). Full **typed** restore is a new array requirement; do not claim general scalar attribute restoration already exists or silently broaden it. |
| E4 | Preflight only selected listing names before stdout: exported set for export/no-arg local; readonly set for readonly. Selected indexed binding refuses2; unrelated arrays do not poison output. | Preserve existing scalar listing/options; no export -p feature. |
| E5 | read/getopts/for preserve consumed input/scanner/OPTIND/OPTARG/list and earlier writes. Prepare current zero write before publication; failure prevents that write and later dependent work, not earlier effects. | Source setter/caller sequencing, not whole-command atomicity. |
| E6 | A successful typed `readonly a=value` pre-admits zero+readonly attribute+identity publication together. Keep existing RHS-before-readonly timing; if preparation fails neither new write nor new readonly bit publishes. After last await, preserve final readonly-before-stale, then synchronous publication. | R declaration loop assigns then adds the readonly Set without a new allocation budget that can fail between them. New private admission must not introduce a half-published typed operation. Scalar-only path remains unchanged. |
| E7 | For an **array-aware shadow transaction** (it saves/replaces typed storage or acquires typed clone/save ownership), validate scalar own-key env entries and readonly collisions, prepare all saves/restores and overlays, then publish together before dispatch. Upstream middleware/argument effects remain. Own-key __proto__/constructor/toString remain data. Explicit env replaces whole binding, never zero. | D:1535–1551 currently validates and publishes middleware keys incrementally before its try/finally; see E8. Existing invoke/replaceEnv policy still governs child construction; no host env fallback. |
| E8 | Keep the existing pure-scalar middleware route unchanged in this feature. Do not quietly generalize E7 into a universal scalar middleware atomicity/readonly repair. Mixed transactions acquiring typed ownership use E7 for their complete shadow plan. | Current D writes each valid key directly, changes cwd before the loop, checks no readonly collision in this loop, and starts try after it. A global transactional rewrite would be an additional observable change requiring separate authorization, not a proven fix from this static review. |

E7/E8 specify scope, not approval of any existing invalid-input behavior. The
future candidate must preserve its baseline scalar tests and demonstrate the
new typed branch. Existing contract promises must not be weakened. This review
does not execute or certify the potential scalar invalid-input failure path.

## O — resolve scalar overlay ambiguity explicitly

Current source D:1610–1613 (R:1478–1481) restores when
`state.variables[key] === saved.overlay`; saved scalar restoration is D:301–310.
It cannot distinguish untouched from same-value writes or scalar ABA. Context
keys identical to `initialEnv` are skipped earlier and create no overlay record.

**Recommend typed-only ownership semantics, not invocation-wide scalar changes:**

1. An overlay saving an indexed binding uses token/version ownership from entry.
   Any new ownership publication, including same-value or attribute mutation,
   supersedes it. Restore only if its installed owner still matches.
2. A scalar-only overlay retains exact current value-equality restoration while
   that name never successfully publishes an indexed binding during its lifetime.
   Merely activating the ledger, watching another name, attempting a failed array
   assignment, or using arrays elsewhere does not change this rule.
3. If an initially scalar overlay's name successfully publishes an indexed
   binding, that overlay is permanently superseded, even if the name later
   becomes scalar again. Mark relevant active overlay records as part of the
   pre-admitted typed publication, not after it. No new watch/history persists
   after those records retire. This avoids erasing a new array or typed ABA while
   retaining exact behavior for genuinely scalar-only lifetimes.
4. Local restoration remains its own unconditional saved-frame transfer, not
   middleware's conditional restore. STACK cwd Symbol ownership stays separate.

| Saved / overlay / downstream (same name) | Current scalar rule | Recommended result |
| --- | --- | --- |
| scalar A / B / no write | A | A |
| scalar A / B / write B | A | A, **not B**; preserves current scalar behavior |
| scalar A / B / write C | C | C |
| scalar A / B / write C then B | A | A; same scalar ABA baseline |
| scalar A / B / unset then scalar B | A | A; no indexed publication |
| indexed sparse / scalar B / no write | no current indexed support | restore complete sparse binding/attributes |
| indexed sparse / scalar B / write B | no current indexed support | retain new scalar B and its attributes; old array not restored |
| scalar A / B / unset, indexed publication, unset, scalar B | no current indexed support | retain B: typed publication permanently superseded overlay |
| scalar A / B / arrays only on another name | A for this scalar name | A; do not switch policy merely because ledger is active |

**Alternatives rejected by recommendation:** value equality for typed overlays
would lose intentional same-value ownership; token semantics for every scalar
overlay would change rows2/4/5 even without arrays. Root can choose the latter,
but it must explicitly authorize and freeze those additional scalar changes.
The proposed promotion is bounded per active overlay record and charged before
typed publication; its actual instrumentation is a candidate proof obligation.

## Candidate acceptance — all original 33 +22, no rescore

`ACCEPTANCE.json` binds **all** S01–S17 and O01–O16 from the unchanged
`100685da` VECTORS, plus all M01–M22 from its unchanged CONTROLS. G8/splice
vectors are now root-ratified future behavior requirements. No expectations,
order, inputs or historical native N13 outputs are rewritten.

- The 33 semantic vectors must run against the **actual candidate parser/runtime**
  and its bound public package; a toy expansion model cannot discharge them.
- The 22 mechanical obligations require actual candidate helpers/loaded bounded
  instrumentation, source accounting and public controls as applicable. Near
  MAX_SAFE ticket tests may use an explicitly bound instrumented copy, never
  trillions of writes or a new public API. Reject real guard-removal mutants later.
- Fixed synthetic numbers are reference-data claims, not invented whole-runtime
  allocation counts: M07's 27 headers bounds that graph's queue; M20's2610/21/445
  describes that admitted graph. A real candidate may have additional properly
  charged owners/work. It must still obey one-shot release/no cumulative refund.
- M09's overlay is the typed ownership case. O09 retains RHS-before-readonly.
  O15 requires the existing alternate word-splice path, not a flattened part-only
  implementation. O16 remains an intentional project/native difference.
- Additional candidate writer/copy paths, E/O scope regressions, admission,
  package/type/load checks remain required; 33+22 is not the entire future gate.

No model execution is needed to decide these policies. Authentication/inventory
checks are useful, but generating a toy interpreter now would risk circular
evidence. This closure keeps model/product/native pass counts at zero. It marks
the recommended design **normatively ready upon root's C/E/O selection**, with
implementation proof pending rather than requiring nonexistent code first.
