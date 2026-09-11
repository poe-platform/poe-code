# Proxy legacy accessor lookup

Eight native comparisons failed on ea4b73c26 (59421). __lookupGetter__ and
__lookupSetter__ skipped Proxy descriptors and virtual prototype chains.

Use shared own-descriptor and prototype operations, stopping at the first own
descriptor even if it is data or lacks the requested accessor. Return accessor
identity without invocation. Retain transient prototype nodes and keep traversal
budgeted; preserve existing definition helpers and primitive/key coercion.

Verification: 73 tests across four files, TypeScript and scoped lint passed
(40470). Expanded cycle-budget and transient-prototype retention tests plus
legacy-accessor and primitive regressions passed 56 tests across three files
and final test lint (37107). Other consumers, public construction, callable identity
and snapshots remain incomplete.
