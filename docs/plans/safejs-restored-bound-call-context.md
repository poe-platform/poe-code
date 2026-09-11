# Restored bound-function call context

## Validated failure

The live cached Intl adapters preserve invocation context, but the bound-function
adapter in heap restoration rebuilt it from only stack, receiver and newTarget.
This discarded the caller's guest property-access callback.

Three regression tests first call a live DateTimeFormat format, NumberFormat
format or Collator compare function with a guest Proxy and verify the result.
After a real serialize/JSON/restore round trip, the same calls all failed with
`TypeError: Proxy operations require guest property access`. Failure occurred
at the restored call, not the live control or snapshot creation.

## Fix

Forward the seventh call-context argument through the restored bound adapter,
preserving it while applying the bound receiver and current stack/newTarget.
Do not change weak/finalization restoration, argument binding or constructor
dispatch in this commit.

## Verification

- Before: three restored-call tests fail; live controls pass.
- After: 99 tests pass across the new regression file, live Intl proxy coercion,
  general heap restoration and DateTimeFormat requested-options tests on Node 22.
- SafeJS TypeScript no-emit check passes.
- Node 18.20.8: 28 tests pass across restored/live Intl calls, bind prototype
  ordering and Proxy binding.
- Focused ESLint passes for the implementation and regression test file.

The tests establish context preservation through heap restoration, not complete
snapshot conformance. Full-suite failures and other integration gaps remain.
Local commit only; pushes and releases remain paused.
