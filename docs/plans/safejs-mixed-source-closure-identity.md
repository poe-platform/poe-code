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

No runtime change has been made yet. The failing regression remains uncommitted.
This reproduction uses internal serialize/restore APIs; it does not establish
that every public host-admission path accepts such a graph. Mixed-source support
remains part of the open completeness work. Pushes and releases remain paused.
