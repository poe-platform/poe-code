# Candidate-only static review

Reviewed exact commit `e2d1b9230f4304650651572395523ca9d1644e74`, never moving live
sources. This is a bounded source review, not a universal security proof.

- `src/commands/tree/index.ts` exposes the three standalone factories and types;
  it does not add root exports, a package subpath or default registration.
- Tree's six TypeScript modules use contracts, the existing identity helper,
  and Node's timer primitive. No host filesystem/content read, subprocess,
  network operation, ambient configuration, eval or runtime package dependency
  is introduced in those modules. The real adapter is explicitly supplied by
  the test host. Loader/esbuild subprocesses are development-tool activity,
  not virtual command implementation.
- `pattern.ts` compiles byte globs to tokens and uses dynamic programming, not
  a generated backtracking regex. Cumulative argument bytes, pattern/name work,
  names and directory sizes are bounded. This review does not measure a new
  worst-case glob benchmark or claim instruction-accurate work accounting.
- `tree.ts` compares complete opaque scoped identities through
  `compareObservedEntries`; unknown tuples remain unknown. No realpath string
  becomes backing authority. Sibling traversal is the chosen profile, not a
  literal user quote. Point-in-time identities are not leases or race defenses.
- `io.ts` races pending FS promises against abort, observes losing rejections,
  and forwards the same signal. Writes use awaited `writeBytes`, owned slices
  of at most 16 KiB, and combined stdout/stderr byte admission. Direct errors,
  limits and cancellation may leave an accepted prefix; no rollback is promised.
- Entry charging includes roots and raw listings, even hidden/filtered items.
  Directory metadata is prepared locally; backend `readdir` materialization
  occurs before the command can cap it. User-supplied huge limit values and
  uncooperative host work are not hard CPU/memory isolation guarantees.

The initial probes observe cancellation identity for direct handlers, pending
FS/sinks, no late unhandled rejection, backpressure, output/entry limits and
actual Shell JSON pipeline/subshell/redirection with a registry stdin consumer.
They do not establish public Shell cancellation identity merely by proxy.
No outside-core failure was observed. Scope gaps are retained in `analysis.json`.
