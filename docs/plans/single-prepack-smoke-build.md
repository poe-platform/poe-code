# Build once through the smoke test's native prepack lifecycle

## Observed duplication

The release workflow runs `npm run build`, then unit and lint gates, then
`npm run smoke`. The smoke runner starts with native `npm pack`; the root
`prepack` script is `npm run build`. Therefore the unchanged candidate is built
twice before publication. npm's documented pack lifecycle runs prepack, prepare
and postpack; no lifecycle bypass is needed to eliminate this duplication.

The September 1 release run 33555641963 spent about 169 seconds in the standalone
build. This is evidence of the duplicated work, not a measured saving from the
proposed ordering change.

## Change

After dependency installation, run the existing smoke command as the initial
build-and-smoke gate instead of the standalone build. Remove its later duplicate
invocation. The smoke runner still builds via native prepack, creates a real
package, installs it globally and into an SDK consumer, and executes every
existing CLI, runtime and declaration check. Keep signatures, package lint, every
workspace test task, required lint stress tests and publication unchanged.

Do not change concurrency, package lifecycle scripts, compiler settings, test
selection, limits or assertions. Do not use ignore-scripts, cached test results,
prebuilt-package shortcuts or mocked smoke commands. Publishing still performs
its normal prepack for the final release version.

## Validation

Confirm the inspected smoke runner and root prepack dependency, run
`npm run lint:workflows`, then verify the actual clean GitHub release completes
build-and-smoke before the remaining gates. Do not run the globally installing
smoke command against the developer's ordinary local npm prefix. Record final
job and test-stage timing only from a complete successful run.

Workflow lint passes with the new ordering. Clean GitHub validation and measured
job-time improvement remain pending.
