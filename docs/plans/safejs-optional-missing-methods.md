# Missing methods on functions and generators

## Evidence

The additional optional-chain differential probe found two function-property
failures after the chain-boundary repair (88ef27). At 46df79a5a, independent
regressions covering 12 receiver types and optional/ordinary calls produced
eight failures and 16 passes (dbb6ec). Function expressions, arrow functions,
synchronous generators and asynchronous generators threw before call evaluation.
Optional missing calls incorrectly threw; ordinary missing calls failed to
evaluate argument effects before throwing. The other eight receiver controls passed.

## Repair

Remove the early undefined-method rejection for closures and generators. Route
the captured property through the existing resolved-call evaluator, which handles
optional nullish calls and normal argument-before-callability checks. Keep property
lookup and its receiver unchanged. One existing unit test's implementation-specific
error message changes to the shared non-function call message; it still requires
TypeError. Legacy primitive intrinsic routes are not changed by this repair.

Additional regressions cover getter order, undefined/null/noncallable/callable
results, argument effects and method receivers. Tests are in memory and use native
function execution as the oracle. No visual CLI change requires screenshots.

## Verification and delivery

The seven-file interpreter/function/generator selection passed 638 tests (65ffeb).
The expanded regression file then passed all 32 cases (6d89a9), including the
eight added getter/receiver controls. Scoped ESLint and package TypeScript checks
passed (988df2); the expanded test file received its own additional lint check.
The preceding full package gate predates this repair. Release hold remains active:
no push, publication or issue closure is authorized by these local results.
