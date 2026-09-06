---
title: Promise species compatibility
---

# Promise species compatibility

Status: implemented and locally validated for atomic delivery. Scoped lint and
types, the selected workspace build (four built-import checks), and the real
CLI harness all passed. The harness screenshot was inspected successfully.

## Evidence

`promise-method-species.test.ts` initially had nine failing cases. Seven compare the same
source with native JavaScript before checking SafeJS; all native checks pass.
The two initial invalid-species cases were separately checked with Node.
The final test run takes under one second and has no timeout-based assertions.
Coverage now includes nullish defaults, nonconstructible callbacks, getter
receiver/count/order, constructor and capability errors, missing handlers, and
pending/completed replay checkpoints and fatal budget exhaustion. All 19 focused
cases pass locally. The broader maintained workspace route passed 16,715 tests
with 41 skips. That run started before the three final focused additions;
the final 19-case file was verified separately.

Confirmed missing behavior:

- Reject invalid species and propagate getter errors before later lookups.
- Construct the selected species before `then` returns and preserve its identity.
- Pass raw handler results to the capability resolve function; do not assimilate
  thenables before a custom resolver receives them.
- Deliver thrown handler values to the custom reject function.
- Capture the selected species for `finally` cleanup resolution.
- Invoke a cleanup promise's own `then`, including when PromiseResolve returns
  the original promise unchanged.
- Expose the receiver-sensitive, configurable, non-enumerable species getter on
  the Promise constructor.

## Implementation requirements

Replace constructor-only validation with species selection using ordinary guest
property access. Undefined constructors and nullish species use the intrinsic
constructor; other species must be constructible. Preserve synchronous guest
error timing despite interpreter-managed asynchronous transport.

For `then`, create the selected capability before marking the original promise
observed or subscribing to its settlement. Reuse capability construction without
assuming its returned object is a branded promise. Reaction jobs must route raw
normal/throw completions into that capability. Keep budget/reentry errors fatal
and retain host-call consumption, job ordering, and replay behavior.

For `finally`, capture the selected constructor in both cleanup wrappers. Apply
PromiseResolve with that constructor, including constructor-property identity
checks, then invoke the resulting object's actual `then`. Do not call a mutable
public `Promise.resolve` method as a substitute for the internal operation.

The constructor species getter is an intrinsic accessor; follow existing
collection accessor registration and descriptor conventions.

Promise is now a guest-mutable intrinsic constructor with native descriptor
flags. Its identity/state is registered for snapshots. Standalone low-level
promise member lookup initializes the intrinsic constructor when necessary.

## Validation and delivery

Expand coverage for nullish/default species, getter receiver and read count,
non-constructible functions, constructor/executor failures, missing handlers,
custom returned objects, rejected inputs, cleanup failures, and nested species.
Run promise ordering/replay/recovery tests and the full maintained SafeJS unit
route for the reaction/capability change. Run scoped lint, type checking, build,
and a real CLI harness pair with screenshot review. Do not overlap build output
mutation with tests or type checking.

Keep tests and this plan uncommitted until the associated atomic
implementation passes. Push completed improvements separately to main and
monitor publications while continuing the remaining validated work.

The maintained workspace unit route is run with one explicit exclusion:
`packages/safe-js/src/interp/promise-import-properties.test.ts`. Those two
uncommitted tests concern a pending host-boundary policy decision, not this
implementation, and are not counted as passing. No committed tests are excluded.

## Primary references

- [Promise methods and reaction algorithms](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.prototype.then)
- [SpeciesConstructor](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-speciesconstructor)
- [Promise finally](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.prototype.finally)
