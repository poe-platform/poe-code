# Intl.DateTimeFormat

## Evidence

The current runtime returns `undefined` for `typeof Intl.DateTimeFormat`.
Twenty native-comparison regressions fail at the explicit missing-constructor guard.

## Implementation requirements

- Constructor and callable form, subclass prototypes, descriptors, supported locales.
- Guest-only locale and option coercion in specification order; share Date locale option parsing.
- Private native formatter state; never pass guest objects into native Intl.
- Cached bound format identity, resolved options, parts and both range methods.
- Undefined single-date inputs use the same replayable clock as Date, even after guest mutation of Date.now.
- Retained private state and all outputs participate in sandbox budgets.
- Snapshot and restore formatter state, cached function identity, cycles, custom properties and prototypes; reject forged state.
- Check current ECMA-402 and older supported engines separately, including offset time-zone and optional legacy chaining behavior; do not equate native-version differences with defects without validation.

## Verification and delivery

Run focused comparisons, coercion/error-order, clock/replay, budget and snapshot regressions.
Run maintained SafeJS build and scoped lint, then supported-engine probes.
Push the completed atomic implementation to main and monitor its release while continuing other work.

Reference: https://tc39.es/ecma402/2025/#sec-createdatetimeformat

## Verification findings

- The initial 20 constructor comparisons were red before implementation.
- Private-state accounting and repeated heap restoration were independently red before integration.
- Ten h11/h24 snapshot cases exposed that resolved hour12 overrides hourCycle when passed back as a caller option. Restoration now omits the derived hour12 input and validates the reconstructed resolved options against the saved record.
- The focused Intl/Date/legacy-checkpoint set passes 196 tests, with one maintained skip.
- Pending replay must be supplied its custom clock implementation for future reads; a clock snapshot does not synthesize a caller's clock. The test now reinjects that clock and forbids rereading any clock on completed replay.

## Remaining compatibility work, not claimed complete here

- Native Node 18 rejects offset time zones such as +01:00 and -2359, while Node 22 accepts them. A portable offset implementation is still needed for those inputs on older supported engines.
- Node's optional legacy ChainDateTimeFormat form reuses a receiver inheriting from the prototype. The implementation currently returns a new formatter for a plain call; optional legacy chaining remains a separately identified compatibility gap.
