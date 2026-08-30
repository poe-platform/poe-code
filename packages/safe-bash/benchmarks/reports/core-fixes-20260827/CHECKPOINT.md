# Core/bytes author checkpoint, August27,2026

This is bounded author evidence for a different verifier, not independent
certification or a fresh full224/whole-product snapshot.

## Source and regression evidence

- `b5ec52a`: GNU realpath relative flags and wc padding/explicit C counts.
  `tests/commands/core-expanded/before-29a6122.json` retains5/27 passes at the
  old source; corrected author27/27 includes additional env-binding checks.
- `f3eb0fe`: plain-byte sort comparator and64KiB owned output batching.
  `afcea6c` corrects an author test type error; source behavior is unchanged.
  `tests/commands/core-sort/` retains35 native observations, chunk and cancel
  regressions. Existing+new sort/text/seeded author tests47/47.
- `8bf6f43`: streaming cksum algorithm selection, no input-wide buffering.
  Pinned GNU9.7 checksum suite76/76, zero skips. One stale assertion rejecting
  the now-supported explicit crc selector was replaced by an unknown selector;
  positive native crc coverage remains. No benchmark expectation was edited.
- Two env rows remain: output-order profile disagreement and genuine nested
  invocation environment-merge bug. See the core-expanded README. The proposed
  optional replaceEnv contract still needs Sagan agreement and runtime work.

## Current-worktree validation

At HEAD `d1b10a375a13f031f9f604a64395cd507f21a071`, global typecheck/build pass
between02:22:49 and02:22:54 UTC. Other owners' dirty FS/archive/metadata files
were present, so this is not committed-HEAD evidence. No global full suite ran.

The following combined command passes193/193, zero failures/skips/TODO:

```sh
BYTE_GNU_COREUTILS_DIR=/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src \
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/core-expanded/regressions.test.ts \
  tests/commands/core-sort/regressions.test.ts \
  tests/commands/streams.test.ts tests/commands/filesystem.test.ts \
  tests/commands/execution.test.ts tests/commands/independent-io.test.ts \
  tests/commands/text.test.ts tests/commands/independent-seeded.test.ts \
  tests/commands/bytes/checksums/*.test.ts
npm run typecheck
npm run build
```

The oracle path is an existing local GNU9.7 build, not a product prerequisite;
frozen vectors remain committed. Native subprocesses are test-only. Root
package/lock/exports/aggregate have no changes in this work; runtime deps zero.

## Matched performance and fair coverage

`sort/report.json` records exact source composition: b5ec52a before, the same
tree with only f3eb0fe text.ts after, unchanged installed just-bash3.4.2.
Three eligibility controls and18 timed executions all match bytes/status/FS.
All six order permutations run; median37.873ms before,9.241ms after,5.725ms
baseline. Baseline is still faster. Memory samples and host-load/source-loader
caveats are retained. No broad performance or superiority claim follows.

`release.json` records the primary npm latest=3.4.2 observation at
2026-08-27T02:16:39.706Z and exact installed hashes. No dependency install.
The original224 recipes and206/224 versus155/224 scores are untouched.
`../expanded-20260827/baseline-only-frozen/` exposes53 baseline-only names;
three existing recipes are ours0/3 versus baseline3/3;50 names are unmeasured.
This is a coverage ledger, not a new baseline-led functional expansion.
Distinct source/performance/fairness review and broader coverage remain due.
