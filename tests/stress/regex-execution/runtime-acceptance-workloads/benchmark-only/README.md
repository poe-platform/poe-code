# Benign complete-command benchmark only

Authority: **BENIGN_BENCHMARK_ONLY_NOT_DEFAULT_ACCEPTANCE**. The current
root-relayed assignment explicitly approves only this ordinary benchmark and
the historical baseline. Original preparation remains **7/8**, unrebaselined.
No all-green authorization is invented. The original binding/guard and four
risky jobs remain untouched and LOCKED; all six additional exposures stay UNUSED.

`run.mjs` accepts no arguments and can fork only the unchanged prepared compiled
`benchmark.mjs`. It never runs `child.mjs`, lifecycle controls, or the original
five. Its exclusive claim prevents command retries. One exact child handle,
strict unhandled rejections, a fixed 30-second parent watchdog, 16 KiB combined
stdout/stderr cap, 64 KiB cumulative IPC cap, and awaited child/stream closure
bound the run. Only the stored child handle can be killed; no group kills.

Before import, the parent authenticates preparation against `d9e277b`, all 216
candidate source identities, 704 emitted identities in both the final snapshot
and actual moved package, package metadata, and archive SHA256. It checks the
original/final source and emission manifests are identical. Baseline source
and emissions are authenticated against the exact freeze/build archived at
`839f2d4`, including dirty-capture provenance; the label
`329eb2722052e8ace0ec18a751f12c30ed87a25b` alone is not byte identity. Neither
live source nor live root `dist` is an execution input. No build/install occurs.
Frozen identities are checked again after execution.

Only compiled benchmark/observer bytes were cloned into this owned directory's
ignored `.temporary/compiled`; its package link resolves to the actual moved
`node_modules/virtual-bash`. No existing preparation output is written.
The main verifier's authenticated audit and exact 29-PID absence check establish
that those lifecycle children are closed. Other host load is uncontrolled.

## Measurement boundaries

Exactly three alternating baseline/candidate pairs, six commands total, with
the unchanged 32-file fixture, `.ignore`, `rg -g '!file2?.txt' hit .`, and
13 expected output lines. Six commands are not six independent features.
No patterns, input sizes, repeat counts, default policies, or assertions change.

Original complete-command timing includes shell/plugin construction, native
worker startup, traversal, buffered result, and awaited shell disposal. Imports
and VFS setup remain excluded. Native-worker ready-message latency is reported
separately, but remains included in complete-command elapsed time. Parent
ready/close timing is transport metadata, not worker startup or throughput.

The additive `intervals.mjs` preload observes public `use`, `exec`, `dispose`
and the returned plugin's `setup`, returning the original values/promises.
It records immediate public promise settlement before the original benchmark's
await continuation, separately from post-dispose state. No wait is inserted at
public settlement and no historical baseline cleanup contract is rewritten.
Timing taps add overhead to both variants; this is an instrumented cohort.

`pluginUseMs` isolates registration; deferred `pluginSetupMs` is inside `execMs`.
The constructor/factory is not independently instrumented. `setupUpperBoundMs`
equals total minus the exec-entry-to-dispose-resolution interval: it bounds
constructor/factory/registration plus small outer scheduling tails, not an exact
isolated setup duration. `disposeMs` times the original disposal promise;
`settlementToDisposeMs` includes the settlement observation and control handoff.
These intervals are not disjoint throughput estimates.

Only bytes/status parity and clean post-disposal state are required of both
versions. Candidate public settlement is also checked immediately; baseline
public differences remain evidence, not failures or eventual-cleanup substitutes.
No performance threshold, superiority, full-performance, default acceptance,
release, original-benign-green, or 72-hour completion claim follows.

The one-shot command, already bounded above, is:

```sh
node --unhandled-rejections=strict tests/stress/regex-execution/runtime-acceptance-workloads/benchmark-only/run.mjs
```

Do not repeat it after `setup-recovery-claim.json` exists.

## Preserved setup-only failure

The first child exited before ready/run or any command: Node package
self-reference resolved `virtual-bash` to live repository `dist/index.js`.
The unchanged benchmark's physical-entry assertion rejected that URL before
importing it. `result.json`, `claim.json`, and `identities.json` preserve this
failure; `setup-failure-run.mjs.txt` preserves the exact first runner bytes.
Root was notified through the requested marker before recovery.

The owned private `package.json` supplies the missing package scope so bare
resolution uses the owned `node_modules/virtual-bash` link instead of repository
self-reference. The static recovery authenticates the original zero-command
failure, retains the original compiled clones without writing them, repeats
identity checks, and writes only fresh `setup-recovery-*.json` evidence. This is
the assignment's permitted setup-only recovery, not a benchmark command retry.
