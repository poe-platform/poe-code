# Reduce private directory-list copying

The guarded lint path previously copied every cached decoded directory listing,
even when a caller only checked pathname membership. A warmed 12-entry memfs
fixture reproduced 14 full decoded-list iterations instead of the two needed
for the outward sorted copy and traversal. The failing evidence is
`/tmp/poe-lint-list-allocation-red.log`.

Keep the decoded list frozen and private. Internal membership checks reuse it;
directory results copy before sorting, and outward ancestor directory reads
return owned arrays. Raw Buffer observations remain freshly read and compared
byte for byte on every access. The existing LRU entry, byte and directory caps,
metadata budgets, identity checks and alias refusal remain unchanged.

The regression preserves exactly 148 metadata operations for the measured
traversal and 14 raw target-directory reads including warmup. Additional controls
exercise unsorted raw listings, caller mutation of directory and ancestor lists,
and refusal of a forged pathname. Iterator instrumentation is confined to one
synchronous memory-only operation and restored in finally; it spans no await.

Run the maintained lint runner suite and `npm run test:stress:lint`, then have
the integration owner run the full guarded lint after source freeze. This is an
allocation reduction; no wall-clock speedup is claimed.

Validation completed: all 278 lint runner tests passed, and both maintained lint
stress cases passed. Logs: `/tmp/poe-lint-list-allocation-green.log` and
`/tmp/poe-lint-list-allocation-stress.log`. The final diff check passed. Full
maintained lint remains the integration owner's coordinated final check.

The coordinated full root lint/type/workflow route passed in 389.83 seconds:
10,510 configured/linted files, zero errors/warnings and 25 receipts. Evidence:
`/tmp/poe-704-lint-allocation-full.log`. The run included the independently
validated tar capability change; its elapsed time is not an isolated benchmark.
