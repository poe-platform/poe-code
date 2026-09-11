# Optional-chain short-circuit propagation

## Validated defect

At ccd082032, Test262 `short-circuiting.js` in
`test/language/expressions/optional-chaining` failed with a nullish member error.
The upstream revision was `72faf8ec1445c55149615e8b35187830783aba1a`.
Independent native-function comparisons produced 11 failures and nine passes
before runtime changes (0f89a9). Failures included continuing members and calls,
computed-key effects, deletion, and calls after parenthesized chains.

The evaluator converted a short circuit to ordinary undefined immediately;
subsequent chain segments could not distinguish it from a real undefined result.
Conversely, the optimized member-call route skipped calls even when parentheses
had ended the chain. These are consequences of the same missing chain boundary.

## Implementation

The parser marks member/call segments that continue an optional chain, respecting
parentheses. Evaluation carries an internal short-circuit flag alongside the
undefined value. Only marked segments propagate it. Parenthesized method calls
keep their receiver, and parenthesized undefined calls evaluate their arguments
before throwing. No host capability or ownership rules change.

Reference: [ECMAScript optional chains](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-optional-chains).
Tests use independent sources; upstream fixtures are fetched read-only in memory.

## Eval qualification

The initial 38-file top-level upstream probe reported 18 runtime passes,
two runtime failures, 12 parse rejections, and six excluded async fixtures.
The second failure, `eval-optional-call.js`, requires its top-level `const a`
to be a global Script lexical binding. A native VM Script passes that fixture;
the same source inside a native function throws ReferenceError, as does SafeJS
run source (6141c5). This does not validate an optional-eval defect. A separate
regression checks indirect lookup using a globalThis property distinct from a
local lexical binding. No eval scope semantics were changed.

The original short-circuit fixture now passes unchanged (6141c5).
The complete top-level selection was then repeated (651466): 19 runtime passes,
zero confirmed runtime failures, 12 parse rejections, six excluded async fixtures,
and the one separately qualified eval context mismatch. There were no unexpected
parse accepts or native-unqualified fixtures. Parse rejection is not a claim
about exact guest error branding.
This is a focused probe, not full Test262 conformance or an official harness run.

## Verification and delivery

- Initial 20 independent checks pass after the repair (25fad3).
- Expanded tests cover generator suspension, host-effect replay, and indirect eval.
- Scoped ESLint and package TypeScript checks passed (d4614e).
- Broader parser/interpreter/generator/eval/snapshot selection passed 4,197 tests
  with one skip across 222 files (391b3d), including all 24 new regressions.
- A further 70-case native differential probe passed 68 and found two failures
  calling missing properties on closures with `?.` (88ef27). These remain open;
  the chain-boundary repair does not claim to fix that separate member-call path.
- No screenshots: language evaluation has no visual CLI change.
- Local-only delivery under the release hold; no push, publication or issue closure.
