# Narrow remaining decisions

References A mean author v3 `DECISIONS.md` at `c54db686`; R means LET runtime
`c26892c3`; D means accepted DOTGLOB runtime `d2502aae`; B means parser `5137`.
Line references are to those committed bytes, not current working-tree files.

## G2/G5: accept direction, require these mechanical refinements

1. **One allocator, three reservations.** A:110–123 and 264–274 use a single
   non-reusing ticket allocator but name generation/version/epoch checks. These
   must consume a *tentative remaining-capacity cursor in that order*, committing
   all or none. With two tickets left, generation and version fit; epoch must
   refuse with no tickets issued. Three independent `remaining >= 1` tests would
   admit an impossible triple. Prepaid restore tickets stay spent on discard and
   compare by equality only, even if numerically older than the latest write.
   Exact bounded counters or bigint arithmetic must not create MAX_SAFE+1 as an
   ordinary Number sentinel. This is a design requirement, not a reproduced bug.
2. **Observer retirement is not refcount zero.** The watch table itself owns a
   strong edge to its watch (PEAK). When the last *external observer* goes away,
   detach that table slot using its prepaid credit; only then can the table's
   watch/name edges be released. Waiting for total refcount0 before detach leaks
   the sole table reference. An embedded observer count/role is sufficient; any
   out-of-line record costs metadata. Empty absent watches and same-name ABA
   must follow the same finite rule. No permanent generation/tombstone map.
3. **Dependency edges need explicit ownership roles.** The 45-edge witness can
   be a finite held graph; it does not enumerate a general scope-dependency graph.
   Mark each future parent/child/drainer link as owning or borrowed, prove borrowed
   lifetime, and prohibit owning cycles or give an explicit edge-breaking close
   protocol. Single-flight close must publish its completion object before any
   acquisition, seal admission synchronously, then drain children before restore.
   Call order or concurrent `Promise.all` cleanup is not that proof.
4. **Restoration is a transfer, not a fresh mutation admission.** Scope/name,
   attribute storage, three tickets, displaced-edge release and all dependency
   work must already exist. No Set growth, new promise per slot, snapshot copy,
   identity issuance or budget reservation in final restore. A local frame must
   restore despite inner writes/readonly; a superseded middleware overlay must
   not restore. Test both rules, not one generic value-equality restoration rule.
5. **Release totals must be invariant under release order.** A 2→1 edge decrement
   cannot refund payload; final release refunds live storage only. Restoration
   transfers its edge credit, never spends it twice. Cumulative allocation/work
   and tickets never refund. Queue capacity is at most the admitted header count
   only if each header can be queued once; overlapping closes must prove that.

These are feasible with the proposed embedded records; candidate code still has
to demonstrate them. They do not justify ignoring cleanup errors or awaiting
unregistered opaque host promises. Caller/escaping failure precedence is retained.

## G3: conditional mutation coverage

A:134–172 is substantially better than setter-only versioning. Coverage must
include direct dictionary writes/deletes, Set/Map changes, same-value writes,
locals/saved-prefix updates and restoration, readonly/export attributes, getopts,
positional/function/status/depth/flag/cwd/STACK fields and all clone paths. Once
active, state epoch updates themselves need bounded, admitted work; reservations
must precede visible mutation. Scalar-only execution remains lazy/uninstantiated.

**Additional accepted field:** D:188/2595 stores and writes `state.dotglob`;
array-bearing clones must capture it consistently and a concurrent shopt change
must invalidate a whole-state snapshot. This is not DOTGLOB retesting or a request
to change its behavior. For guarded no-fail restoration/status publications,
the author must identify where epoch tickets/work are prepaid; an exhausted
allocator cannot make a supposedly no-fail finally path acquire a new ticket.

## G6: exact accounting, not merely a fitting example

The declared held graph sums to 27 objects, 45 strong edges, 4 wrappers,
11 Map slots, 10 vector slots, metadata2560, payload50; allocation2610;
forward work256 + cleanup189 = reserved445. Its explicit bulk reservation and
no discarded allocations explain cumulative=live here. This proves the declared
arithmetic only, not reachability, all actual operations, latency or RSS.

Request root ratify these precise readings:

- **F counts every private Map slot including watch-table slots**, not just
  values; vectors cost metadata and cumulative slots, not the Map-slot cap.
  F is not a promised usable member count. No silent widening of F itself.
- Derive all caps exactly/lazily. A cap too large to represent refuses that
  array operation before allocation; it does not reject a scalar-only exec.
  The proposed fixed diagnostics need a literal future table, including which
  derived expression wins if several overflow. Recommend the equation order
  wrappers, Map slots, payload, metadata, cumulative bytes, cumulative slots,
  work; the first unrepresentable expression wins. This tie-break is proposed.
- Every *single reservation* checks derived caps, tentative generation/version/
  epoch capacity, then wrappers/Map slots/payload/metadata/cumulative bytes/
  cumulative slots/work. Check all before committing any counter or ticket.
  Work includes release credits and is not refunded. Previously successful
  reservations remain spent if a later reservation fails.
- This is not a global reordering of effects: G1 entry guards and planning scans
  retain their specified phase; G7 input/alternate/redirect effects already
  completed are not rolled back. Caller/escaping errors remain higher priority.
  Exhaustion preventing a later guard/scan can win before that later condition
  is observed. A:75 final readonly-before-stale applies at final validation.
- **Delete-current-maximum:** compute the new maximum from present slots under
  reserved scan work, validate the watched target, then publish deletion and
  cached maximum together. If scan/admission fails, neither changes. Never scan
  the integer range or delete first and leave a stale cache on exhaustion.
- Array-derived length, pattern, substring, alternate fields, escapes, joins,
  sorting and encoding need owned reservations, including intermediates. Current
  R:2541–2656 helpers collect/slice/join strings; calling them on an array-owned
  token does not automatically satisfy the new ledger. E is an ownership boundary,
  not a loophole for every existing helper's new array-derived allocation.

Synthetic control obligations in `CONTROLS.json` expose cap-order, overflow,
refcount, ABA, restoration and shared-ledger errors without large allocations.
They are presealed **unexecuted obligations**, not a ledger implementation.

## G7: preserve phases; approve explicit project choices

| Boundary | Recommended exact phase / remaining decision |
| --- | --- |
| Array conversion | Reject the named 13 control bindings and exported scalar/unset after entry target/readonly checks, before array RHS. No broad LC-prefix ban; no DIRSTACK variable. |
| Export indexed | Expand command arguments as today; reject the current indexed operand before its zero write/export bit. Earlier operands/effects survive. Do not preflight every operand before those existing effects. |
| Scalar prefix over indexed | Command-word/redirect ordering follows R:1293–1360; prefix RHS once, then refuse before temporary publication/dispatch. Native N16 differs deliberately. |
| Typed local | Check declaration arguments/identifier/readonly, reserve save+restore, then indexed-empty (or zero initializer) shadow. Whole unset retains local tombstone, a subsequent ordinary assignment is scalar; exit restores complete outer kind/attributes. This differs from N05 and requires explicit root approval. |
| Listing | Preflight only the selected exported/readonly names before stdout, refusal2 for a selected indexed binding. No-argument local keeps its existing selected exported view. No `export -p` feature is introduced. |
| read/getopts/for | Preserve earlier input/OPTIND/OPTARG/for-list effects and earlier assignments. Prepare/admit the current zero write before publishing it. A later failure is not whole-command rollback. |
| Env / middleware | Only scalar own-key dictionaries; validate/pre-admit shadows before publication/dispatch. Includes `__proto__`/constructor/toString; no ambient fallback/array serialization. Explicit env shadows whole binding. Restore by exact ownership token, not value equality. |

Three narrow approvals remain: (1) the conversion/export/prefix and typed-local/
listing choices above; (2) whether **same-value middleware writes surviving an
overlay apply only when the array ownership machinery is active**, or also to
scalar-only execution. A:362 recommends token ownership while A:82/376 says scalar
behavior unchanged; R's current equality-based restoration is not equivalent.
Recommend limit this new policy to the typed/observed path unless a separately
authorized scalar regression changes that baseline. (3) Pre-admit a successful
`readonly a=value` zero-write plus attribute publication together so no new private
allocation can fail between them; preserve existing RHS-before-readonly behavior.

## G8: useful element-zero operators, not blanket refusal

**Recommend accept root's alternative**, with these explicit details before
freezing semantics. B:440–473 parses exactly these bare-name operator tokens:
`-`, `:-`, `+`, `:+`, `=`, `:=`, `?`, `:?`, `#`, `##`, `%`, `%%`, `/`, `//`,
`/#`, `/%`. Also retain `$a`, `${a}`, `${#a}`, `${a:offset}` and
`${a:offset:length}` with the existing scalar substring/locale rules. Do not add
case conversion, indirection, attributes, presence tests, array arithmetic or
explicit indexed operator forms. Existing unsupported combinations remain errors.

Resolve bare `a` to element0 **with undefined preserved for a missing slot**:
indexed-empty and sparse missing-zero are unset for these operators; a present
empty zero is set-but-null. Other indices never make zero set. Scalar/absent
bindings retain current behavior; reads never convert kind or create a slot.

- `-`/`+`/`?` test missing; their colon forms also test empty. Preserve lazy
  alternate effects and current ParameterExpansionFailure class/message on `?`.
  Unselected `=`/`:=` does not write or perform a new readonly check.
- Preserve **both paths**: R:2515–2540 `part()` and R:2674–2685 `word()`'s special
  `-`, `+`, `:-`, `:+` alternate splicing. Replacing the direct dictionary read
  only in `part()` misses the fast path; flattening all alternates would lose
  existing quote/field boundaries. There are two zero-view read sites to change.
- For selected `=`/`:=`, capture watched scope/kind/tickets and pin the read at
  selection; expand alternate once in the existing scalar phase. **Recommend
  RHS-before-readonly**, as R:2530–2535 already does; do not apply G1's early array
  assignment readonly guard to this scalar operator. Then prepare/admit zero
  storage and perform final caller/escaping, readonly, stale validation before
  publication. Preserve nonzero members and indexed kind. If RHS mutates/unsets/
  replaces the target, refuse stale without retry/rebinding or undoing that RHS.
  Missing-zero `${a:=}` inserts a real empty slot, not an indexed-empty no-op.
- Nested `${a:=${a:=inner}}` on indexed-empty selects both once: inner writes
  zero; outer detects stale and refuses, retaining inner. This is a proposed
  project conflict outcome, **not a Bash observation**. The outer compound N13
  scenario likewise becomes stale after a successful inner zero write, preserving
  its original native difference rather than rescoring N13.
- Non-writing operators pin their entry zero token for the expansion lifetime;
  own alternate/pattern/offset effects remain visible, but do not silently reread
  a different zero after an await. Missing substring returns empty without
  evaluating offsets, as R:2545; pattern/replacement evaluation keeps its current
  phases even for empty text. Offset arithmetic that reads an indexed binding
  still refuses via the existing arithmetic policy, not an element-zero coercion.
- New typed retention/work can refuse under private caps. It must not leave a
  partial slot, roll back earlier effects, treat a mapped status as escaping, or
  allocate before its reservation. Scalar-only operators keep existing Budget.

## Repeated aggregate proposal

`VECTORS.json` contains literal, small expected argv vectors for the proposed
left-to-right splice: two members followed by two members yields three fields,
not four, with the last/first members joined. It covers sparse ordering, repeated
same aggregate, zero members, quoted empty members, surrounding text, explicit
empty scalar quotes, Unicode-first-code-point IFS for quoted `*`, and unquoted
member splitting. These are proposed project semantics; not executed scripts or
Cartesian/native parity claims. One explicit operator/cap policy approval and
these vectors are enough to freeze G8; a fresh native cohort is not required.
