# Faster checks with measured incremental delivery

Implement and release each improvement independently on main. Preserve task
membership, dependency closure, npm lifecycle hooks, per-file test isolation,
native checks, and authenticated lint input validation.

## Delivery sequence

1. Remove build layer barriers with dependency-ready scheduling, including unit
   prerequisites. Reproduce idle capacity with an in-memory scheduler test.
2. Enable shared machine build and unit result caching. Cache packages separately,
   combine compatible misses in Vitest, and expose explicit uncached execution.
   Include source dependencies, assets, shared setup, commands, environment,
   runtime, and tool versions in content keys. Never cache failed execution.
3. Narrow package invalidation and add affected selection derived from maintained
   workspace declarations. Validate source imports against cache dependency closure.
4. Cache ESLint diagnostics without skipping authenticated input checks. Measure
   initialization, traversal, parsing/rules, cache hits, and total duration.
5. Enable incremental TypeScript compilation/checking where clean output deletion
   does not invalidate incremental state. Preserve complete build artifacts.
6. Benchmark Biome and Oxlint, migrate compatible ordinary lint checks to the
   measured faster option, and retain specialized ESLint processors and checks.

## Measurement and verification

Measure elapsed time on the same machine with runtime and scope recorded. Compare
fresh execution, warm identical execution, one leaf source change, a shared
dependency change, and a second checkout. Separate hashing and cache restore
overhead from execution. Retain only successful, equivalent checks as comparisons.
Store disposable logs and screenshots in out and remove them after use.

Use failing memfs tests before code changes, focused checks during development,
and full maintained npm test and lint gates before shared-infrastructure delivery.
Record local commit, verified remote main SHA, and successful GitHub publication
separately. Continue implementation while releases run and monitor every delivery.

## Initial evidence

- 79 workspaces, 47 unit tasks, 221 dependency edges, ten build layers.
- Normal unit route requests 26 serial prerequisite builds and reports UNCACHED.
- 39 compatible tasks already share one isolated Vitest execution.
- Seven-package CI cache group: 91 files, 3,865 tests passed; 10.78 seconds elapsed,
  9.69 seconds in Vitest. Brief overlap with lint means this is indicative only.
- Root ESLint probe stopped at 72.86 seconds without completion; lower bound only.

## Progress

Implemented locally: dependency-ready prerequisite scheduling; default shared
machine build and compatible workspace test caches; explicit --no-cache routes;
package test ownership without duplicated native SafePython tests; affected
selection from declared consumers; narrower Turbo globals; guarded ESLint clean
result caching; incremental root noEmit typechecking. Root and non-Vitest native test tasks
stay fresh. Successful configured and explicit-pool native Vitest unit tasks also
use the machine cache, preserving their exact npm commands on misses and honoring
cache:false and lifecycle hooks. Fresh CI groups remain uncached. Directory-link inputs also keep their dependent tasks fresh.

Cache correctness regressions cover checkout relocation, transitive source
imports, deletion, symlink referent changes, directory-link admission, and distinct
artifacts for packages in a source import cycle. Fresh Vitest subprocesses
exit after at most 100 selected files; ownership and complete cache
records are retained across batches. Batches retain file identities instead of
project objects, and filter rediscovered substring matches to exact file IDs.
Subprocess transport rejects incomplete, foreign, or failed results and waits for
successful exit; the real two-file smoke check passed. Repeated browser factory builds are combined,
and the mixed command check is split without removing command coverage.

Measurements on Darwin arm64 / Node 22.22.2, with other jobs active:

| Scope | Cold / first run | Warm run | Evidence |
| --- | ---: | ---: | --- |
| Seven compatible unit packages | 22.98 s | 4.48 s | 3,865 tests; seven misses then seven hits, earlier implementation |
| ESLint | about 521 s | 237.53 s | 15,838 warm hits; parsing/rules 148.114 s → 1.449 s; authenticated traversal retained |
| One leaf build | first warm 2.261 s | repeat warm 0.983 s | restore 10 ms → 3 ms; inventory/hash overhead reported separately |
| Leaf build in disposable second checkout | — | 0.052 s | same machine cache hit; 2 ms restore; complete manifest graph with selected source closure |
| Corrected hybrid lint probe, 304 ordinary files | ESLint 2.906 s | Oxlint hybrid 0.725 s | full ordinary recommended rules; 303 native files, one fallback; identical diagnostics |

An intermediate revalidation passed with 15,847 warm hits and 2.697 seconds in
parsing/rules, down from 91.906 seconds in the preceding cold check. Total lint
was 319.25 seconds cold and 609.72 seconds warm under worsening external load;
this pair demonstrates rule savings, not an overall elapsed-time improvement.

The earlier ESLint elapsed-time difference includes changing machine load and filesystem
warmth; the parsing reduction is the narrower cache measurement. The second
checkout is a minimal source checkout for the selected build closure, so its
inventory cost is lower than the complete working tree. Package dry-run contents
contain no .turbo files or tsbuildinfo.

A completed baseline GitHub fresh unit job took 57 minutes 42 seconds. Its native
SafeJS task took 1,457.28 seconds (1,470 files including three skipped), and native
SafePython took 628.36 seconds (1,151 files). These are CI measurements, separate
from the Darwin local comparisons above. The new default native Vitest result
cache addresses those unchanged local tasks; deliberately fresh CI still executes
them. Removing duplicate root ownership preserves their native coverage.

The corrected native probe includes JavaScript recommended and TypeScript rules:
303 of 304 ordinary files were admitted, with one ambient declaration falling
back. The paired comparison above includes guarded snapshots and confirmation. A 24-file characterization
of the hybrid backend produced matching ESLint diagnostics. Parser differences
include duplicate parameters and legacy octals in TypeScript scripts; the latter
remain on ESLint when strict module coverage is required.

The maintained opt-in Oxlint backend is implemented with a locked development
dependency, authenticated byte snapshots, and ESLint confirmation of positive
findings. Unsupported rules, specialized processors, and type-aware configurations
retain ESLint; uncertain native execution falls back. The default remains ESLint
pending broader equivalence evidence. See docs/CHECKS.md for maintained commands.
Npm checkout-specific executable PATH entries are normalized in portable keys;
external PATH changes still invalidate results. Explicit unit cache:false overrides
remain fresh even when a successful record exists.

Latest complete lint revalidation passed in 195.56 seconds. All 1,693 selected shared unit files completed (1,691 passed, two skipped);
maintained native tasks are now running. The isolated full
unit gate is running; previous in-process gates exhibited variable timeouts,
including a 111-second pause in a DOCX case whose isolated 72-test group passed.
Those DOCX tests were left unchanged because no logic bug was reproduced.

Delivery: eleven atomic code/config/test improvements are committed locally; no
verified goal pushes or publications yet. The full lint gate passed, and the
latest focused infrastructure gate passed 323 tests across ten files. The shared
unit phase passed all 1,693 files (two skipped). The full native Bash phase is
still running and has reported failures; separate complete grep, stream-close,
and numeric files passed. A qualification subprocess was terminated during an
isolated reproduction; its cause remains under investigation. Full opt-in native
lint validation is running. These partial checks are not a successful full gate.

Cache publication rechecks fingerprints after successful execution and cleanup
so changed inputs are not stored under their earlier keys. Release each atomic
improvement and record remote SHA and successful GitHub publication separately.

The stable full opt-in native lint route completed successfully across 15,934
configured subjects with zero errors and three warnings (380.93 seconds). This
is not a paired whole-repository speed comparison. The preceding run rejected
filesystem drift introduced by our rebase, as required by its boundary guards.
The complete normal `npm run build` passed in 459.82 seconds: 78 maintained
build tasks, 19 cache hits and 29 misses among cache-eligible tasks. Initial
fingerprinting took 126.221 seconds; this overhead is material on a full closure.

Actual default npm build commands in two sibling minimal source checkouts used
the same machine cache: first checkout 1,476 ms (one miss), second checkout
489 ms (one hit, three ms restoring/executing the cached task). Both exited zero.
This demonstrates normal npm command portability in sibling checkouts; it is
not a full-worktree build benchmark.

The first complete local unit attempt exited unsuccessfully after 2,999.46
seconds. Native Bash reported 41,582 passes, eight failures, one cancellation,
and skipped native cases separately. The failure evidence included regex worker
startup and child deadlines, Bash 3.2 arithmetic oracle mismatches, and a
terminated qualification process. Complete isolated grep, numeric and stream
files passed; a compatible temporary Bash 5.3 oracle made all arithmetic controls
pass, the guarded/invocation files passed, and the 72-case holdout passed from
its actual workspace directory. With committed consistent metadata, direct
qualification produced the expected retired-export rejection in under one
second. These reproductions do not turn the unsuccessful full gate into a pass.

Final complete default lint passed in 201.74 seconds, including TypeScript,
contract suffix checks and actionlint. Publication dry-run contains 3,086 files
and no `.turbo` or `.tsbuildinfo` entries. A complete maintained default-cache
unit gate is now running with the compatible temporary GNU Bash 5.3 on PATH and
stable committed metadata. Its pending result is reported separately from the
successful focused and lint/build gates.
