# Mixed-source closure identity

## Reproduced defect

On local commit e71a80baa, execute `return ()=>1` and `return ()=>2` independently.
Capture both returned closures in one low-level snapshot whose source is the
first script. After a JSON round trip, invoking the first restored closure
returns 1 as expected, but invoking the second also returns 1 instead of 2.
The regression test fails its exact return-value assertion. This is silent
function-body substitution, not merely a prototype identity difference.

The expanded four-case regression also confirms:

- A class whose initializer should produce 2 instead produces 1 after restore.
- A suspended generator whose next yield should produce 2 instead produces 1.
- Adding a declaration to the second source changes its AST layout and makes
  restoration reject `unknown AST node 10`, rather than preserving its captured
  binding and function body.

All four fail on the current code. These results rule out a fix that merely
checks matching function node types or swaps an isolated expression body.

## Source evidence

Ordinary closure heap records identify code by an AST node ID relative to the
snapshot's root source. Independent parses can assign the same ID to different
function bodies. Existing dynamic Function/eval records have separate source
records, but ordinary root-script closures do not receive that treatment.
The parser's `functionSources` metadata already retains full source text and
function spans. This is useful provenance, but spans alone are not sufficient
to reconstruct lexical scopes or all generator continuation node identities.

The current dynamic source compiler parses eval and Function grammars. Neither
is a valid substitute for ordinary module parsing. `run` uses
`parseExecutableModule`; snapshot restoration currently uses `parseModule` for
its root source. Their executable import-meta assignment check differs and must
be accounted for explicitly. Several restore paths still select `state.nodeById`
or `state.rootNode` directly, including frame/continuation paths, so qualifying
only ordinary closure creation would leave gaps.

## Required implementation work

- Preserve an ordinary source identity distinct from a realm identity.
- Parse each retained source in its original grammar context, without executing
  it again or coercing an ordinary module into eval/Function grammar.
- Restore closures, classes, generator nodes and continuation references against
  the correct source node map while sharing the execution resource budget.
- Preserve source identity through recapture and validate malformed references.
- Cover differing node layouts, captured bindings, classes and generators—not
  only two literals with accidentally matching node IDs.

## Initial implementation and qualification

Foreign ordinary source text is now recorded once per text within serialization,
using a module variant of the existing internal source record. Function, class
and generator records point to it when their source differs from the checkpoint
root. Restoring that record parses module grammar under the existing compile
owner and registers its node map; it does not execute the module again. Source
registration on restored nodes preserves provenance through recapture. Both the
low-level validator and public restore source-rewrite path recognize the record.
Module records reject nonempty Function-style parameter strings.

All four original failures now pass, including a second snapshot before invoking
the retained functions. A malformed-source test rejects parameters and invalid
module grammar. The selected mixed-source, eval-source validation, class and
generator files pass all 53 tests. TypeScript and focused lint passed. The full
snapshot directory run is pending; the implementation remains uncommitted.
Template source ownership, complex continuations, malformed-reference coverage
and public execution boundaries still require further qualification.

The first template-source extension is red: two source texts capture `first`
and `second` tagged-template arrays, then export reader closures. Restoration
rejects `Invalid or duplicate template source identity`. Ordinary foreign-source
closure registration does not yet identify the source of already-captured
template arrays. The other five mixed-source cases still pass. The parser's
template factory receives full source text, so provenance can be retained there
and associated with template-array records without executing source again.

The first full snapshot run completed with 2,131 passes and only this template
failure (157 files, 153.85 seconds). The parser now retains source text for
template nodes, and serialization uses the shared per-snapshot module-source
record for foreign template arrays as well. The mixed-source, generator-template,
tagged-template and eval-validation selection passes all 50 tests after this
change. TypeScript initially caught a metadata lookup key-type mismatch; that
annotation was corrected and the check is being rerun. Further qualification
remains pending; no release or delivery is claimed.

The corrected TypeScript and focused lint checks passed; 20 mixed-source/eval
tests also passed on Node 18.20.8. A further template-cache identity regression
now fails: a restored function revisiting its tagged-template site does not get
the already-captured template array (`first: expected false to be true`). Source
text/content restoration is working, but cache ownership is still wrong.
`registerTemplateObject` is currently called with the root restore budget while
the restored closure executes in its originating realm view. This needs a
realm-aware template-record/cache fix; changing the assertion to compare only
contents would not satisfy template identity. The implementation remains
uncommitted while this validated defect is addressed.

Template records now retain their originating realm token and restore their
cache entry under that realm's shared-accounting Budget view. A same-source,
two-realm control then exposed an additional validator collision: uniqueness was
keyed only by template AST node. Validation now keys uniqueness by node and realm,
still rejecting duplicate arrays for one site in one realm. Malformed template
realm IDs are rejected. The selected four files pass 52 tests and TypeScript
passes. Additional negative guards and a fresh full snapshot run are being
checked before committing the combined source-identity implementation.

The final eight mixed-source cases include malformed realm IDs and within-realm
duplicate rejection and pass on Node 22.23.2. All 22 mixed-source/eval-validation
cases pass on Node 18.20.8. Focused lint passed. The refreshed full snapshot
directory run remains active; the runtime files have not changed during it.

Final snapshot qualification passed all 2,134 tests across 157 files (156.51
seconds), including the template-cache and malformed-realm regressions. The
maintained SafeJS workspace build passed 23 builds and five fresh-process import
checks. The implementation is qualified for local commit; the full-package failures
and broader conformance gaps remain separate open work.

This reproduction uses internal serialize/restore APIs; it does not establish
that every public host-admission path accepts such a graph. Mixed-source support
remains part of the open completeness work. Pushes and releases remain paused.
