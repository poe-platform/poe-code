# Retain hot directory decodings within existing lint bounds

The guarded lint reader rereads directory bytes on every observation. Its
decoded-name cache previously cleared every entry when a capacity bound was
reached, discarding frequently visited ancestors along with cold directories.

A memory-only regression visits 64 cold directories, interleaving a hot
directory. Before the change, the hot name was decoded three times despite
unchanged bytes. After bounded least-recently-used eviction, it is decoded once.
The initial comparison retained exactly 65 hot-directory reads and 1,161
metadata operations in both runs. This measures removed decoding, not elapsed
lint performance.

Only successful fresh byte-for-byte equality refreshes recency. Eviction removes
the oldest entries until the existing 32-directory, 1 MiB name-byte and 32,768
entry bounds permit insertion. No filesystem observation, subject, receipt,
failure check or coverage rule is skipped. A cold-entry revisit also proves
entries are evicted rather than retained indefinitely.

Validation uses the maintained lint runner tests, including sparse and malformed
directory observations, tampering and cache ownership. Full guarded lint is run
only after the coordinated source freeze. No wall-clock speedup is claimed
without a separate complete-run measurement.

The complete guarded root lint and type/workflow suffix checks passed in
369.98 seconds (`/tmp/poe-707-lint.log`): 10,508 configured/linted files, zero
errors or warnings, 25 receipts, and 6,246 directories. This is a current-run
measurement, not an isolated before/after benchmark.

The focused maintained runner suite passed all 275 tests, including independent
aggregate byte and entry pressure controls. `npm run test:stress:lint` also
passed both stress cases. Evidence is retained in
`/tmp/poe-lint-lru-red.log`, `/tmp/poe-lint-lru-green.log`, and
`/tmp/poe-lint-lru-stress-green.log`.
