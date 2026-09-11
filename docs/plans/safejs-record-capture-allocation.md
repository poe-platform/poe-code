---
title: Record capture allocation validation
---

# Ordinary-record accounting allocation

Validated after Reflect delivery a98cf260f. The current camera CPU profile is
`/tmp/safejs-camera-reflect-profile.cJAVlr/camera.cpuprofile`: ordinary record
descriptor capture is a major part of measureSandboxData's visit self time.
The three complete camera traces passed locally at 1647/1765/1389 ms, with
11794/11206/9957 budget steps. This does not reproduce CI's scheduling conditions
or establish that the camera timeouts are fixed.

Capture one flat list of retained values instead of retaining a key/descriptor
pair for each property. Unmanaged ordinary records only charge enumerable fields;
avoid explicitly capturing descriptors for their uncharged hidden fields. Keep
managed hidden fields, symbol accounting, accessor captures, exact budget totals,
mutation remeasurement, and complete capture before retained callbacks run.
Native proxies retain their original descriptor-trap sequence and finish capture
before checking managed-state flags.

TDD: the hidden-field capture assertion failed with one unnecessary descriptor
read. Managed-field and proxy ordering controls passed after the proxy control
was limited to string-key traps (the existing arguments brand probe also reads
an internal symbol). A stronger proxy control then caught the first optimization
checking managed state too early: 9 units instead of 23. Capture proxy descriptors
first to preserve that behavior.

Baseline 10,000 measurements of the same 128-field record: 88/71/71/70 ms,
19,570,000 units each. First optimized probe: 88/53/50/51 ms, identical units.
Repeat the probe after final changes; do not infer whole-workflow speedup from it.

Required validation: focused accounting/camera tests, final microprobe and real
camera traces, lint and TypeScript/build, complete SafeJS package unit route,
and the paired real harness with screenshot inspection. Do not increase timeouts
or remove camera assertions. Exclude only the separate unresolved Promise-import
policy probe from the package run, and do not count it or optional skips as passes.

Final focused run: 40 tests passed across accounting, intrinsic retention and
all three complete camera traces (9.43 seconds). Focused ESLint passed. The final
microprobe measured 75/47/48/70 ms with 19,570,000 units in every run; timings are
noisy, and the direct camera comparison remains required. The implementation
and assertions are now held fixed for final validation.

The real harness passed after 70 uncached build tasks (60.883 seconds) and root
suffix stages; its screenshot was inspected. Zero spawns were intentional and
do not establish model behavior. The built camera runs passed at 1645/1525/1323 ms
with unchanged 11794/11206/9957 steps. The earlier baseline included profiling,
so these timings do not establish an end-to-end speedup or CI reliability.
Node 18 built SDK aliases, hidden descriptors and public snapshot replay passed.
The complete package route is running; final delivery is pending its result.

Final package result: 19,044 tests passed, 41 optional tests skipped, 593 files
passed and one skipped (319.20 seconds). The sole explicit exclusion remains
the unresolved Promise-import policy probe, not counted as a pass. Source and
tests remained unchanged throughout this run. Lint, uncached build, Node 18
snapshot validation and the inspected real harness also passed.
