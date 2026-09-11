---
title: Labels on ordinary statements
---

## Validated gap

Native JavaScript accepts labels on if, switch and expression statements. All
three failed SafeJS regression tests before implementation. Expanded cases also
cover try/finally, var, empty statements, return, throw and continue statements.

## Implementation

Attach labels to the existing statement nodes, preserving their binding and lint
analysis. Consume matching labeled breaks at the common evaluation boundary.
Loop-specific continue handling remains unchanged. Reject labeled lexical,
class, function and module declarations under the runtime's strict semantics.
No synthetic block scope or new snapshot node is introduced.

## Verification

- Compare labeled statements and invalid label cases with strict native JavaScript.
- Check restored sync/async generators in labeled branches, try/finally and switches.
- All 103 focused cases, scoped ESLint and TypeScript checks passed.
- Replaced the parser's obsolete labeled-expression rejection with a positive
  AST assertion; all 90 parser cases pass.
- Final maintained package run after the linter fix: 15,836 tests passed,
  41 skipped; 449 files passed.
- Selected workspace build closure and built-import checks passed.
- Rebuilt after the linter fix; the CLI harness passed and its final screenshot
  was inspected successfully.
- The first screenshot exposed the lexical linter's old label restriction. Updated
  AS001 to accept labels while still scanning their statement bodies for forbidden
  operations; all 36 scanner tests pass. Removed obsolete label lookahead logic.

## Next validated gap

Runtime probes report `undefined` for encodeURI, encodeURIComponent, decodeURI,
decodeURIComponent, URIError and EvalError. These standard globals are not yet
implemented. URI conversion must preserve coercion order, malformed-input errors,
budget accounting and portable builtin identity; it is separate from label syntax.
