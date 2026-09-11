---
title: Detached ArrayBuffer snapshots
---

# Detached ArrayBuffer snapshots

Next persistence gap after transfer methods: encodeArrayBufferStorage always
creates a Uint8Array view, which throws for detached storage. Validate primary
snapshot, replay and diagnostic dump paths before implementation.

Represent detached state distinctly from attached empty storage, preserving
resizable identity, buffer aliases, metadata and detached Float32 views. Restore
without reviving detached storage, honor resource limits and reject malformed
payloads. Validate older hosts and multi-round trips. This is snapshot support,
not permission to clone detached buffers with guest structuredClone.

Validated before implementation: all three route tests fail (1.25 seconds),
each with Cannot perform Construct on a detached ArrayBuffer at the shared
encodeArrayBufferStorage byte-view creation. The failing routes are primary
snapshot serialization, replay encoding and diagnostic dump serialization.

The companion harness retains detached source buffers and views across await
points, checking aliases, observable resizability and transferred bytes in the
real runner. It does not spawn models or grant external capabilities. Unit tests
exercise actual serialization and repeated restoration; the harness by itself
does not establish portable snapshot correctness.

Implemented explicit detached storage markers and deferred detachment after
graph initialization, so view construction and cyclic metadata precede the
irreversible state transition. Detached views use a canonical zero layout;
their original inaccessible layout cannot become observable again. Legacy empty
payloads remain attached. Invalid markers, nonempty detached bytes and nonzero
detached capacity are rejected. Detachment work charges the restoration budget.

Verification:

- Initial three route regressions reproduced before implementation.
- Snapshot/ArrayBuffer/Float32 selection: 2,021 passing tests, 111 files, 43.96s.
- Public dump/restore/checkpoint/replay and focused regression selection: 139
  passing tests, five files, 5.03s (includes 14 detached snapshot tests).
- SafeJS TypeScript check and ESLint on the five changed TypeScript files pass.
- Real harness passes; inspected its rendered screenshot. Maintained uncached
  build completed 70 tasks in 59.661s, followed by root bundle stages.
- Built Node 18.18.0 smoke restores detached fixed buffers and aliased views.
  Resizable buffers still require a host with resizable-buffer support.
- No matching open GitHub issue found for ArrayBuffer snapshots.
