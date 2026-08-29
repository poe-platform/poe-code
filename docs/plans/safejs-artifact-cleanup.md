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

Unit regressions use memory filesystems. The first full repository run on August
29, 2026 UTC exposed an arguments-checkpoint validation regression in the
uncommitted language work. After its separate correction, the final run passes
28,388 tests with 39 skipped and no failures; SafeJS contributes 11,002 passing
tests and 37 skipped. Both reports are retained, rather than replacing the failed
attempt. These counts describe the working tree, not the cleanup-only release.

Forced, cached, and development builds pass. The final preflight verifies all
3,197 declared outputs, including after screenshot validation. The artifact audit
checks 3,472 generated files, 249 source maps, six reachable bundle modules, and a
3,398-file package inventory. The 163 historical outputs and six retired
directories remain absent. The packed package is installed offline and its bytes
are checked independently on all three Node versions. Both CLI screenshots are
inspected; the broader, uncommitted language checks are not represented as shipped
features. Installed-byte checks compare against the integrity-verified frozen
tarball, not subsequently edited documentation in the working tree.

The first pre-push attempt reports five TTY lifecycle failures with `TERM=dumb`.
The isolated file reproduces all five; it passes all 71 tests with
`TERM=xterm-256color`. Retrying the normal hooks with that terminal setting passes
all 28,388 tests without changing the prompt code or bypassing checks. SSH
keepalives prevent the long-running hook from losing its remote connection.

## Released cleanup

Commit `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b` publishes `poe-code@11.0.1`
on August 29, 2026 UTC. GitHub release run `33232576840` succeeds, including the
build, signature audit, package rules, 21,277 passing tests with 40 skipped, smoke
checks, and registry publication. These are the cleanup-only committed-tree
results, distinct from the larger working-tree suite above.

The registry's `gitHead` matches the commit. An independent download matches the
registry's SHA-512 integrity; all 3,346 extracted files match the installed
package. The bundle graph contains six reachable modules and exactly three
reachable chunk/map pairs. Both CLIs and public SDK imports execute on Node
18.18.2, 22.22.2, and 24.14.0: nine checks, zero failures. The published consumer
installation uses the registry after an offline attempt reports one uncached
dependency; neither installation runs lifecycle scripts.

Release logs, registry metadata, the tarball, consumer, and verifier are retained
in `/tmp/safejs-cleanup-release.SqYqK4`. The root README documents the verified
build behavior and publication limits. Uncommitted classes, iterators, and other
language changes are not included in this release; the larger language goal
remains open.

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
