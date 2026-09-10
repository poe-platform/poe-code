# Context-free localeCompare coercion gap

## Reproduction and scope

Direct calls to the internal callStringMethod helper without an interpreter
context differ from native JavaScript (7980bf, 33b0ec):

- A Symbol comparison returns -1 instead of throwing TypeError.
- A guest comparison object whose toString returns "10" throws a closure
  transport TypeError instead of returning -1 for numeric English collation
  against "2".
- The primitive comparison control returns -1 as expected.

This helper is not exported by src/core.ts or src/index.ts. Do not infer that
ordinary public run calls or exported guest closures share the defect:
string-locale-guest-options.test.ts already checks normal guest coercion,
options and replay. The demonstrated gap is the internal context-free call
route, which other maintained string-method tests exercise directly.

## Cause and next checks

String dispatch only uses compareStringLocale when context.getProperty exists.
Its fallback copies comparison values to host data and calls explicit String,
which permits Symbol stringification and rejects guest closures. The shared
collator option reader already accepts an optional context; compareStringLocale
currently requires one in its signature.

Add failing direct-call tests for comparison conversion, inherited/accessor
options, locale-list inputs and abrupt ordering before replacing the fallback.
Preserve direct primitive return/budget behavior where maintained tests require
it. Confirm property-access helpers work without context rather than supplying
an incomplete synthetic context. No runtime fix is made during the active
full-package run 45190, and no broad SDK parity defect is claimed from this
internal-only reproduction.
