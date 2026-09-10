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

## Isolated candidate

Created `/tmp/safejs-direct-collation.eldhpt` with copied source/tests and the
maintained root test configuration. Six direct-call regressions failed before
the candidate (890bbf): Symbol comparison, guest comparison conversion, abrupt
comparison ordering, inherited options, guest option values and locale entries.

The candidate routes localeCompare through the shared guest implementation with
an optional context and removes the legacy host-copy fallback. Direct primitive
locale validation and the no-options collation work charge retain their existing
path. Object locale lists and options use budgeted guest reads. No synthetic
invocation context is introduced; accessor execution still requires one.

The first broader selection had four failures (b93855). The candidate now
validates primitive locale strings before option reads. Tests were reconciled
for legitimate function stringification without running the function body,
omitted rather than explicit-undefined option fields, and the new budgeted
option read at maxSteps zero. No budget limit was increased. The native-getter
rejection tests still pass and do not execute the getters.

All 184 locale-related tests in six files now pass in the candidate (61d12c).
This is not a main-worktree fix or delivery. Main runtime files remain unchanged;
full-package session 45190 was independently confirmed live with worker PID
24359 consuming CPU (1e3873). Transfer only after that run terminates and after
the candidate's final lint/type checks are complete.

Final candidate lint reported zero errors/warnings across both runtime files
and all three affected tests (4665a5). TypeScript identified a lost narrowing
through the primitive-locale flag; an explicit guarded string/undefined cast
resolved it. The maintained package compiler with exactly those two runtime
overlays now reports zero diagnostics (50b797). This type-only correction does
not alter the tested runtime behavior. Main transfer remains pending.
