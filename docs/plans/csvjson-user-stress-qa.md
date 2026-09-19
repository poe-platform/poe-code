# csvjson user stress QA

Exercise the literal registered command through safe-bash `Shell` with an
in-memory filesystem, explicit UTF-8 codec, C locale, UTC and noninteractive
terminal bindings. Canonical tests must use no native processes or host files.
Compare exact stdout, stderr and status and preserve the sentinel VFS file.

1. Run the uncached selected csvkit workspace build closure, followed by
   `node --import tsx --test packages/safe-bash/tests/commands/csvjson-stress.test.ts`.
2. For fresh reference-only captures, verify csvkit 2.2.0's installed csvjson.py
   SHA-256 is `cbfe8f90a73d234ddb332b25bf288922cd960b250ea1847b474a05a3554273c5`
   in the hash-locked CPython 3.14.2 / Agate 1.14.2 environment. Use C locale,
   UTC, UTF-8 pipes and the frozen terminal dimensions. Keep scratch under out
   and purge owned scratch after reducing the expected bytes into regressions.
3. Reproduce the original bounding-box precision failure with explicit geometry
   `{"type":"LineString","coordinates":[[9007199254740993,2],[9007199254740992,1]]}`.
   Reference bbox is `[9007199254740992, 1, 9007199254740993, 2]`; the initial
   engine incorrectly selected 9007199254740993 for the minimum longitude.
   Require exact integer comparisons while preserving integer JSON tokens.
4. Check positive and negative mixed integer/float bounds, arbitrary precision
   30-digit integers, Infinity/NaN comparisons, nested polygon coordinates and
   ignored altitude. Empty feature collections retain four null bounds.
5. Check inferred false IDs survive while false properties are omitted, dates
   and datetimes retain ISO serializers, and overlapping type/ID columns are
   excluded before ID selection. GeoJSON's source selector offset is zero by
   default and one with --zero; test both literal argv forms.
6. Check raw GeoJSON's extra-cell quirk: an empty extra cell is ignored, while a
   truthy extra cell raises IndexError after retaining previously emitted
   features. Missing required cells retain the distinct existing raw/typed
   diagnostics.
7. Close an explicitly enrolled stdout consumer during a cooperative pending
   stdin read. Require exact thrown reason identity, no later output, once-only
   producer return and idempotent overlapping invocation cleanup; the caller
   signal stays unmodified. Do not assume a read admission means a previous
   record has already flushed: incremental codecs and parsers may look ahead.
8. Run focused ESLint for the changed implementation and stress test. Root owns
   broader maintained unit/lint checks, integration registration and screenshot
   validation of visible output.

Keep non-string geometry, malformed/nonnumeric bbox schemas, timedelta GeoJSON
serialization and other documented status-78 blockers explicit. Finite edge
cases do not establish exhaustive schema or service parity. No README addition,
commit, push or publication is authorized.
