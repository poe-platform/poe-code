# Expr sequencing: approval-required structural proposal

Status: design only; no product edits. Accepted product input is Git commit
`21220b465537bf45ffcfb36740956a69f43bf75e`. Independent controls were frozen and
committed as `e9ff18dc` before the accepted-source execution or any candidate.

## Diagnosis and primary-source basis

Current `src/commands/expr/index.ts:28` parses the entire argv before calling
`evaluate`. `syntax.ts:85` checks trailing arguments, and `syntax.ts:51` checks
group closure, before evaluation can begin. `evaluate.ts:135` then traverses the
complete AST. This suppresses earlier arithmetic/regex failures and even successful
regex submissions preceding later syntax failures. Moving only the top-level
trailing check cannot repair nested groups or incomplete prefix arguments.

GNU v9.7 `src/expr.c` uses immediate reductions: `main` calls `eval(true)` before
checking trailing arguments; `eval7` evaluates a group before checking its close.
`eval4` consumes the higher-precedence RHS before arithmetic conversion/division,
then reduces before considering the next same/lower-precedence operator. `eval6`
processes prefix arguments in order. `eval5`/`eval6` condition regex matching on
activity; `eval1`/`eval` pass activity through AND/OR. Thus neither “all syntax first”
nor “all runtime errors first” describes the behavior. The skipped GNU
`length`/`index`/`substr` implementations still do work. The user's stricter
parse-only/no-evaluation requirement takes precedence here and is separately tested,
not mislabeled as GNU implementation parity. See `PRIMARY_SOURCES.json` for the
official pinned source and its equality to the local fixture's `src/expr.c`.

## Exact proposed write boundary and internal APIs

Only after root approval, sequencing implementation needs these three product files:

- `src/commands/expr/syntax.ts`: replace `Node`/`parse` with one async precedence
  traversal, keeping the existing precedence/arity tables and diagnostic helpers.
- `src/commands/expr/evaluate.ts`: remove the recursive `Node` evaluator; expose
  reductions accepting already evaluated operands. Preserve arithmetic, byte,
  numeric, character and comparison helpers rather than rewriting semantics.
- `src/commands/expr/index.ts`: replace the parse/evaluate pair with one awaited
  entry. Keep the matcher closure, output/error mapping and session lifecycle.

Proposed module-internal signatures (not package/root exports):

```ts
// syntax.ts
export function evaluateExpression(
  args: readonly string[], budget: Budget, match: Matcher, start?: number,
): Promise<Value>;

type Operand =
  | { readonly active: true; readonly depth: number; readonly value: Value }
  | { readonly active: false; readonly depth: number };

// evaluate.ts
export function evaluateCall(
  operator: string, values: readonly Value[], budget: Budget, match: Matcher,
): Promise<Value>;
export function evaluateBinary(
  operator: string, left: Value, right: Value, budget: Budget, match: Matcher,
): Promise<Value>;
export const zeroValue: IntegerValue;
```

`Value`, `IntegerValue`, `Matcher`, `truth`, `bytes`, `smallInteger` and
`characterCount` retain their existing meaning. `evaluateCall` is the current
`call` without an inactive mode; `evaluateBinary` handles nonlogical binary
operators only. Syntax owns logical short circuit and literal encoding. This
removes the current type import from evaluate to syntax, avoiding an import cycle.
`Operand` refines the early status receipt's optional-value sketch: inactive frames
cannot accidentally be passed as values. No new evaluator service or AST is needed.

Keep `internal.ts`/`Budget`, options, public exports, package metadata, regex protocol,
executor/client and `bre-worker.ts` unchanged for sequencing. The repeat author owns
`bre-worker.ts`. Locale changes touching syntax diagnostics or evaluate helpers must
be coordinated by root before either implementation; the locale author is initially
design-only. No nullable normative work is included. Later documentation/canonical
test writes need a separately confirmed ownership scope.

## Traversal and error order

1. Index retains one `Budget`, one `budget.arguments()` admission pass and the
   existing single `withRegexSession` invocation. Help/version and `--` stay intact.
2. `expression(minimum, parserDepth, active)` awaits `prefix` once, then consumes
   same/higher-precedence operators. Each RHS is awaited with minimum precedence
   `precedence + 1`, preserving left associativity.
3. For active AND/OR, compute left truth once; determine RHS activity before parsing
   it. A skipped RHS is still fully syntax-checked, but no literals are encoded,
   no value reductions or truth/numeric/locale conversions run, and no regex job
   exists. An inactive ancestor forces all descendants inactive. Outer active AND
   yields canonical zero when its left is false; outer active OR preserves its
   nonzero left. When the RHS is active, normalize false logical results exactly
   as today. Never manufacture a value for an inactive subtree.
4. Prefix arguments are parsed/evaluated sequentially, each at prefix grammar;
   a completed argument may fail before a later missing argument is discovered.
   Parentheses await the internal expression, then check the closing token. Quoted
   `+ TOKEN` still consumes exactly one literal token, including parentheses.
5. After both operands finish, account/check the completed structural node and
   perform precisely one active reduction. Await regex completion before advancing
   to the next operand/operator. Runtime failure aborts traversal immediately.
6. Only a successfully completed outer expression reaches the trailing-token check.
   No partial stdout is published; output remains buffered until complete success.

Examples: `1 / 0 x` and `( 1 / 0` report division by zero; `1 / ( 0 x )` reports
the group's syntax error before division; `1 / 0 :` reports a missing RHS to colon
before division. `a : a x` must submit/finish one job before its trailing syntax
failure, while `1 | a : [` submits none. See frozen cases for exact bytes/statuses.

## Budget, depth, async and lifecycle invariants

- Retain argv count/aggregate-byte, NUL and Unicode admission before evaluation.
  This bounded-product safety check can precede runtime failures even where GNU
  has no analogous configured limit; it is not a grammar preparse.
- Keep one monotonically increasing structural node count, including inactive
  literals/calls/binaries. Parentheses still add no AST node. Charge/check each
  completed node once; retain the existing `AST node` diagnostic label.
- Retain the current parser-depth convention at prefix entry, including group and
  prefix recursion and precedence RHS recursion. Separately carry structural depth:
  literal 1; call/binary 1 + maximum child depth; group returns child depth. This
  preserves left-chain `AST depth` limits despite not allocating an AST. Keep both
  existing labels, configured limits and the 256 settings ceiling.
- Each completed node retains the old structural `budget.charge()` and one awaited
  `budget.yield()` checkpoint, including inactive nodes as parser accounting, not
  value evaluation. Check node/depth limits before invoking its reduction. Existing
  active byte allocation/conversion/operation charges remain. Do not add an
  AST-validation pass, replay prefixes, catch/re-evaluate errors, reset a budget,
  or create a second Budget/session. Exact historical step totals may differ because
  skipped computation and duplicate truth scans are intentionally removed; do not
  promise identical threshold refusal order for combined-invalid expressions.
- Preserve string/numeric/output limits at existing allocation/conversion/write
  boundaries. Inactive operands get argv admission and structural work only: no
  numeric-result/string-allocation/locale checks that require their evaluation.
  Syntax diagnostics still use bounded quote/format paths and may refuse with 3.
- Keep the existing Matcher Promise and worker-only BRE machinery. Before every
  active submission retain index's request charge, positive remaining-work check,
  `min(budget.remaining(), worker ceiling)` allowance, and post-result step charge.
  Capture copies and byte ownership stay unchanged. Never run `Promise.all` across
  operands, pre-submit a skipped branch, or speculate and discard a worker result.
- Preserve original abort reasons. One synchronous cleanup registration still
  precedes session acquisition; `withRegexSession` continues to await idempotent
  close on normal completion, syntax/runtime failure and cancellation. Checkpoint
  cancellation must stop subsequent jobs. A job that finishes before a later syntax
  error is real completed work and cannot be “undone.” No product native calls.

The existing full AST design cannot express this ordering without introducing
deferred syntax-error nodes/continuations across every grammar boundary. A separate
pre-evaluation probe or partial-AST retry would duplicate work and effects. The
single traversal plus extracted reducers is the smaller proposed ownership surface.

## Approval and acceptance boundary

Approve the three product paths/internal API before implementation. Run the frozen
61-case set against a separately archived candidate with unchanged expectations,
plus the five overlapping actual-Shell cases. Keep the original old-cap failure in
its own denominator. Candidate capture requires an explicit new immutable binding;
`capture.mjs` intentionally stays pinned to the accepted baseline. This evidence
does not authorize source changes, certify a future candidate, establish Linux
behavior, or claim broad GNU/just-bash superiority.
