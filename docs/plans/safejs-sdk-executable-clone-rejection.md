# SDK structured-clone executable-value rejection

## Validated gap

The SDK copy path returns guest closures and generators by identity, even when
structured cloning is requested. Six new cases failed before repair (3f7122):
an arrow function, async function, class constructor, generator function, and
synchronous/asynchronous generator objects. Native structuredClone rejects each
corresponding native value with DataCloneError. Ordinary-copy identity checks
passed before the failing structured-clone assertions.

Add an early structured-clone-only guard for guest closure and generator brands.
Keep ordinary identity copying intact. Each case now checks direct input and
nesting inside a record or array; the native oracle remains in the tests.
The interpreter's structured serializer already rejects these guest brands.

## Verification

- Node 22: 42 tests passed across executable, Promise and symbol SDK clone
  rejection plus existing value-copy checks.
- Package TypeScript no-emit check passed.
- Node 18.18.2: all six new regression cases passed.
- Focused lint passed for values.ts and the new test.

Only the two-line executable guard, new test and this plan belong in this
atomic local commit. Other uncommitted Temporal/weak code in values.ts and
unrelated staged Safe Bash changes are excluded. This is not full structured-
clone qualification or a clean full-suite result. No CLI appearance changes.
Release hold remains active: no push, publication or issue closure.
