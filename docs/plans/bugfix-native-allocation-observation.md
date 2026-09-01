# Compare allocation metadata from the observed provider sample

## Problem

The real-filesystem overlay allocation regression compared separately awaited
upper, overlay, and composed-view metadata snapshots. An intervening read may
legitimately update host access time between observations. A normal full gate
failed with only atime differing; the specific reader was not identified.

An isolated control ages the copied-up sparse file's access time, reads the
actual file between observations, and reproduces the same failure shape while
allocation, modification time, and change time stay unchanged. The unmodified
isolated test can also pass, so an isolated pass alone does not resolve the race.

## Correction

Use the existing test wrapper to copy the actual upper lstat result before
returning it to the overlay. For each stat/lstat call through both tested views,
clear the sample, require a fresh provider observation, and compare the complete
returned FileStat against that exact observation. Do not change product code,
omit timestamps, add tolerances/retries, or synthesize metadata.

Keep every existing native allocation, size, identity, block, mode, and copy-up
assertion. The expectation is faithful metadata forwarding, not equality of
independent host observations taken at different times.

## Verification

The delegated scratch baseline reproduces an atime-only failure with an aged
timestamp and real intervening read. The candidate passes normally and with
that same read. A negative control corrupting returned atime by one millisecond
still fails complete metadata equality; its mutation is not part of this patch.
Run the complete allocation test file, maintained type checking, and normal
commit/push hooks after integration. This test-fixture correction neither proves
the original reader's identity nor establishes a user-facing product defect.
