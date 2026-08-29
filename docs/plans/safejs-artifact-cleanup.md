# SafeJS artifact cleanup

## Scope

Publish current SafeJS bundle outputs without leaving obsolete chunks or stale
TypeScript outputs behind. Preserve unrelated workspace changes and retain the
last usable bundle when bundle compilation fails. This item is independent of the
unfinished SafeJS language-completeness work.

## Implementation

- Guard output paths, including dangling symbolic links, before destructive
  cleanup or publication. Propagate filesystem errors rather than treating every
  failure as a missing path.
- Clean the SafeJS TypeScript output directory before compilation so deleted
  sources cannot leave publishable JavaScript or declarations behind.
- Build the SafeJS bundle in memory and validate its declared entry points,
  output inventory, path aliases, and reachable dependency graph.
- Stage complete output bytes privately. Publish dependencies before entry points,
  then remove obsolete JavaScript chunks and their source maps.
- Reapply bundling after cached development builds restore workspace outputs.
- Preserve unrelated files and do not follow output symlinks outside the package.

Publication is not a transaction across the whole package. A rename failure can
leave a mixture of generations; dependencies are published first, old chunks are
retained until entry publication completes, and retries are tested. Concurrent
builders and hostile filesystem mutation during publication are not claimed safe.

## Verification evidence

The immutable collection checkpoint at `/tmp/safejs-collections.2TstPD` records
successful forced, cached, and development builds; fresh declared outputs; an
offline installed package; and absence of 163 historical outputs and six retired
directories. Its artifact audit checks bundle reachability and package inventory.

The current cleanup rerun is recorded in `/tmp/safejs-native-iterators.FA23tH`.
Independent fault scripts pass on Node 18.18.2, 22.22.2, and 24.14.0:

| Check | Combined coverage |
| --- | --- |
| Publication | 2,880 injected faults, including 576 partial writes |
| Real filesystem publication | 96 temporary fixtures, 384 generations |
| Dependency graphs | 6,000 graphs, 1,800 faults, 72 real in-memory builds |
| Output aliases | 9,000 rejected aliases |
| Symbolic links | 12,000 cases, 600 propagated filesystem errors |

Unit regressions use memory filesystems. The full repository run on August 29,
2026 UTC passes the cleanup tests; it separately exposed an arguments-checkpoint
validation regression in the uncommitted language work. That regression is not
represented as a passing full-suite result and is being corrected independently.

## Manual QA and release procedure

1. Run the bundle, publication, graph, and output-guard unit tests. Confirm
   compilation, write, rename, cleanup, alias, and symlink failures fail closed
   without deleting the prior usable bundle prematurely.
2. Archive the current generated outputs. Add only explicitly owned stale probes
   and confirm the preflight rejects stale output before rebuilding.
3. Run a forced build, a cached build, and development preparation. Verify every
   declared output exists, bundle chunks are reachable, source maps parse, and
   stale probes and retired source outputs are absent.
4. Pack and install into a temporary consumer. Compare installed bytes to the
   package inventory, validate executable entry points, and exercise both CLIs.
5. Inspect actual CLI screenshots. Repeat the artifact preflight after development
   and screenshot workflows so cached restoration cannot silently undo cleanup.
6. Stage only this item's files. Commit conventionally, push to `main`, and
   monitor the GitHub release workflow until publication succeeds. Do not publish
   locally or claim that this cleanup completes the language-completeness goal.
