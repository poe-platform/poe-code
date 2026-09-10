# Async optional-chain qualification

## Scope and harness

At f7d7a2c27, qualify the six async files previously excluded from the top-level
Test262 optional-chaining probe. The pinned revision remains
`72faf8ec1445c55149615e8b35187830783aba1a`. Sources and declared harness includes
are fetched read-only in memory, with no fixture rewriting.

The harness installs a guest `$DONE` function both lexically and as an own
globalThis property, awaits its completion promise, and bounds completion to
five seconds and guest execution to two million steps. Native VM execution uses
the same harness. An initial attempt omitted the globalThis property; five
fixtures rejected that harness with `asyncTest called without async flag`
(3dc692). Those are harness setup failures, not runtime defects.

## Results

After correcting harness setup (003537), these five fixtures pass native and
guest completion:

- iteration-statement-for-await-of.js
- member-expression-async-literal.js
- member-expression-async-this.js
- optional-chain-async-optional-chain-square-brackets.js
- optional-chain-async-square-brackets.js

`member-expression-async-identifier.js` completes native assertions but creates
an unhandled `Promise.reject(undefined)` while reading an inherited property
from that promise. The probe observed the native process's unhandled rejection.
SafeJS fails the run with `UnhandledRejectionError: Unhandled rejection: undefined`.
`throwIfUnhandledPromiseRejected` in run.ts explicitly enforces this policy;
the rejection tracker and existing run tests cover it. This is not evidence
that optional chaining should await its base promise or mark that rejection handled.
No tracker policy is changed to accept the fixture.

Combined with the previous non-async probe, the 38 top-level fixtures now have
24 runtime passes, 12 parse rejections, one global-Script lexical-context mismatch,
and one unhandled-rejection policy difference. This is not full Test262 conformance
or an official harness run. Parse rejections do not establish exact error branding.

## Regression coverage and delivery

Independent tests cover awaited keys/arguments, skipped rejected promises,
parenthesis boundaries, ordinary undefined results, promise-property lookup,
and host-effect replay. Native comparisons run in async functions, matching the
run source context rather than assuming global Script lexical declarations.
All 72 selected optional-chain tests pass, including 16 new async cases (d16cb5).
Scoped ESLint passed (be21f7). No visual CLI change;
no screenshots are needed. Release hold remains active: local-only delivery.
