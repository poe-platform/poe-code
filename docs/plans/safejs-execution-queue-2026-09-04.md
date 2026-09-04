# SafeJS execution queue and remaining pause work

## Current-state findings

The maintained runtime at `f9876801c` uses `SandboxJobQueue` in both the
interpreter and realm. Pending jobs are removed with `Array.shift()`, moving
remaining array entries repeatedly for large queues. A direct in-memory FIFO
workload measured 50,000 jobs at 867.57, 780.77, and 772.34 ms; 10,000 jobs took
31.57, 18.63, and 13.53 ms. These are queue measurements, not full-interpreter
or application throughput claims.

Six alternating before/after samples with both exact source versions loaded in
one process produced these 50,000-job times (milliseconds):

- Before: 860.68, 821.95, 800.28, 831.62, 803.48, 773.05.
- After: 85.05, 80.71, 82.16, 73.45, 82.72, 65.27.
- Medians: 812.72 before and 81.44 after. Every sample independently checked
  exact FIFO indices and the completed-job count. Garbage collection ran before
  each sample. Build/tests were started during this measurement window, so these
  are cohost-load observations, not an isolated application throughput result.
- Inspector CPU sampling in the same workload attributed 566 of 648 samples
  (87.3%) to `advance` before, versus 1 of 74 (1.4%) after. This directly supports
  the queue-removal hotspot diagnosis, not a claim about unrelated execution.

A follow-up after this agent's build/tests finished reproduced the improvement:
before 675.87, 695.22, 696.10, 683.43, 706.89, 747.88 ms; after 83.80, 60.36,
81.34, 58.53, 86.44, 66.28 ms. Medians were 695.66 versus 73.81 ms (about 9.4x).
The host was not isolated from other applications. This follow-up used the exact
reproduction command below.

The public `run()` returns a promise with snapshot dumping support, not a
pause/resume execution handle. The scheduler's `pause()` stops checkpoint
writes only. Neither it nor the existing replay tests proves that all guest
jobs stop while the parent owns a paused child.
The shared crash/resume helper also completes the original run before restoring
one of its captured snapshots. It establishes replay equivalence for those
cases, not termination or quiescence of a live paused original.

## Queue change

Before changing the queue, characterize FIFO ordering across batches, rejection
cleanup, and suspended-job reacquisition. Replace front removal with two reusable
arrays: append arrivals to one, reverse a batch once into the other, then pop
its oldest jobs. Preserve execution ownership, generations, drain behavior, and
async-prefix semantics. Recheck the same measured workload in alternating
before/after order, and run interpreter, realm, promise, and snapshot regressions.

The three queue characterization tests passed before and after the change.
The seven focused interpreter/realm/promise/snapshot suites passed 629 tests.
The full maintained SafeJS workspace unit command passed 10,081 tests across
266 files; 41 tests and one file remained explicitly skipped. The selected
SafeJS build closure and scoped ESLint passed. These checks validate the queue
change, not the unimplemented pause/isolation requirements below.

Reproduce the alternating timing workload from the repository root:

```sh
node --expose-gc --input-type=module <<'JS'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const file = 'packages/safe-js/src/interp/jobs.ts';
const versions = {
  before: execFileSync('git', ['show', `f9876801c:${file}`], { encoding: 'utf8' }),
  after: fs.readFileSync(file, 'utf8')
};
const queues = {};
for (const [name, source] of Object.entries(versions)) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
  }).outputText;
  queues[name] = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).SandboxJobQueue;
}
async function exercise(name, count) {
  const queue = new queues[name]();
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: count }, (_, index) => queue.run(() => {
    if (index !== next++) throw Error('FIFO mismatch');
  })));
  if (next !== count) throw Error('missing job');
  return performance.now() - start;
}
for (const name of Object.keys(queues)) await exercise(name, 1000);
const timings = { before: [], after: [] };
for (let iteration = 0; iteration < 6; iteration++) {
  for (const name of iteration % 2 ? ['after', 'before'] : ['before', 'after']) {
    global.gc();
    timings[name].push(Number((await exercise(name, 50000)).toFixed(2)));
  }
}
console.log(JSON.stringify({ jobs: 50000, timings }));
JS
```

## Full goal remains active

This queue optimization does not implement pause, lease snapshots, stop pending
host work, qualify all filesystem adapters, or prove Node filesystem isolation.
The next execution work must cover an execution-wide pause barrier, parent
handoff and successive child runs, cancellation while paused, pending host
operations, and restored ownership. Verify both ordinary and extension-backed
execution paths. Preserve the original runtime work under its recovery tags;
do not reapply the incompatible whole-tree overlay.

Filesystem qualification must exercise the actual public module and adapter
boundaries, including traversal, symlinks, two-path operations, and host-race
limits. A mock-only pass must not be presented as real-host isolation.
The current real adapter explicitly documents non-atomic containment checks and
Node path operations, including ancestor-swap, mount, and preexisting-hardlink
limitations. Its current checks cannot establish an OS isolation boundary
against another process changing the tree. Preserve that distinction while
qualifying or replacing the execution boundary.
