# Eval source ownership, accounting and recovery

Prioritize this before treating guest eval as usable beyond the current local
experiment. The first execution path parses scripts but does not register them
as owned dynamic sources.

## Reproduced evidence

- Returning an eval-created closure reports a measured data size of 2 both with
  no prefix and with a retained 16,388-character comment prefix. The existing
  dynamic-Function path accounts for its source; eval does not yet do so.
- `const f=eval("(function(){return 7})");await 0;return f()` completes with 7.
  Dump/restore rejects the saved closure with an unknown guest function AST
  identity. No successful eval-source recovery is claimed.

## Required change

Add an explicit script source record, distinct from Function constructor source.
Retain source text, effective parser context and its AST namespace. Register
nodes and escaping closures/generators with existing ownership/accounting maps.
Charge retained source and compilation using the existing budget mechanisms.

Extend both snapshot routes to serialize, validate and recompile script records,
including strictness and inherited function/class/private-name context. Reject
malformed contexts and foreign AST identities before invoking guest code. Keep
ordinary Function source records compatible and avoid host eval entirely.

Start with failing source-size and escaping-closure recovery tests. Cover nested
eval, dynamic functions created by eval, eval-created generators, private methods,
templates, malformed records and fatal compile-budget failures. Then run existing
dynamic-source and historical checkpoint controls, TypeScript, lint and the
maintained full workspace gate. The currently running frozen candidate excludes
all eval implementation.

## Local implementation and validation

The initial eight regressions fail before repair. Eval now registers a distinct
guest-script record and AST namespace, retained through the existing dynamic
node/value ownership maps. Source text, node count and private-name metadata
contribute to data accounting. Both restore routes validate and recompile script
records; internal source references cannot be exposed as guest properties.

An additional wire-alias test first fails: mutating serialized context changes
the retained source. Serialization now copies the context and private-name list.
The original malformed-context, source-reference and fatal-compile checks remain
unchanged and pass.

All 51 focused tests pass across eval-owned source, malformed records, existing
dynamic Function source, suspended eval arguments and retained-source budgets.
This includes real tagged-template identity, eval-created classes, nested eval,
Function created from eval, synchronous/async generators and suspended async
functions. TypeScript and focused lint pass. Node 18.18 independently passes the
source-size comparison and escaping-closure recovery check.

Six retained 4,000-character eval bodies exceed a 25,000-unit data budget with a
fatal dataSize error even inside guest try/catch; the same workload completes
with a 60,000-unit budget. The broader historical Promise/template/Function
regression selection is checked separately. No full-suite eval result is claimed.

That additional four-file historical Promise/template/Function selection passes
all 115 tests. The frozen candidate's separate full run still has one namespace
replay timeout; it excludes eval and is not evidence of full eval integration.
