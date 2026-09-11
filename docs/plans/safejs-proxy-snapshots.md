# Proxy checkpoint graphs

## Validated gap

Public Proxy construction existed, but heap capture omitted its private target,
handler, and revoker edges. Eleven strengthened regressions failed before the
repair. Checking only replay outcomes masked the gap, so the tests also require
Proxy heap nodes and exercise direct graph serialization without source replay.

## Implementation

- Capture Proxy and revoker nodes before ordinary closure/object capture.
- Allocate carrier shells before hydrating edges, preserving cycles and aliases.
- Preserve callable/constructible identity, revoked state, private fields, and
  revoker property descriptors. Used revokers release their Proxy reference.
- Validate fields, references, target chains, and callable flags; reject forged
  internal-node targets, mismatched revoked slots, and cyclic target chains.

## Verification

- Final focused graph tests: 28 passed, including native comparisons, malformed
  snapshots, direct hydration, bound functions, and suspended generators.
- Snapshot directory: 1,692 tests passed across 127 files.
- Proxy and related integration selection: 771 passed across 47 files.
- Package TypeScript check and scoped ESLint passed after correcting the depth
  validator's required diagnostic-path argument.
- These checks ran in the working tree, which also contains separate weak
  collection experiments. They are not a clean committed-tree or full-package
  gate. Weak collection changes are excluded from this commit.

## Remaining work

Audit suspension inside traps, host import/export boundaries, and remaining
Proxy identity consumers. Complete JavaScript conformance is not established.
The README describes the tested support without claiming those audits complete.
Pushes and releases remain paused at the user's request.
