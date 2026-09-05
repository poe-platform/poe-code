# Bounded jq control flow

The shared structured parser/interpreter supports recursive descent `..`,
`reduce EXP as $name (INIT; UPDATE)`,
`foreach EXP as $name (INIT; UPDATE[; EXTRACT])`, and
`try EXP [catch HANDLER]`. Both jq and the existing restricted yq query session
use this implementation. This adds no host, filesystem or network capability,
runtime dependency, new limit option or command-line option.

## Compatibility profile

The new constructs follow the root-selected jq 1.8.2 control-flow observations
captured on September 5, 2026. This is not a global jq-version migration or full
jq compatibility claim. Existing numeric, assignment and diagnostic behavior
retains the maintained jq 1.7.1-apple profile. In particular, catch receives the
existing evaluator's `JqError.message`, not rewritten jq 1.8.2 wording. For input
`1`, `try .a catch .` emits `"Cannot index number with string \"a\""`; jq 1.8.2
adds parentheses around the quoted key. Compiler diagnostics likewise retain
the existing formatting.

The official-checksum-verified native replay preserved 58 old-version cases:
49 were identical between jq 1.7.1 and jq 1.8.2; nine differed. Its evidence is
outside the repository under the validation root's
`issue644-native-1.8.2.U2F9SH` directory, with original evidence preserved under
`issue644-native.e0XRoO`. Canonical tests contain literal expectations and need
neither native jq nor those external files or network access.

## Evaluation semantics

- Descent emits each root, then descendants in preorder, including containers,
  scalar leaves, null and empty containers. Object insertion order, original
  values and Decimal identity are preserved; values are not serialized/reparsed.
- A loop source is a term, with parentheses available for compound generators.
  The bound variable exists only in update/extract. Source and initializer see
  outer bindings. Nested shadowing restores the outer binding without mutating
  CLI variables or cloning the full variable map on each iteration.
- Each source value evaluates update against the current accumulator. All
  update outputs are evaluated; the last becomes the next accumulator. An
  entirely empty update resets it to null. Reduce emits only the final state;
  foreach emits each update output, or each extract output for that update.
  Empty/multiple extract results neither discard nor replace accumulator state.
- An empty initializer never evaluates the source. An empty source emits each
  initializer for reduce, and emits nothing for foreach.
- Multiple initializers deliberately have different source-input semantics:
  foreach replays the original input for every initializer; reduce uses the
  original input only for the first, and null thereafter. On input `[1,2]`,
  `foreach .[] as $item ((0,100); .+$item)` emits `1,3,101,103`, status 0.
  The corresponding reduce emits `3`, then exits 5 with
  `Cannot iterate over null (null)`. With source `.` and initializer
  `([], ["seed"])`, reduce appends `[1,2]` first and null second; foreach
  appends `[1,2]` both times. This surprising reduce behavior is intentional,
  backed by both native versions, not an inferred shared-loop implementation.
- Bare try binds to a term. `try 1 | .a` and `try 1/0` do not catch the
  downstream index/division failure; their parenthesized bodies do. A trailing
  pipe or comma is outside try/catch. Catch handles an evaluator failure once,
  retains preceding outputs and does not resume the failed generator. Handler
  failures escape that handler and may be caught by an enclosing try.

## Safety and lifecycle

Try, like existing optional `?`, catches `JqError` only, excluding `JqLimitError`
and failures observed during cancellation. Arbitrary other thrown values,
including falsey values, retain identity. Source compilation and input parsing
remain outside evaluation. Evaluated `fromjson` failures are catchable.

The AST walk includes every new child; parser nesting and AST depth retain their
existing bounds. Runtime lexical frames are linked, depth-bounded and share the
same invocation Budget; each frame lookup and loop transition charges it.
Descent charges each visited node and bounds traversal depth and collection
width. Hidden initialization/update/extract/traversal work consumes steps and
reaches cooperative cancellation checkpoints even without final output.

Generators stream alternatives instead of collecting them into unbounded
arrays. Nested generators retire through their existing async-iteration/finally
paths on completion, errors and early close. Output still flows through existing
command/session result and byte ledgers and awaited sinks; suspension does not
prefetch later results. This does not promise preemption of arbitrary host code.

## Deliberate gaps

`def`, modules, standalone `as`, labels/break and new recursive assignment paths
remain unsupported. Existing `error/0` and `error/1` builtins remain absent;
native object-valued `error` payloads are not implemented by this change.
Yq retains its existing restricted YAML/query/serialization profile and fixed
limits rather than becoming native jq or another yq implementation.
