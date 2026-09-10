# Skipped-day calendar total audit

## Current evidence

Audited the committed total adapter at `772de7794` without changing runtime
semantics. Pacific/Apia skipped 2011-12-30; compatible zone resolution can map
two different civil dates to the same instant, collapsing a calendar interval.

A same-process Node 26.8.1 native/SafeJS comparison checked 45 cases: three
relative dates (`2011-12-29T12:00`, `2011-12-31T12:00`, `2011-12-31T00:00`,
all in Pacific/Apia), each with hours -49, -36, -25, -24, -23, -12, -1, 0,
1, 12, 23, 24, 25, 36 and 49, totaled in days.

43 cases agreed. The two differences were both relative to
`2011-12-31T12:00[Pacific/Apia]` (0d6581):

| Hours | Native Node 26.8.1 | SafeJS |
| --- | --- | --- |
| -12 | Internal Error | -1.5 |
| -1 | Internal Error | -1.0416666666666667 |

The native message is `Temporal error: Internal error: .` (b1599c). This is not
proof that SafeJS should throw or that its numeric answer is conformant.
Backend probes show that subtracting one calendar day from that relative date
returns the same instant, while subtracting two reaches 2011-12-29. Both
fractional-hour endpoints remain on 2011-12-31. A ten-case integer-day comparison
also agreed, including the surprising zero for subtracting one calendar day
from 2011-12-31 (e772e1); agreement is not a normative oracle here.

The upstream issue's separate examples reproduce locally (5a6914): relative to
`2012-01-01T12:00[Pacific/Apia]`, minus one day totals to 0 days and minus 25 hours
totals to -2.0416666666666665 days.

## Specification status and repair constraints

[TC39 issue 3310](https://github.com/tc39/proposal-temporal/issues/3310) is open.
It documents a failed nonzero-window assertion and discusses competing results.
The associated [specification PR 3318](https://github.com/tc39/proposal-temporal/pull/3318)
is open and unmerged at `b419ac82aee632ead958b2b484e60ef9cb85d700`; the
[test262 PR 5044](https://github.com/tc39/test262/pull/5044) is open and unmerged
at `7f64883f81577fae2f44c0ed52c8653665322caa` (GitHub API checks, 5a6914).

The current published NudgeToCalendarUnit algorithm asserts unequal interval
endpoints; the issue demonstrates that this assumption can fail. Alternatives
include moving the interval, changing disambiguation, and handling a zero
numerator specially. Discussion reports that changing disambiguation breaks
existing DST rounding tests. Do not choose one merely to obtain passing tests,
copy a native internal error, or pin SafeJS's current numbers as expected values.

Keep this as an unresolved conformance gap. Once the intended algorithm is
established, cover total, round and until/since with both signs, fractional
remainders, skipped days, ordinary DST and unchanged exact-rational rounding.
This does not block progress on other validated JavaScript gaps.

No code or tests were changed, and no release, push or issue closure occurred.
The probes were read-only/in-memory and did not depend on GC or file fixtures.
