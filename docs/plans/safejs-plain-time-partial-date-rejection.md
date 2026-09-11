# PlainTime partial date rejection

## Requirement

Temporal's IsPartialTemporalObject operation rejects owned PlainDate values
before reading calendar, timeZone, time fields, or options:
https://tc39.es/proposal-temporal/#sec-temporal-ispartialtemporalobject

This restriction applies to PlainTime.with, not ordinary PlainTime.from
property-bag conversion. Instant and Duration remain eligible partial inputs.

## Reproduction and implementation

The regression failed on the current working tree (d7a065): instead of throwing
TypeError, with read calendar, timeZone, hour and overflow and accepted the date.
The from control passed. The shared time input reader now includes the private
PlainDate brand in its partial-input rejection, leaving normal conversion intact.

The three-file time conversion/partial time/partial date-time selection passed
53 tests (425105). All 18 partial-time tests passed on Node 18.18.2 (0f13df).
Scoped ESLint passed (6235f5), and the maintained workspace build passed 23 tasks
and five fresh-process ESM import checks (60ac04). The built CLI screenshot
(0c1158) was inspected: TypeError, no getter reads, and preserved 03:00:00
conversion through from. The screenshot is
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-time-partial-date.ajs.png`.
This does not establish a full-package pass or Temporal completeness.

The input reader and its with tests were previously untracked integration work;
recording them also captures their existing conversion and partial-update coverage.
Public Temporal wiring and other dependencies remain outstanding working-tree
integration. No remote delivery or release is claimed.
