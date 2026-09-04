# Issue 610: quota proxy invariants

## Reproduction and scope

Constructing `ReadOnlyFileSystem(withFileSystemQuota(overlay, { maxBytes: 16 }))`
throws a Proxy-invariant TypeError on the baseline. Overlay owns a frozen
`capabilities` property, but the quota get trap must return adapted capabilities.
Frozen own methods have the same problem when the trap binds or replaces them.

Keep #604 hard-link accounting and #590 directory admission separate. Do not
weaken Overlay descriptors or return unadapted capabilities to avoid the error.

## Implementation

Proxy a separate view inheriting from the backend, rather than the backend
itself. Read original properties and bind forwarded methods against the backend;
retain quota mutation functions and capability adaptation. The view inherits
property presence without copying or modifying the backend's descriptors.

## Evidence and delivery

- The issue's exact in-memory reproduction throws before the fix.
- Three added regression tests fail before implementation; all 14 quota tests
  pass afterward. They cover Overlay/readonly composition, actual quota
  rejection, unchanged immutable descriptors, global and per-path capability
  adaptation, original method receivers, a nonextensible backend with frozen
  own methods, and a frozen quota view.
- Run the SafeFS test directory, its maintained typecheck and selected workspace
  build closure, guarded root ESLint, and installed-package regression checks.
- Commit only this implementation, its tests, and this plan. Push to main and
  verify root and scoped publication before closing #610 or selecting another
  issue. Do not count a skipped semantic-release publisher as publication.

## Local qualification

All 1,030 tests in the SafeFS test directory (45 files), its workspace
typecheck, and the selected SafeFS workspace build passed. Guarded root ESLint
also passed. The failure was independently reproduced in installed registry
SafeFS 0.1.68. A generated and installed `0.0.0-issue610` tarball passed the
composition and over-quota rejection checks through both the root and `core`
public entries. No other generated library artifact is claimed by that check.

Evidence: `/tmp/poe-610-red.log`, `/tmp/poe-610-green.log`,
`/tmp/poe-610-tests.log`, `/tmp/poe-610-types.log`, `/tmp/poe-610-build.log`,
`/tmp/poe-610-lint.log`, and `/tmp/poe-610-pack.json`. Candidate consumer:
`/tmp/poe-610-consumer.OU5Faq`.
