---
title: URIError and EvalError constructors
---

## Validated gap

URIError and EvalError were absent from runtime bindings. Ten initial constructor,
uncaught-error and checkpoint tests failed before implementation.

## Implementation

Register both names with the existing error factory, internal error-type registry
and known runtime globals. This preserves normal calls and constructor calls,
causes, primitive message conversion, sandbox-only stacks, instanceof checks,
uncaught error names, and portable constructor identity through existing routes.

## Verification

- Fourteen focused cases cover call/new, causes, type identity, changed public
  names, primitive messages, bounded allocation and pending/completed checkpoints.
- Legacy checkpoint comparisons enumerate the two new bindings without changing
  their captured fixtures or relaxing graph checks; 44 checks passed, 1 skipped.
- Maintained package tests: 15,850 passed, 41 skipped; 450 files passed.
- Scoped ESLint and TypeScript checks passed.
- Selected workspace build closure and built-import checks passed. Final typecheck
  was rerun after dependency builds completed to avoid generated-declaration races.
- CLI harness passed and its screenshot was inspected successfully.

## Next validated gap

The four URI conversion globals remain absent. Their eight conversion regressions
are separate from this constructor improvement. Implement them next with coercion,
malformed-input handling, budgeting and portable builtin references; URIError is
now available for their failure path. This does not enable eval or Function.
