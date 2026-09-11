# Temporal offset component validation

## Reproduction and scope

Built guest probe d2ff3f accepts +01:60 in Instant.from, Instant.toString,
Duration.total relativeTo.timeZone, and PlainTime.from. Instant.from interprets
it as +02:00 and produces -7200000000000 epoch nanoseconds. Native Node 26
rejects all four with RangeError (dc8c82). temporal-polyfill 1.0.4 remains the
latest published version in that check; its internal parseOffsetNanoMaybe
checks the summed offset against one day but omits minute/second bounds.

The [Temporal string grammar](https://tc39.es/proposal-temporal/#sec-temporal-iso8601grammar)
defines offset minutes and seconds as MinuteSecond (00–59), not TimeSecond
(which additionally admits a clock leap second of 60). TimeZoneIdentifier
permits only minute precision. Embedded date/time offsets may have seconds and
up to nine fractional digits, with either a dot or comma separator. Preserve
these distinctions instead of normalizing invalid components.

## Implementation

Add a strict, regex-free UTCOffset validator and an offset-token scan in front
of the maintained complete Temporal parser. The scan separates bracketed zone
annotations from key=value annotations, leaves IANA names alone, and locates
the offset after the time portion rather than treating signed years/date
hyphens as offsets. Time-only parsing is enabled explicitly for PlainTime.
The backend still validates complete date/time and annotation syntax, calendars,
required fields, offset/zone matching and range limits. This is not a replacement
for that complete grammar parser or a claim of complete Temporal conformance.

Integrate at Instant string conversion, Instant formatting time-zone input,
PlainTime string conversion, and Duration relativeTo string/offset/timeZone
reading. Callers charge input length before scanning. Offset/timeZone bag
validation remains immediate, before later guest getters; native Node 26
confirms both early-error traces (14a884). Keep valid fractional offsets,
leap-second clock fields, expanded-year zone strings, named zones and ignored
annotation values unchanged. Do not patch node_modules or change dependencies.

## Test-first evidence

New public regressions failed ten tests with two valid-input controls passing
(bf4eee). They exposed component normalization, acceptance of malformed zone
annotations and incorrect later getter reads. After implementation, the seven
affected Instant/PlainTime/Duration files passed 165 tests (229943). The strict
parser and public regressions then passed 61 tests on minimum Node 18.18.2
(a50371); scoped lint passed (e18b85). These selections overlap, and neither
is a maintained full-package gate.

The standalone validator and its unit tests can be committed independently.
Public integration remains intertwined with the larger uncommitted Temporal
implementation. No push, release, or complete JavaScript support is claimed.

Selected build 803898 passed 23 workspace tasks and all five fresh ESM import
checks. The rebuilt guest/native Node 26 comparison covered 64 cases (5548e0):
62 matched, while native accepted two ten-digit offset-fraction cases rejected
by the guest. The grammar limits fractions to nine digits. A separate native
probe (c017fb) confirms nine digits yield -123456789 ns but ten digits silently
yield zero, so these are not reasons to loosen the guest parser. Do not describe
the comparison as 64 passing matches; its final shell status was masked by a
subsequent file-existence check, and the explicit differences are authoritative.

Built CLI validation on Node 18 (8de6cc) rejected all four malformed offset
examples, preserved a one-nanosecond offset and normalized only the valid clock
leap second. The screenshot
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-offset-qa.gDRdF7-temporal-offset.ajs.png`
was captured and visually inspected. The README and gap inventory reflect the
local input-validation change, not remote delivery or complete Temporal support.

The broader Temporal/private-value/snapshot/lint selection passed 843 tests with
four native-only skips across 47 files (821c05). This includes the new string
guards and replay coverage but remains a focused selection, not the full gate.

Follow-up grammar audit found another backend limitation: valid time-only,
year-month and month-day strings used as time-zone inputs are rejected. Native
Node 26 accepts `12:34+01:00`, `2020-01[UTC]`, `202001[UTC]`, `01-01[UTC]` and
`--01-01[UTC]` (46c6f7/1cd999), while the backend rejects them (8b8272).
This must be addressed in ToTemporalTimeZoneIdentifier conversion; do not
misclassify it as an invalid-offset guard success or claim complete string
grammar support from this change.
