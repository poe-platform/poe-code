# Promise finally handler metadata repair

Owner: `qualify-async-job-order`, Promise.prototype.finally category F-129.

ECMA-262 edition 16 (June 2025), section 27.2.5.3, creates anonymous then-finally/catch-finally built-in functions with length one. Overriding `p.then=(a,b)=>[a.length,b.length]` and calling `p.finally(()=>{})` produced `[0,0]`; expected `[1,1]`. Passing a noncallable `finally(7)` argument through unchanged is the neighboring control.

Before runtime edits, `npx vitest run packages/safe-js/test/promise-finally-handler-metadata.test.ts` failed one regression and passed one control in 134 ms. Source: `bc6107ba5a308e94335f2d419d51d122ed17e6c3` plus the fingerprinted worktree; Node 22.23.2 / ICU 78.2. Pinned Test262 `built-ins/Promise/prototype/finally/invokes-then-with-function.js`, revision `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, independently failed both variants.

The repair supplies `name: ""` and `length: 1` when creating the two closures. It changes neither callback invocation nor completion replacement. The independent regression checks arity, name, nonconstructibility and the passing control. Both regression tests and both pinned variants now pass. Final focused qualification passes 132 tests across 12 files; all literal finalizer outcome traces pass across original/pending/completed replay. Full-suite and delivery receipts are recorded separately in `safejs-gap-closure-evidence.md`.
