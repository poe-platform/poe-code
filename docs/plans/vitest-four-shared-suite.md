# Upgrade the shared suite to Vitest 4

## Scope

Pin Vitest and its V8 coverage provider to 4.1.11, including the four workspaces
that declare Vitest directly. Keep Vite 6.4.3, Node 22, the thread pool, two
configured workers, per-file isolation, serial workspace phases, native npm
lifecycle routes, declared task ownership and uncached execution unchanged.
Do not enable Vitest's experimental native runner, remove tests, add skips or
change any GitHub concurrency setting.

Use the supported `vitest/node` reporter export, `standalone()` initialization
and `onTestRunEnd` callback. Print one cumulative summary while retaining early
failure, interruption and snapshot notices. Start the reporter clock only once
for the complete shared run, not again for every workspace phase: otherwise
Vitest 4 reports the last phase's duration beside cumulative case counts.

Two fixture adaptations preserve their existing assertions:

- A mocked ReadableStream constructor must be a constructable function, not an
  arrow. Its injected failure identity and signal cleanup checks remain intact.
- Clear the MCP stderr spy after intentionally warming its cache. Re-spying on
  the same method in Vitest 4 retains its previous calls; the assertion must
  observe the second request, not the warm-up output.

## Isolated qualification

The separate checkout `/tmp/poe-vitest4-probe-20260902` is based on `9a729b201`.
All measured runs use Node 22.23.2 and the maintained
`npm run test:unit:shared` command. Dependency installation is outside the timed
region. Restore the exact original tracked source and lockfile for the final
baseline, then reinstall those locked dependencies. No worker settings change.

| Run | Version | Wall seconds | Passing cases | Skipped cases |
| --- | --- | ---: | ---: | ---: |
| A1 | 3.2.6 | 184.60 | 29,780 | 43 |
| B1 | 4.1.11 | 158.67 | 29,780 | 43 |
| B2 | 4.1.11 | 150.54 | 29,780 | 43 |
| A2 | 3.2.6 | 167.34 | 29,780 | 43 |

Every run has 1,143 passing and three skipped files. Mean wall time decreases
from 175.970 to 154.605 seconds: 21.365 seconds, or 12.1%, for the shared suite.
This is an on-machine observation, not a promised CI saving. The spread between
baseline runs matters. No new pass is inferred from unavailable profiles.

The original suite on Vitest 4 exposes two constructor-mock failures and one
warm-up spy-history failure. Each fails before its fixture adaptation and passes
afterward. Reporter controls fail before migration to the supported APIs, and
clock controls catch three starts instead of one. Failure-only run status and
interruption reporting have explicit red/green controls too. The latter
failure-only summary refinement follows the timed runs; it changes a failure
branch and its existing unit assertion, not the passing workload selection.

The candidate passes packed-CLI smoke and root type checking. The final
reporter control file passes all 27 cases. The two initial focused compatibility
files pass 71 cases; the reporter/MCP pair passes 34. No assertion is removed.
Temporary evidence is in `/tmp/poe-vitest4-*.log`, with the candidate patch and
before/after source fingerprints alongside it.

The existing markdown-reader coverage command initially measures 89.79% line
coverage under the new provider, below its unchanged 90% requirement. Add one
fast test for empty and whitespace-only section IDs, checking both UserError
and the exact diagnostic. All 53 package tests then pass with 90.47% line
coverage. Disabling the real blank-ID guard makes that test fail; restore the
guard afterward without any production change. This one additional regression
case follows the timed comparison and is included in the final integration.

## Integration and release

Preserve incoming main changes, install the locked dependencies normally, run a
fresh packed-CLI smoke check, then use normal commit and full pre-push gates.
Monitor the resulting release for warnings, publication and actual runtime.
Do not report a queued, cancelled or stale-head-skipped run as publication.

Integration on `89ed8c3a` passes normal dependency installation and a fresh
packed-CLI smoke check, including the incoming named-host-object feature.
Registry verification reports 459 signed packages and 103 verified attestations.
The `poe-code --help` screenshot is readable, with no visual repair required.
Vitest's filesystem module cache remains disabled; it is not used for this gain.

The first integration pre-push catches a patch-transfer mistake: the MCP spy
reset lands in the first test instead of after the second test's cache warm-up.
Move it to the intended second-run test without changing its assertions. The
reporter/MCP pair then passes all 34 cases again. The earlier benchmark runs
used the correct placement; this integration failure is not a flaky-test retry.
Repeat normal commit and full pre-push validation before delivery.

The preceding CI run `33598194403` passes workspace tests in 18m49s and the job
in 25m58s, with no npm/runtime warning signatures; publication is skipped after
main advances. This local runner improvement alone does not establish either
the 15-minute test target or a 20-minute complete release.
