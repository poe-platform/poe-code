# Eval function declaration environments

## Validated failures

The initial twelve native Function/eval comparisons produced ten failures and
two strict-isolation controls. Non-strict eval did not expose its function
declarations to the caller, replace existing var/parameter bindings, or expose
eligible block functions. Tests also cover duplicate declaration precedence,
generator/async declarations, with object environments and eval-local captures.

## Implementation

Eval's top-level function declarations now declare and assign through its
variable environment while constructing closures against its lexical scope.
Strict eval already owns a separate variable environment, so the same operation
preserves isolation. Reuse the existing Annex B block-function collector for
sloppy eval, suppressing caller lexical conflicts instead of throwing for those
optional legacy bindings. Top-level var/function conflicts still throw before
execution. The scope conflict walk now returns the conflicting name so both
paths share the same decision without exception-based control flow.

## Verification

- Initial four-file runtime/declaration regression selection: 65 passes.
- Added eight native Annex B controls for lexical conflicts, unexecuted blocks,
  parameters, async/generator exclusion and subsequent assignment. Combined
  with catch/block-function snapshot regressions: 32 passes.
- Added recovery of top-level and block-function declarations retaining mutable
  eval-local captures. Eval runtime/function/recovery selection: 61 passes.
- TypeScript, focused lint for all five changed source/test files, and whitespace
  checks pass.

No full integration claim. Indirect global declaration instantiation remains
unfinished. This work depends on the uncommitted eval implementation and remains
local; no push or release was performed.
