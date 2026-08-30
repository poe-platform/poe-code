# Completed-history model: stop at ordering/admissibility ambiguity

2026-08-27, delegated design leaf. **No promotion or live implementation.** The
accepted `c3e40f8bd721da5e496f3b3abfd51aee45db5a84` worker remains guarded and its
working-tree bytes were checked equal. The earlier c433d023 / 954ddde4 candidate
and b6eaa23a counterexamples remain historical, not accepted replacements.

## Result and the two smallest supplied conflicts

The useful result is a bounded executable verifier of **supplied histories**,
not a new matcher. It preserves uncaptured structure, chronological iterations,
byte spans, capture lifetime and complete-history ranking without early merging.
It also **refutes two predictions in its own pre-code witness freeze**. Those
predictions remain unchanged in `WITNESSES.data` and its `a6ce736d` commit.

1. **Dropping repeat aggregate priority breaks the uncaptured prefix.** In the
   existing `prefix-star` input `a*\(a*\)` / `aaa`, compare U: prefix `[0,3)`,
   capture `[3,3)`, and V: prefix `[0,0)`, capture `[0,3)`. Both whole spans are
   `[0,3)`. Frozen ITERATION-v1 omits the prefix repeat's aggregate span, then
   prefers the ended iteration list; consequently V wins. The frozen prediction
   U was wrong. `prefix-two-captures` repeats the same defect. This is a two-history
   counterexample on an existing input, not a new corpus or a native observation.
   We stop rather than changing END priority or tailoring a special prefix rule.
2. **Eligibility cannot be disguised as history ordering.** For root P/`aaa`,
   `[a][a]` followed by reference `a` has whole `[0,3)` and capture `[1,2)`.
   Permitting `[aaa][]` followed by an empty reference yields the same whole span
   but capture `[3,3)`. Both frozen length-led policies prefer the latter. That
   last empty changes the backreference environment and is not an equivalent
   zero-progress cycle. Root's narrow `a` remains unchanged; a general optional-
   tail admissibility decision or a different principled order is still needed.

AGGREGATE-v1 selects U in the first conflict and satisfies its ten **conditional
model prediction labels**, but this is not a general normative comparator or an
all-frozen32 gate. For P/`aaaa` its supplied winner is `[aa][a]` plus `a`, capture
`[2,3)`; ITERATION-v1 prefers `[aa]` plus `aa`, capture `[0,2)`. That provisional
choice remains unaccepted. Neither policy sorts final captures or uses encounter
order. No third policy was added to fit observations.

The model's LOCAL-TAIL-HYPOTHESIS is the historical activation-local suppression
described in b6eaa23a: after this repeat activation makes progress, an optional
zero-width body is disallowed; required empties are admitted. A first optional
empty terminates that activation. **This is stronger than stopping equivalent
cycles and is not inferred as an additional root requirement.** The permissive
replay exposes the difference. These are eligibility rejections, not product
resource errors or evidence that the rejected histories are universally invalid.

## Freeze, primary report and authority

Before any model coding/execution, obtained the independent receipt for
`c0aec9fc240f153e0fa18d6e2d1e291871dbe1eb`; checked manifest SHA256
`458c5c9e5def60b32d963572364998c463f3e185692f6a25ed09d6069f822589`, ran its read-only
verifier, and compared all nine originally committed frozen files to that commit.
That freeze has 32 distinct inputs and 128 prior native semantic calls in four
qualified GNU9.7-Darwin/Apple invocation profiles. This leaf makes **zero native
calls** and neither infers native capture registers nor treats native votes as
policy expectations. Later `frozen/` baseline additions are a separate owner's
work; the nine-file comparison does not claim that subtree has no new entries.

`WITNESSES.data` was committed as `a6ce736d` before `model.mjs` existed. Its SHA256
is `c86c457ba6a4a6d995ba757c23bf2024f7327411dd19dfb5d531a23d7e4c71a5`.
It selects ten exact frozen IDs, hand-defines eight ASTs and 22 exact choice
plans, and states both policy predictions and rejection labels before execution.
Plans uniquely determine byte boundaries; they are derivations, not guessed
native spans. Model syntax supports only the selected byte/cat/group/repeat/ref
subset; correspondence of these hand-authored ASTs to their frozen BREs is not a
proof of the product parser. No raw TypeScript fixture is introduced.

Read the primary leaf's final `normative/REPORT.md` at `44eed610` after its earlier
checkpoint, including HNODE/HTREE, W1-W5 and the five-source qualifications. Its
Issue8 D/`abab` explicit failure contradicts project retained-descendant success:
our `[ab][a]` plus retained `b` is **a deliberate project-profile departure**, not
POSIX acceptance. We do not clear descendants to hide it. HNODE versus HTREE
static-node-major/dynamic-occurrence-major precedence is **not** the same as this
model's aggregate-span/omitted-repeat-span comparison. Neither HNODE nor either
paper's exact algorithm was implemented. Our unconditional END-before-continuation
also lacks HNODE's distinct zero-participation rule; no equivalence is implied.
Regular/backreference-free path-order and suffix-stability results do not prove
our backreference comparator, admissibility, dominance or cycle quotient.

## Representation and precise algorithm

Static AST ID is the ordered structural path `r`, `r.0`, `r.0.0`, etc., including
every uncaptured cat/repeat/byte node. Group numbers are annotations. AST shape
and associativity are frozen per witness; no parser reassociation, quantifier
expansion or capture elision is performed. Every dynamic occurrence has a local
activation number, parent activation, iteration ordinal when its parent is a
repeat, and start/end byte positions. Identity is scoped to its owning history;
allocation IDs do not participate in priority.

Each build has a fresh branch-local environment. Group entry replaces only that
group with `open(start,activation)`; close installs `completed-empty` or
`completed-nonempty` plus the origin activation and span. Initial state is absent.
Skip does not update registers. References reject absent/open, compare exactly the
completed source bytes, and admit completed-empty without consuming. The ref
event's environment identifies the particular completion it read. A retained
descendant is checked against its own earlier completion, not falsely contained
in the final ancestor occurrence.

Events are immutable enter/exit/skip records with immutable environment snapshots.
Each repeat emits a skip at its terminated next-body slot, including the zero-
iteration case. Skip's activation is null; it does not fabricate a participating
empty subtree. A completed immutable activation tree retains all ordered children
and chronological repeat bodies. Parent links plus repeat ordinals recover the
ancestry and iteration boundaries; the event order resolves equal-byte positions.
No branch is forked from a live engine state: independent witness builds provide
isolation, not a tested persistent-frontier implementation.

```text
build(node, frozenPlan, branch):
  pre-admit visit/frame/event work and logical storage
  record enter; on group entry invalidate that group's completion
  cat: visit child plans in static order
  repeat: check count; visit each body plan with local required/progress state
          enforce ONLY the named admissibility hypothesis, if enabled
          record termination skip, never descendant reentry
  byte/ref: validate consumed subject bytes against literal/live completed binding
  group: install completion with origin activation
  validate byte span; record exit; retain immutable tree and event history

compare(completeValidLeft, completeValidRight, namedPolicy):
  first compare whole start ascending, end descending
  compare same-AST node occurrences recursively:
    compare aggregate extent descending
      EXCEPT repeat nodes under ITERATION-v1 omit this comparison
    compare complete child subtrees left-to-right / iterations first-to-last
    at an equal list prefix, the shorter list wins
  identical semantic trees tie; never compare allocation IDs or candidate order

rank(allSuppliedEligibleHistories):
  pre-admit and validate membership before each comparison
  retain a provisional local incumbent, but do not publish it
  return only after ALL supplied histories are compared and final budget check
  any refusal/cancellation throws; there is no best-so-far return path
```

For fixed finite AST/tree representations these comparisons have a terminating
lexical definition with a fixed terminal preference. The implementation checks
antisymmetric signs, reflexivity and transitive implications on supplied triples.
That is **422 finite checks**, not a universal theorem or proof of backreference
continuation equivalence. Equal structural keys are an observational tie class;
the model returns a representative reference, not a tie-breaking semantic choice.
Arbitrary external history objects are rejected. Only successful model-built
histories may be ranked. This is not a hardened public untrusted-AST API.

## Resource model, state sizing and complexity

There are no dependencies, workers, timers, native regex calls or main-thread
`RegExp`. The model uses deterministic cumulative logical-work/allocation counters.
Admission precedes event/tree/env allocation, fixed-capacity vectors, AST children,
choice expansion, validation and recursive ranking. A failed budget admission
does not return a history or incumbent. Fixed bootstrap/constructor reservations
cover bounded manager/control/compiler-frame overhead; dynamic visits/comparisons
charge additional frame units. Each record reserves 16 logical slots, vectors
reserve length+4, visits reserve eight frame units and compare recursion four.
These declared abstract units bound the represented algorithm, **not exact V8
heap bytes, GC allocations, closure internals, native stack bytes or RSS**.

| Quantity | Model admission cap |
| --- | --- |
| Subject | 32 ASCII bytes; non-ASCII explicitly refused |
| AST | 64 nodes, depth 24, at most 16 ordered children/groups |
| Repeat supplied count | 32 per activation; finite min/max checked |
| Retained valid candidates | 32; failed builds still consume cumulative budget |
| Events per build | 2,048; capacity allocated before traversal |
| Work / cumulative allocation | 1,000,000 each per model instance |
| Fixture loader | stat <=1 MiB; read/parse reserved at 32 units per byte |
| Harness budget | 50,000,000 work/allocation, separate from each model |

Let S be AST nodes, D depth, G groups, V total visited activation nodes over all
supplied builds, E events, R total referenced bytes compared, K eligible histories,
and H maximum activation-tree size. Build/byte/span checks cost
`O(S + V + R + groupUpdates*G)` work; retained trees/events/env snapshots cost
`O(S + V + E + groupUpdates*G)`, plus the admitted event-capacity vector per build.
Each comparison is `O(H)` work and `O(D)` live recursive frames, with cumulative
frame charges for every visited pair. Membership checks are `O(K)` per operand,
so selection is `O(K*H + K^2)`, not an optimized sort or linear-language engine.
The harness additionally performs bounded factorial permutation checks (at most
three eligible histories per fixture here) and cubic relation checks; those are
validation costs, not a product complexity claim. Exhaustive regex enumeration,
especially backreferences, has no polynomial bound asserted by this model.

Twenty named controls bundle individual assertions; they are not twenty native
acceptance tests. They cover malformed/reversed/fractional/out-of-range byte spans,
incorrect expected spans, external unvalidated histories, allocation/work/input/
ASCII/depth/events/candidate refusal, comparison allocation and refusal after an
incumbent, plus exact reason identity before work and ranking. Cancellation is
synchronously checked at charged operations. No event-loop responsiveness, timeout
or actual worker cancellation latency is established on this main-thread model.

## Five remaining decisions/proof obligations

1. **Order and AST mapping:** choose static-node-major versus occurrence-major,
   quantifier aggregate precedence and zero/END distinctions. Preserve uncaptured
   prefixes and prove projection-neutral ties. Do not implement a post-hoc patch
   for the refuted ITERATION-v1 predictions or select by native votes.
2. **Admission and termination:** explicitly decide optional-tail policy compatible
   with narrow P/`aaa`. Required counters are activation-local. A cycle key must
   alpha-normalize dynamic IDs, preserve finite max/min counters, bindings and
   ranking-relevant history, and prove removal neutral/dominating for every valid
   continuation. `sameContinuationState` is only a necessary-field demonstration:
   it omits full frames/history/max counters, uses exact IDs, and is **not used
   for pruning**. Its true result does not license merging or cycle elimination.
3. **Lossless engine history/lifetime:** actual parser-to-AST binding, failed-branch
   rollback, retained descendant origin, repeat ancestry and environment replay
   must agree with eventual published byte captures. No early merge by pc/position/
   final captures. Same pc/position with absent/open versus retained-b env already
   has different backreference continuation in this model.
4. **Actual cooperative worker ownership:** register cleanup synchronously before
   creating/admitting a worker; close admission, share idempotent cleanup completion,
   propagate exact reasons, settle tracked work and await retirement/dispose.
   The model creates none, so these remain future obligations. Bind prior137
   (protocol5 + lifecycle11 + limits10 + abort111) through the independent manifest;
   none is rerun or re-certified here. Also retain the two historical regression
   inputs, not a substituted mandatory-reference or repeated-alternation test.
5. **Independent acceptance:** freeze an actual copied worker candidate and qualify
   it against all independent32, exact source/protocol limits and native profiles.
   Review complete histories as well as whole/capture bytes and failure controls.
   This model has neither a complete parse forest nor real adapter/command/shell
   acceptance, and supplies no worker performance or universal superiority claim.

Smallest next source experiment, **only after separate authorization and decisions**:
an OS-temp copy of `src/commands/expr/bre-worker.ts` with local AST/history terminal
selection; keep the live initial guard, worker protocol, root exports and config
unchanged. Do not rewrite the entire regex engine or overlay live code into the
immutable baseline archive. No such source experiment was performed here.

## Actual validation and handoff

`model-01.data` records the final captured source hashes, Node22.22.2/Darwin and:
ten selected existing inputs; 22 supplied fixture attempts; 19 eligible supplied
histories; three named eligibility rejections; one additional permissive-tail
replay; 62 permutation-ranking checks; 422 relation checks; twenty named controls;
**two preserved failed frozen policy predictions**. Every policy's supplied winner
is independent of all enumerated encounter permutations. In particular,
P/`aaaa` histories `[aa][a]` and `[a][a][a]` end at the same abstract accept pc,
position and final capture spans, yet both orders prefer the former. Actual
worker pc numbers are not measured.

The first model run and final captured run both completed; the small pre-capture
instrumentation refinement added origin activation assertions, cap validation and
an explicit first-DFS control without changing plans or comparator semantics.
Read-only verification reruns the same model and compares its JSON to this capture;
replays are not new inputs or increased denominators. Canonical tests were not
changed or run, and no old quota/core/lifecycle suite, compiler or service was run.

`verify.mjs` authenticates the owned file/empty-directory/symlink inventory before
and after its read-only replay, the witness pre-code commit, the captured source,
the independent freeze and primary report bindings. New owned entries are detected;
this is not an append-proof audit of the whole concurrent repository. It does not
write evidence. The explicit capture option uses exclusive create and refuses an
existing path. `MANIFEST.data` self-hash is externally bound by the final receipt
and Git commit, not recursively claimed inside itself.

Only this new `design/` subtree and the requested design `/tmp` checkpoint/receipt
were written. No owned worker, server, background child or scratch directory was
created. Git metadata subprocesses were synchronous and reaped. The two intentional
handoff pointers remain; there is no other owned temp to delete or child to stop.
Foreign native scratch, review/normative/frozen additions and staging are preserved.
No new supported-baseline issue receipt had appeared when this report was written;
if one appears later it is independent evidence, not a design-layer live fix.
