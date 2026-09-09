# Spread and rest enumerability changes

Eight native comparisons failed on 938975f67, with twelve passing controls
(11610). Object spread, declaration rest, assignment rest and parameter rest
omitted existing string/symbol keys made enumerable by an earlier getter.

Capture all own string and public symbol keys before copying. Recheck each
property's enumerability when reached, honoring rest exclusions. Retain the key
list across guest reads and charge loop work. Preserve host-capability paths.
Reuse the existing primitive-boxing reflection helper.

Verification: 138 tests across five files, TypeScript and scoped lint passed
(34824). A further 42 destructuring order/primitive/iterator/strict-binding tests
passed across four files (42263). Proxy spread/rest dispatch remains separate follow-up
work. No full-package conformance or release claim.
