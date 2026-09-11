# Repair stale SafeJS release regression expectations

September 8, 2026: a full SafeJS package run found four failures (21,522
passing tests, 37 skipped). A focused repeat on rebased upstream `555671f64`
reproduced all four failures with 145 other passing tests.

Three assertions still require `__proto__` to be absent. Upstream `314bb3455`
deliberately added the guest-only prototype accessor with native differential,
host-isolation, descriptor, and snapshot coverage. Update the older tests to
assert exact guest prototype identities rather than serialized prototype
absence. Preserve every native-constructor denial and add checks that the host
function's guest prototype exposes neither its native constructor nor interpreter
implementation metadata. Do not remove or disable the accessor.

The fourth failure compares pinned CLDR 48.2 German narrow microseconds against
the host ICU dataset. The pinned source declares singular `{0}μs` and other
`{0} μs`; local Node 22 ICU 77.1 instead adds a space for singular one.
Upstream `a42853511` intentionally retains whole portable unit patterns instead
of mixing native words and portable spacing. Replace this one dataset-dependent
native comparison with four explicit pinned-data format and parts expectations,
retaining all four original values. Keep the other native differential cases.
No formatter behavior or security boundary changes are necessary.
