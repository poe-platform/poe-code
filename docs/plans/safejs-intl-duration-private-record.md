# DurationFormat private Temporal record admission

## Validated behavior

The committed readDurationRecord treats privately branded Temporal Duration
values as ordinary records. An in-memory HEAD-module probe rejects a bare
private Duration with "Expected at least one duration field"; adding an own
hours shadow makes it read 999 hours and lose the private 1 hour, 2 minutes,
3 seconds (a430ae).

Native Node 26.8.1 Intl.DurationFormat formats the corresponding native Duration
as `1:02:03` without invoking an own hours getter (d4253b). The working-tree
two-line integration reads the validated private fields before the ordinary
property protocol and returns a separate record. Commit that integration with
direct reader and public-formatter regressions.

## Checks

The new tests cover private fields, independent returned records, getter and
data shadows, unchanged ordinary duration-like records and public digital
formatting. All 47 tests in the new reader/public DurationFormat selection pass
on Node 22 (4cd690). All four new tests pass without skips on Node 18.20.8
(c9c20b); scoped lint (ee8ed3) and package TypeScript (e6d818) pass.

This changes Temporal Duration admission, not arbitrary duration-like coercion
or locale formatting rules. Remaining public Temporal wiring and snapshot
integration are separate work. No full-conformance, push or release claim.
