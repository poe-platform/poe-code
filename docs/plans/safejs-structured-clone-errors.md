---
title: Structured clone error data validation
---

# Validated structuredClone leaf-value gaps

Built SDK probes against 7a34bc066 on 2026-09-07 confirm:

- `structuredClone(Object(Symbol("x")))` is accepted. Native JavaScript throws
  DataCloneError with code 25.
- Cloning `new Error("message")` and `new TypeError("message")` preserves the
  brand/name but drops the message. Native JavaScript preserves the message.

These precede the guest-getter implementation. Add failing regressions before
fixing them separately. Cover error name/message/cause, recursive cause graphs,
own-property selection and getter ordering without reading native accessors or
weakening host-boundary admission. Check boxed symbol failures before transfer.

Boxed-symbol rejection was delivered separately in 05bc769e8. The nine error
regressions in structured-clone-errors.test.ts all fail at this baseline:
messages/descriptors for seven standard error types, cause identity, and ignored
enumerable extra properties. Error cloning remains the next implementation target.

## Implementation and ordering

Serialize errors through their own branch: read the name, normalize it to one of
the seven standard error names, then select the own message data descriptor and
perform guest ToString. Accessor-only message/cause descriptors are ignored.
Preserve a string-valued own stack without invoking a stack getter; stack text is
implementation-defined. Clone data-valued causes through the shared graph memory,
including cycles, and ignore ordinary extra properties.

Connect the clone to the selected built-in error prototype. The SDK `run` result
is a sandbox value; the native export check must call `deepCopyFromSandbox`.
A corrected regression confirmed that the export loses branding and fields without
this prototype connection, and passes with it.

Two tests follow the [HTML error serialization algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)
rather than Node 22: HTML reads name before the message descriptor, and does not
coerce a non-string name. Node 22 captures the message earlier and coerces names.

## Manual validation

Run `npm run screenshot-poe-code -- harness run docs/plans/safejs-structured-clone-errors.md`
and inspect the PNG. The actual harness uses no model spawns. Check the built
Node 18 SDK, snapshots, error/clone regression suites, TypeScript and ESLint.

## Results so far

Expanded baseline: 14 failures and two passing controls. Final focused run:
246 tests passed across 15 files, including 25 error-clone tests. TypeScript and
ESLint passed. The native export regression also caught initialization ordering:
set the explicit prototype before assigning the error brand, otherwise the
budget-aware fallback makes prototype assignment a no-op.

The real harness passed after 70 uncached build tasks; screenshot inspected.
Node 18.18 built SDK export returned `[true,"message",true]`: native TypeError
identity, retained message and cyclic cause. No matching open GitHub issue found.
