# Primitive conversion method snapshot state

## Validated defect

Adding properties to String.prototype.toString/valueOf,
Number.prototype.valueOf, or Boolean.prototype.toString/valueOf makes snapshot
restoration fail with missing restored function properties. Five independent
regressions reproduce the failure before the implementation change.

## Change

Register the shared valueOf and toString closures as guest functions so the
existing intrinsic tracker and snapshot restorer retain their mutable state.
Do not change names, lengths, primitive receiver validation or conversion logic.

## Verification

Restore each method twice, preserving its identity, self-reference and mutable
counter, and invoke the restored method to verify primitive conversion. Run the
related boxed-primitive, coercion, intrinsic and legacy-checkpoint tests, scoped
lint and maintained SafeJS build. Commit and push separately.
