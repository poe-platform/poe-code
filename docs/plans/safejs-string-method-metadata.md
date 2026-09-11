# String method metadata and snapshot state

## Validated defects

An audit found 29 installed String methods with incorrect exposed names or
lengths. Independent native-comparison tests reproduce all 29 mismatches.
Another 29 tests show that custom properties and cycles on those same methods
cannot be restored because the methods lack guest-function metadata.
Four already-correct methods serve as passing controls in both groups.

## Change

Declare each supported method's length once, deriving the method-name type and
membership set from that declaration. Expose the actual method name and mark the
closure as a guest function, matching the existing locale and trim intrinsics.
Do not modify string-processing or coercion algorithms.

## Verification

Start with 58 failures and eight passing controls. Run the new regressions along
with receiver, string-operation and legacy-checkpoint checks. Run scoped lint and
the maintained SafeJS build, then commit and push this improvement separately.
