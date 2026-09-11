---
title: Float32Array range bound coercion
---

# Validated gap

Native JavaScript accepts object-valued start/end bounds for `slice` and
`subarray`, invokes start before end, observes source mutations during coercion,
and stops immediately when start throws. Six native-oracle tests fail against
SafeJS before implementation: `/tmp/poe-safejs-float32-range-red.log`.
The current `relativeIndex` helper uses primitive-only `float32Number`.

Use guest numeric coercion while retaining receiver and arguments through guest
calls. Preserve bounds clamping, existing storage aliasing and allocation checks.
Validate direct calls, cleanup after throws, snapshots and the actual harness
pair before a separate atomic commit. Species construction is a separate
remaining gap, not claimed fixed by this change.

Previous `set` improvement is verified on remote main as
7b0b801477d58854967efaf770ddce4bc4747da5; release monitoring continues separately.

# Implementation and qualification in progress

The range methods now use guest numeric coercion and retain their receiver and
arguments through both bound conversions. A shared method call context also
supports accessor-valued coercion hooks in direct API calls. Numeric clamping,
copy allocation checks, and subarray buffer aliasing remain unchanged.

- Initial six failures now pass; the focused maintained Float32/set cohort has
  54 passing tests.
- Expanded coercion, direct-call, retention and snapshot tests plus the three
  camera cases: 15 passed with unchanged camera timeouts.
- Scoped ESLint and final TypeScript checks passed.
- Full SafeJS run: 17,789 passed, 41 skipped, 247.45 seconds, including the two
  additional numeric-clamping controls. Only the separately documented Promise
  import policy tests were excluded. New species tests were authored after this
  run's collection and are not part of this qualification or commit.
- Full-run log: `/tmp/poe-safejs-float32-range-package.log`.
- Previous set release runs: CLI 34088247127 and scoped packages 34088247040.
  Constructor CLI run 34087631154 was cancelled, not published.
- Scoped run 34088247040 published SafeJS 0.1.313 at 05:53:06 UTC.
- Selected SafeJS build closure passed: 23 workspace builds and four native ESM
  checks. No matching open GitHub issue was found.
- Actual harness passed after 70 uncached root builds (59.567 seconds). Visually
  inspected `screenshots/harness-run-docs-plans-safejs-float32-range-coercion.md.png`:
  successful harness output without diagnostics.
