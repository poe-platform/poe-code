# Agent Script Default Execution Has No Recursion Limit

## Provenance

- [Bun #928](https://github.com/oven-sh/bun/issues/928)
- [Bun #7899](https://github.com/oven-sh/bun/issues/7899)

## Problem

SafeJS already accounts for call depth and throws a typed `SandboxError`
when `maxCallDepth` is configured. Default SDK execution creates an unlimited
budget, and the CLI exposes a step limit but no equivalent default call-depth
limit. Untrusted recursive scripts can therefore run until host failure or
consume CPU indefinitely.

## Reproduction

```js
const recurse = () => recurse();
recurse();
```

Expected: default `run()` terminates deterministically with a bounded-execution
error.

Current: validators confirmed the exact program remains pending under default
options while an explicit `maxCallDepth` correctly throws.

## Required Behavior

- Define a finite default execution policy for SDK and CLI parity.
- Prefer the existing typed `SandboxError` with `budget: "callDepth"`.
- Keep explicit caller overrides available.
- Ensure mutual recursion, async recursion, generators, and restored snapshots
  use the same policy.

## TDD

Add a failing integration test using default `run()` options before changing the
default. Do not add another explicit-budget test; those already pass.
