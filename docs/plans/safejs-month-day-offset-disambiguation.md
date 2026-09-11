# Distinguish basic month-day strings from UTC offsets

## Evidence

Pinned Test262 PlainMonthDay/from/fields-string.js failed in both modes at
419d3e0a2273ba01a3bfcbec423f2801425b8e93. A diagnostic over the unmodified helper's
valid-input list isolated --1001 (869fed). The backend accepts it as October 1
(b35560). SafeJS's shared offset-token validator instead classified any short
sign-prefixed body as a standalone offset, including the -- month-day prefix.

Two focused tests reproduced rejection of --1001 and its calendar-annotated form
(e7204e). Four controls already rejected invalid hour/minute offsets, Unicode
minus offsets and invalid bracketed offsets.

## Repair

Exclude the -- month-day prefix from standalone-offset detection. Annotation
validation still runs first, and the complete Temporal parser still validates
date syntax. This does not admit double-minus timezone identifiers as valid
zones or bypass their own parser.

## Verification

All 96 selected offset/parser/Intl-zone tests passed (002866). Upstream reruns
and final static checks are recorded below when completed. This is a focused
local repair, not a complete Temporal qualification or remote delivery.

The original upstream fields-string fixture now passes in both modes without
source/helper edits or exclusions (2d01cc). TypeScript passed (f9424f), whitespace
passed (3a1611), and the patched-runtime source CLI screenshot (4879e5) was
visually inspected for Basic month-day: 10-01. The earlier from-directory
calendar-object failure separately depends on the missing PlainYearMonth:
the original helper's constructor sequence was inspected (710867).
All six focused cases also passed on Node 18.18.2 (c7c614), and scoped lint
completed successfully (b95558).
