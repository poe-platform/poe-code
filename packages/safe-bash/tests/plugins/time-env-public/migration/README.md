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

Adjacent maintained author fixtures at8e1298b give43/47 with four intentional
registry-count failures, then47/47 after the same65→68/66→69 count migration.
The explicit inspection tail adds date/sleep/printenv after the existing five.
Only count/tail assertions and their titles change in stream inspection, split,
and formatting author tests. The current-classified strict inspection consumer
has the same mechanical delta for the qualified release runner. Hex byte
expectations remain unchanged. Both TAP captures are retained here.

The separately owned independent `tests/integration/stream-five-public`65-name
holdout remains unchanged. It is a historical frozen consumer, not a current68
gate; a different reviewer must qualify new public integration. No global search/
replace of65, no waiver of service tests, and no change to the release inventory
classification or native-data exclusions occurred.
