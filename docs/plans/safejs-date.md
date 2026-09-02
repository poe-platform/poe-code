# Bounded Date intrinsic

Issue: #543. Date remains a core intrinsic, not an injected browser shim.

## Behavior

- Support `Date.now`, `Date.parse`, `Date.UTC`, function calls and construction from current time, epoch values, strings, another Date or calendar components.
- Support numeric conversion, identity/instance checks, local and UTC getters/setters, ISO/JSON/UTC/string formatting and invalid dates.
- Keep native Date implementations behind branded values and an explicit method allowlist. No native constructors or prototypes cross into guest property lookup.
- Bound parsing input and numeric argument conversion. Locale formatting, custom coercion hooks, subclassing and Date-instance expando properties remain explicitly unsupported.
- Date prototype methods are sandbox closures; per-execution intrinsic ownership prevents realm state from leaking through prototypes.

## Clock and persistence

- Extend the existing clock contract with optional current-time reads and restoration while retaining compatibility with snapshot-only clocks.
- Journal current-time reads through the existing host-call machinery so replay does not reread wall time. Reuse caller clock restoration when available.
- Allow a configured clock in persistent realms and one-shot extension runs without exposing the host clock object to guests.
- Copy valid/invalid Date values by value; preserve aliases within one copied graph. Store the clipped epoch (or an explicit invalid marker) in snapshot/replay heap nodes, preserving mutation and shared references.
- Charge retained Date storage, parsing and formatting against existing budgets; cancellation remains part of normal interpreter execution.

## Verification

- Epoch ISO formatting, UTC and local components, mutation, invalid dates, numeric conversion and the two reported jQuery initialization expressions.
- Configured current time, replay without new clock reads, snapshot/dump round trips, copied alias isolation and independent realms.
- Passive host-Date validation, forbidden native prototype paths, unsupported methods, string/data budgets and malformed serialized Date records.
- Full SafeJS regression tests, public installed Node/Bun/TypeScript consumers, GitHub release and registry provenance before closure.
