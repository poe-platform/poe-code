# String `length` non-collecting prerequisite v1

Status: frozen **design-only author/reviewer protocol**, dated 2026-08-28. It
does not authorize or implement a source or test change. The vectors are literal
prospective expectations and were not executed. A different future pre-code
freeze and a difference reviewer are required before root may authorize code.

## Fixed source binding and single-branch write scope

Accepted baseline:
`5137a74ec855a32d8a8860eb66b62eb44d11e290`.

The only future product path permitted by this protocol is
`src/commands/structured/interpreter.ts`, Git blob
`f7e0dfcb1815aa90ae49d495e453b4d069139108`, SHA-256
`bac1cf5325eff5bfa69f1c8bec5d3d8a80bb452fd61cdc802d55a26788acaffc`.
The bound function is `Interpreter.call`, lines 191–218; the complete `length`
branch is lines 210–217 and the string expression is line 213:

```text
else if (typeof input === "string") yield Array.from(input).length;
```

After a new freeze, the future author may change only that string branch to
count JavaScript string-iterator elements without retaining them. A direct
`for...of` counter is the semantic model: one count for each Unicode code point
represented by a valid surrogate pair and one for each unpaired surrogate. The
counter is a safe integer because an in-memory string cannot have more iterator
elements than its finite UTF-16 length. The patch MUST NOT touch the surrounding
null/number/array/object/Boolean behavior.

No helper/public API, signature, import, export, query grammar, limit type,
default, adapter, encoder, parser, or other interpreter branch may change. No
`Array.from` elsewhere is in scope. The prospective test path is the one new
focused file `tests/commands/structured/length-codepoints.test.ts`; changing
existing test files is not necessary for this prerequisite. Root/package exports
and yq code remain out of scope.

## Semantics that must remain exact

The source-bound behavior is:

- null yields integer `0`;
- a baseline numeric (`number` or `Decimal`) yields
  `Math.abs(numberValue(input))`, including nonintegral results and positive zero
  for negative zero; positive/negative infinity yields positive infinity and NaN
  yields NaN when such an internal numeric reaches the branch;
- a string yields its JavaScript string-iterator/code-point count, not UTF-16
  code units, bytes, or grapheme clusters;
- an array yields its element count;
- an ordered query object yields `objectKeys(input).length`;
- Boolean input throws `JqError("boolean has no length")`;
- the branch returns after exactly that one yield/error.

`vectors.data` freezes tiny cases for empty, ASCII, astral, combining-mark, ZWJ,
surrogate, and non-string behavior. Lone-surrogate rows are direct internal
`Json`/Interpreter cases only: the TypeScript `Json` string type can represent
them, but this packet does not assert that jq input or the proposed yq UTF-8
profile accepts them. Non-finite numeric rows likewise bind only this existing
internal branch; the proposed yq profile rejects non-finite input and results.
Proposed yq explicitly rejects invalid Unicode input.

## Accounting and cancellation invariant

The future loop MUST add no `Budget.step`, `tick`, `collection`, `text`, `value`,
allocation guard, signal check, await, or scheduler yield. It MUST NOT change the
time at which the existing result is yielded. This preserves current accepted
results and current charging/cancellation outcomes; any new work charging or
cooperative yielding requires separate root approval.

For the direct prospective seam, `Interpreter.run` executes the existing one
`await budget.tick()` on AST entry (interpreter lines 24–26) before dispatching
the call at line 95. The `length` branch itself makes no Budget call. Therefore a
test that directly requests the first result from a `length/0` call AST, without
an outer command/value-validation wrapper, has exactly one existing Budget step:
`maxSteps: 1` admits it. This is a source-derived call boundary, not a timing
guess. The future author must first freeze this baseline test and the pre-aborted
exact-reason case before altering source, then show the same outcomes after the
patch. Full-command thresholds MUST NOT be guessed from this unit seam because
the command adds its own ticks and value/output passes.

A pre-aborted signal continues to throw its exact reason at the existing entry
tick. An active signal receives no new observation point during the synchronous
string count. No local signal or controller is introduced. This prerequisite
fixes retained allocation only; it does not claim cooperative preemption of the
loop or a CPU/RSS bound.

## Future author protocol (only after a different freeze)

1. Re-authenticate the accepted commit, source blob/SHA, exact lines, and the two
   existing regression blobs listed in `identity.json`. Stop on mismatch or
   relevant live drift; do not patch mutable HEAD by assumption.
2. Materialize `vectors.data` in the focused prospective test file. Before the
   product patch, commit the semantics, direct `maxSteps: 1`, and pre-aborted
   exact-reason cases as a coherent test freeze. Record actual baseline outcomes.
   The ordinary vector cases should pass before and after; they bind semantics,
   not allocation behavior.
3. Add an isolated allocation-discriminator test. In its own worker, on only one
   tiny sentinel string, temporarily replace `Array.from` with a wrapper that
   throws a private marker only when called with that exact sentinel and delegates
   every other call. Restore the original property in `finally`. The bound old
   branch must trip the marker; the non-collecting candidate must return the
   expected count. Do not patch other globals, run a large string, or treat heap/
   RSS sampling as the assertion.
4. Change only the bound string branch. Inspect the source delta to confirm a
   non-collecting counter, no array/spread/split collection, no other branch
   change, and no new Budget/cancellation call. Run the focused test plus the
   exact existing regressions below.
5. Perform a meaningful reverted-mutant check: restore only the old
   `Array.from(input).length` expression against the focused discriminator and
   show that it fails/trips; then restore the candidate and show it passes. The
   final tree must contain neither instrumentation nor mutant.
6. Commit test freeze and product change atomically as separately reviewable
   commits using explicit owned paths. A difference reviewer who did not author
   the patch must authenticate both states and source delta before root code-go.

The isolated `Array.from` wrapper is a prospective tiny-worker technique, not a
license for broad host monkey-patching. Static one-branch review plus the reverted
mutant is the primary non-collection evidence. Normal output assertions alone do
not distinguish the current collecting implementation from the desired one.

## Existing exact regression seams

These names and paths come from the fixed baseline; they are not guessed:

- `tests/commands/structured/semantics.test.ts`, lines 28 and 98–102,
  generated case **`semantic matrix 22: length,.[1:2]`**, currently binding
  input `"A😀B"` to outputs `3` and `"😀"`;
- `tests/commands/structured/resources.test.ts`, lines 60–77, test
  **`limits protect hidden Cartesian expansion, collections, and emitted results`**,
  including `[<product>]|length` yielding `4096`;
- `tests/commands/structured/resources.test.ts`, lines 79–91, test
  **`input, source, output, slurp and result budgets enforce boundary values`**,
  retained to detect unrelated accounting drift.

The prospective focused test must not invoke native jq, yq, a reference package,
or a large resource bomb. Existing native-oracle portions are not evidence for
non-collection. This packet records source proof and test design only: source
implementation runs `0`, tests `0`, product runs `0`, native/reference runs `0`.
