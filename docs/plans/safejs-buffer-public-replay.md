# Preserve buffer object state in public replay dumps

Completed dumps rejected ArrayBuffer and SharedArrayBuffer instances with
subclass prototypes, custom parent objects or accessor properties. Fresh runs
matched native behavior. Nine regression cases reproduced six dump failures
and three passing DataView controls (75856).

Container discovery already traverses both buffer types' object state, and
their dedicated heap encoders already capture backing storage, descriptors and
prototype references. A generic managed-state rejection ran before those
encoders and exempted only DataView and typed arrays. Extend that exemption to
the two branded buffer types; do not remove the rejection for other values.

This is a public `dump`/`run` replay repair, separate from low-level restoration
and from the nonwritable constructor-prototype binding fix. Validate it in an
isolated candidate containing only this guard change, its nine regressions and
this plan. No push or release is authorized.

The combined working-tree buffer selection passes 149 tests across six files
(69375), including the constructor-binding regression's subclass replay case.
An isolated candidate is exported from staged tree
`10704dd966589150646bb708f55bb7669f70db51`; all 1,323 tracked SafeJS source/test
blobs match (7bd411). It excludes the constructor-binding and intrinsic-parent
changes. Initial checks were attempted before archive completion and failed
because files were not yet present; the archive then finished successfully
(18063), the complete tree was verified, and the maintained selected build
was started (43085). These setup failures are not test or build passes.

The isolated build passed all 23 selected workspace tasks and four native ESM
import checks (43085). Focused lint passed (31360). The full snapshot directory
and public dump tests passed 1,751 tests across 131 files (74140). Boundary
probes (5e15ff) rejected a native getter without invoking it; existing diagnostic
behavior omitted native callback metadata and represented a forged buffer as
undefined. No host callback ran. These checks do not claim to repair the
separately observed camera timeouts or other uncommitted work.
