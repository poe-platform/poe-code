---
title: Intrinsic descriptor measurement validation
---

# Camera timeout investigation: intrinsic descriptor measurement

CLI release run 34126409353 failed on remote main 185a664d4: camera cases took
6326 ms and 5686 ms against the unchanged 5000 ms limit. All other 35,695 tests
passed. Do not raise timeouts or drop fixtures.

The current 7aa367719 built SDK reproduces complete camera output locally.
CPU profiling all three cases showed 4.106 seconds inclusive in
reconcileCompiledValues out of 5.028 seconds total. Retained-root collection
accounted for 1.381 seconds; measureSandboxData accounted for 2.675 seconds.
The profile is diagnostic output in /tmp/safejs-camera-profile.oyelhB/camera.cpuprofile.

An initial deterministic regression confirms unchanged intrinsic function
descriptor tables are recaptured on every measurement. Cache the descriptor
snapshot by the existing proxy's mutation revision, not the measured size:
nested values and retained callbacks must still be traversed every time.
Native writes, defineProperty and deleteProperty already increment this revision.
Untracked tables must remain uncached. Preserve descriptor-snapshot semantics
when callbacks mutate later fields, and never invoke accessors during measurement.

Initial source benchmark (two rounds of three complete fixtures) was noisy:
cache: 1913/1724/2118 then 1927/1632/1187 ms;
baseline: 1905/1712/1480 then 1959/1791/1385 ms.
Warm totals improved about 7.6%, but all-run totals did not. This is not yet
evidence that the CI timeout is resolved. Node visits remained 11794/11206/9957;
peak data remained 7354/6743/6132. Continue validating and profiling; ordinary
record and managed-array descriptor capture remain larger hotspots.

Validation: the maintained package unit route passed 18,958 tests with 41 optional
skips across 588 passing files (306.00 seconds), explicitly excluding the existing
unresolved promise-import-properties policy probe. The four new regressions cover
repeated descriptor reads, nested mutation, native accessor safety, descriptor
snapshot timing, assignment, definition and deletion. TypeScript and changed-file
ESLint passed. The harness uses zero agent spawns and validates runtime behavior,
not model behavior.

An isolated 100,000-read descriptor microbenchmark measured 71 ms for the previous
capture/filter path and 2 ms for the revision cache, with equal descriptors.
This measures only that operation; it is not a whole-workflow speedup claim.

The real harness passed and its screenshot was inspected after 70 uncached
workspace build tasks (59.826 seconds) plus root stages. Built Node 18.18
intrinsic property mutation and public snapshot restoration checks also passed.
