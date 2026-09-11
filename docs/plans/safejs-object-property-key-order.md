# Object property-key conversion order

The built runtime skips key conversion for null receivers in hasOwnProperty and
propertyIsEnumerable. Native execution records the key conversion before the
receiver TypeError. ECMA-262 20.1.3.2 and 20.1.3.4 explicitly require ToPropertyKey
before ToObject to preserve exception ordering.

Add differential tests for null/undefined and valid receivers, conversion errors,
symbol keys, side effects, and fatal work exhaustion. Reorder conversion without
changing own-property semantics or host admission. Run focused Object tests,
lint, maintained build, and built Node 18/24 checks, then commit and push this
fix independently of the unfinished weak collections.

## Verification

Four of six new tests failed first: both null-receiver traces omitted conversion,
and both fatal-conversion tests returned the caught receiver error instead.
Conversion now precedes the existing own-property helper's receiver validation.
All 89 focused tests across five Object files pass, covering 32 differential
receiver/conversion combinations inside the new tests. Focused lint and the
maintained 23-workspace build with four fresh imports pass. Built Node 18.18.0
and Node 24.14.0 each match all 32 native combinations. No matching open issue
was found.
