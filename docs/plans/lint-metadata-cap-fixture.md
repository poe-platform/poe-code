# Reduce metadata-cap fixture overhead

## Scope

Exercise the actual eight-million metadata-operation limit through repeated
guarded inspection of the fixture root rather than a nested ordinary file.
The shorter path reduces repeated path splitting and directory lookup work;
every metadata operation still runs through the real guard and memfs. There is
no cached result, fabricated counter, reduced cap, shortened loop or production
change. Inspection still checks the root's ancestors, spelling and canonical
path. This fixture checks cap exhaustion, not nested-file traversal coverage.

Retain the existing exact failure phase/count, failed and reading states,
receipt count, unopened payloads, balanced descriptors and fresh-initialization
assertions. Leave the separate 16,384-file, 19-parent mixed traversal unchanged,
including its exact 1,209,401 operations and configured/unconfigured counts.
Keep all worker settings, test deadlines, guard code and filesystem fixture
implementation unchanged. The unit suite retains nested ordinary-file cap
coverage at its smaller limit.

## Evidence and validation

On Node 22.23.2, run the original and candidate stress callbacks at their
original module URL in an ABBA sequence, without editing repository source.
All four runs pass both cases. Cap-case durations are 14.695/11.274/11.343/14.007
seconds: original mean 14.351 seconds, candidate 11.309 seconds, a 3.043-second
(21.2%) reduction. Whole-suite wall times are 28.388/23.504/23.128/25.495 seconds;
the untouched traversal also varies, so do not attribute its change to this
optimization or promise the same CI saving.

As a negative control, lower only the real guard's default metadata cap to
7,999,999 through an in-memory module transform. The candidate fails its exact
eight-million diagnostic assertion; the untouched traversal still passes.
Restore the real guard and run the maintained stress command and adjacent
unit tests. Temporary reports are `/tmp/poe-lint-target-*.json`.

Preserve incoming main changes, refresh required builds, run normal commit and
push hooks, then monitor the GitHub release. This improvement does not itself
establish the overall test or release duration target.
