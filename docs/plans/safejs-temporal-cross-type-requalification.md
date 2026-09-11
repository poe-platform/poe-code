# Temporal cross-type requalification — September 10

## Previously validated failures

The earlier PlainMonthDay and ZonedDateTime qualification runs failed in shared
helpers that construct missing Temporal types. The local integration now exposes
PlainMonthDay and PlainYearMonth. Method presence alone is not proof of a fix;
the original failing fixtures were rerun unchanged.

## Fresh evidence

Test262 revision: `419d3e0a2273ba01a3bfcbec423f2801425b8e93`.
Runtime: isolated Node 26.8.1; repository default Node remains 22.23.2.
Each fixture used its original source, declared harness includes, sta.js and
assert.js, and had to complete with `ok:true` and an appended sentinel.
Both sloppy and strict modes ran. No fixtures were excluded or unsupported.

| Fixture under test/built-ins/Temporal | Passed | Failed | Evidence |
| --- | ---: | ---: | --- |
| PlainMonthDay/from/calendar-temporal-object.js | 2 | 0 | 26bb79 |
| PlainMonthDay/prototype/with/monthdaylike-invalid.js | 2 | 0 | f3dcff |
| ZonedDateTime/prototype/until/calendar-temporal-object.js | 2 | 0 | 194971 |
| ZonedDateTime/prototype/since/calendar-temporal-object.js | 2 | 0 | 2a3f88 |

These eight passes resolve the missing-type blockers in these four fixtures on
this local candidate. They do not qualify entire directories or all Temporal
semantics, and do not establish default-runtime locale portability.

The source fingerprint recheck (b85b1b) matches the full package test candidate:
1,564 files; SHA-256
`bb31af1b549a043704838fc3cef67a85f943dbea4757e1bc310616d82dc53087`.
The file selection and hashing procedure are recorded in
safejs-post-year-month-integration-gate.md. No implementation/test edits were
made during these rechecks. They ran alongside package test session 26401;
that broader run remains pending and has emitted failure markers.

## Complete PlainMonthDay directory rechecks

The same pinned revision, original harnesses, completion checks and Node 26.8.1
runtime subsequently passed all 59 top-level `PlainMonthDay/from` fixtures in
both modes: 118 passed, zero failed, zero unsupported (c38b7f). All 21 top-level
`PlainMonthDay/prototype/with` fixtures also passed in both modes: 42 passed,
zero failed, zero unsupported (3f9a5c). Sources remained unchanged. These fresh
results supersede the earlier failing baselines for these two directories only;
they do not replace the pending default-runtime package test gate.

## Delivery boundary

This is a local evidence record, not a standalone implementation commit. The
candidate depends on substantial uncommitted Temporal integration. No remote
delivery, issue closure or release is claimed. The release hold remains active.
