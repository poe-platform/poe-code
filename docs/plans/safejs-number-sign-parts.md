# Bidirectional literals in NumberFormat parts

Six direct portable-backend comparisons for Arabic, Persian and Hebrew with
auto/always signs fail on negative meter quantities. Directional marks are
included in minusSign values, while native formatToParts returns separate
literal and sign parts. These tests use the existing meter unit, independently
of the unfinished microsecond/nanosecond extension.

The output normalization now separates Arabic Letter Mark, Left-to-Right Mark
and Right-to-Left Mark from plus/minus sign text, preserving character order
and other part fields such as range source. No output text is removed or
reordered, and the input parts are not mutated.

This is a separate atomic correction discovered during DurationFormat
prerequisite work. Verify focused tests, lint, maintained build and supported
Node built probes before direct-main delivery. The new unit data/engine changes
and DurationFormat itself are not part of this commit.

Verification: 128 tests passed across sign parts, subsecond units, generator
checks and existing portable backend tests. Both changed code/test files passed
ESLint. The maintained build passed 23 workspace builds and four fresh imports.
Built Node 18 and Node 24 each passed 12 full decimal-part comparisons; Node 24
also passed 12 full meter-unit-part comparisons.

The full Node 18 meter-unit probe is not green: Persian short-unit output lacks
a space before the native-selected unit label. The literal/sign prefix matches,
but the combined native-word/portable-pattern path needs separate investigation.
Do not change formatting data or relax tests based only on an ICU-version
difference; this remains recorded work, outside the sign-part correction.
