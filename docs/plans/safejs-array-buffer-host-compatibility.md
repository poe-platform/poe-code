---
title: ArrayBuffer host compatibility
---

# ArrayBuffer host compatibility

Confirmed import failures on installed Node 18.18.0 and Node 20.0.0, both within
the declared Node >=18.18 support range. Node 18 fails in float32.ts when eagerly
reading an absent resize descriptor. Node 20 fails in the new slice code when
eagerly reading an absent detached getter. Logs:
`/tmp/poe-safejs-array-buffer-node18-red.log` and
`/tmp/poe-safejs-array-buffer-node20-red.log`.

Restore fixed-buffer operation without depending on newer optional host methods.
Keep actual detachment validation, including zero-length buffers. Do not silently
turn a requested resizable buffer into fixed storage on older hosts. Resizable
buffer emulation remains a separate completeness gap on such hosts.

Slice is verified on remote main as 5d7cf7f42fb2a153822229e65adc6cfce7884654.
Iterator CLI publication is now verified: poe-code@14.0.84, run 34094300838,
npm receipt 2026-09-07T07:26:43.8818643Z. Its release does not include slice.

Two regression tests reproduce the absent host descriptors. After removing the
import-time assumptions, an additional check reproduced silent acceptance of a
resizable request without host capability. It now fails explicitly instead.
Logs: `/tmp/poe-safejs-array-buffer-host-compatibility-red.log` and
`/tmp/poe-safejs-array-buffer-host-capability-red.log`.

Detachment uses zero-length typed views, which validate detached buffers without
requiring the newer detached getter. The original slice detachment tests remain
unchanged. Scoped slice release run 34095607485 is active.

The 309-test focused suite passed across 23 files in 14.94 seconds, covering all
Float32 and ArrayBuffer interpreter tests plus ArrayBuffer snapshots. Scoped
TypeScript and ESLint passed afterward. Logs use the prefix
`/tmp/poe-safejs-array-buffer-host-compatibility-`.

The actual harness passed after 70 uncached build tasks (59.777 seconds).
Inspected `screenshots/harness-run-docs-plans-safejs-array-buffer-host-compatibility.md.png`:
clean pass, expected fields, zero spawns. Native Node 20.0.0 now passes fixed
slice plus zero-length detached-buffer rejection using the built run API.
Native Node 18.18.0 now imports the buffer module successfully, but calling run
exposes another independently validated failure in object-array.ts: its method
length initialization dereferences absent newer Array.prototype methods. That
separate issue must be fixed next; this commit does not claim complete Node 18
runtime compatibility.
