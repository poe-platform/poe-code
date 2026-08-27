# Current registry fixture migration — August 27, 2026

Source delta41298e6 adds date/sleep/printenv after root-approved source review.
At source f534134, the unchanged current registry files pass37/37 (before.tap).
After that source delta, the same inputs pass29/37 and fail8 count/name checks
(unmigrated.tap). This is an intentional registration delta, not8 runtime fixes.
The revised explicit expected-name set adds exactly date, sleep, printenv;
custom-registry size becomes69. Three new collision probes give40/40 (migrated.tap).
No byte fixture containing65/66 was changed.

Maintained current stream consumers/capture helper now expect68; the historical
60-name source and65-name frozen results remain unchanged. The current-profile
adapter still authenticates the same historical source hash and records each
migration. Existing qualified-release scripts, native data exclusions and
standalone consumer inventory are not replaced. Its current-classified
public-options.mts is updated only for intentional registration counts.

Commands: node --import tsx --test tests/plugins/agent-commands.test.ts
tests/plugins/stream-five-fixture-migration/registry.test.ts

The pre/mid/post captures ran serially against the shared worktree, not an
entire frozen product gate. Final packed validation must use a committed
candidate and a separate consumer with no source fallback. Independent
time-env source/holdout snapshots and their original65-name results are untouched.
