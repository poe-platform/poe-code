# Independent invocation cleanup review

Only this directory is owned. Expectations and old5 identities were committed
before registration source edits. Read EXPECTATIONS.md and HARNESS-CORRECTIONS.md
before interpreting evidence. Runtime source is never consumed from live dist.

Run from repository root using the installed TypeScript development compiler.
Snapshots/builds are ignored generated outputs under .temporary; evidence is
write-once. A fresh label is required for a rerun. Freeze requires a full40 SHA.

```sh
node tests/stress/regex-execution/cleanup-boundary-review/freeze.mjs LABEL COMMIT registration-overlay
node tests/stress/regex-execution/cleanup-boundary-review/build.mjs LABEL
node tests/stress/regex-execution/cleanup-boundary-review/guard.mjs LABEL registration
node tests/stress/regex-execution/cleanup-boundary-review/old-five.mjs LABEL compiled
node tests/stress/regex-execution/cleanup-boundary-review/old-five.mjs LABEL packed
node tests/stress/regex-execution/cleanup-boundary-review/audit.mjs LABEL
```

registration-overlay requires author-ready and overlays only grep.ts, rg.ts,
client.ts and local regex README onto approved contract07acb1a source. All other
source, package/export roots and runtime remain the frozen baseline. This proves
registration, NOT Sagan runtime acceptance. Neither a live commit nor dirty
runtime is an implicit handoff.

After explicit root-relayed /tmp/regex-cleanup-runtime-ready.txt, freeze a new
label using runtime-handoff instead. Then build, run registration plus runtime,
run old-five compiled/packed, and run throughput through guard.mjs. The guard
rejects runtime/throughput jobs without a runtime-handoff manifest. Old-five's
actual moved npm package checks all emitted hashes, static worker graph, public
type consumer and module-resolution location; it never uses source aliases.

runtime.mjs contains8 independent named boundary groups; registration.mjs
contains17, with bounded subvariants explicitly returned in evidence. All are
benign. No allocated risky probes, no old12 replay, no broad fuzz or full gate.
Parent guards enforce20seconds,128MiB heap,64KiB console/1MiB IPC and strict
unhandled rejection handling; they retain exact child exit/stream evidence.

Reconstruction of archived snapshots can use freeze.mjs with a fresh label and
the same immutable commit/mode. Do not overwrite archived evidence or historical
fixtures. Baseline throughput specifically uses the frozen baseline label.
