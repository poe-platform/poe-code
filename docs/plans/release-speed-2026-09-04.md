# Release speed, September 4, 2026

## Scope and acceptance

Improve the maintained local build/lint routes and GitHub release critical path.
Keep all required test subjects, native npm lifecycle scripts, artifact checksum
verification, dependency signatures, and publication gates. Measure local changes
and the resulting GitHub release separately. Do not call a microbenchmark or a
documentation-only release proof of a faster publishing release.

The broader SafeJS runtime integration remains incomplete. Its original local
commit is `19934cdaf`, retained by `recovery/safejs-original-2026-09-04`;
`recovery/safejs-rebased-2026-09-04` retains the incompatible rebased version.
These are local recovery tags, not published releases. The broken overlay is
excluded from pipeline validation; this does not discard the runtime work or
establish that pause/resume, handoff, adapters, or isolation are delivered.

## Observed baseline

GitHub run `33881096724` at `977e2a4c9`, September 4:

- Build job: 304 seconds, including 224 seconds packing/building/smoke testing.
- Fresh unit checks: 285 seconds after build completed; cached unit checks: 20.
- Bash shards: 164–191 seconds of test execution.
- Unit checkout alone: 133 seconds; other checkouts: 45–81 seconds.
- Checks job: 196 seconds, including 57 seconds lint stress and 9 seconds audit.
- Release step: 11 seconds. This documentation/tooling-only revision does not
  establish the cost of an actual npm publication.

Earlier publishing run `33825704959` lasted 34 minutes 17 seconds, with nearly
seven minutes in the release step. Do not assume the newer short release step
removed that cost.

That publishing log starts `npx --yes semantic-release@25.0.9` at 01:52:39 UTC,
but the CLI announces its version only at 01:57:13 UTC: about 274 seconds before
release processing. Pinning the CLI into the root development lockfile replaces
this late on-demand installation with the normal cached dependency install.

## Changes under validation

1. Run at most two independent workspace builds within each declared dependency
   layer. Await every layer before its consumers and retain native npm events.
2. Publish same-run build artifacts immediately after the build. Run packed CLI
   smoke testing in the checks job alongside unit/Bash jobs, using an explicit
   `--prebuilt` option which skips npm pack lifecycle scripts, including the
   redundant prepack build. Keep normal package install lifecycles and ordinary
   local smoke rebuilding. Install the tarball once into a temporary consumer
   for both CLI and SDK checks, and invoke that consumer's absolute CLI paths.
   This removes the second, global installation and prevents npm's repository
   PATH from accidentally selecting the source-tree CLI.
3. Run dependency signatures and the existing full lint stress suite in an
   independent audit job. Require it before publication.
4. Reduce lint diagnostic allocations and UTF-8 re-encoding while keeping the
   same directory inspections, file selection, receipts, and failure behavior.
5. Lock `semantic-release@25.0.9` as a development dependency and invoke the local
   binary without allowing an implicit download at the publication step.
6. Exclude the Git-ignored `.cursor` directory from lint, like `.codex`, instead
   of treating local editor skill symlinks as repository-source boundary gaps.

An earlier directory-name shortcut was rejected: it excluded 326 scripts under
evidence/runs and therefore changed coverage. Its faster time is not accepted.

## Local observations

- Full uncached build: 85.37 seconds serial, 70.51 seconds with two workers. Both
  succeeded. Other local tests/profile sampling overlapped parts of these runs;
  repeat without that contention before treating the difference as definitive.
- Isolated repeat: 101.78 seconds serial versus 64.32 seconds with two workers
  (36.8% less wall time). Both passed; CPU time was 155.81 versus 156.24 seconds.
- Alternating six-sample deep-directory microbenchmark: median 1101.60 ms before,
  958.44 ms after, with 96,608 metadata checks in every sample. This measures an
  allocation/encoding hot path, not overall ESLint wall time.
- 474 focused tests and the two existing full-scale lint stress cases passed
  before adding the sibling-cancellation regression. The updated build suites
  pass 196 tests including that regression; full validation remains required.
- Full `npm run lint` passed: 9,617 configured files, all 9,617 linted, zero
  errors or warnings, followed by TypeScript and workflow validation.
- `npm run lint:packages` passed all 17 rules across 71 packages.
- Dependency signature verification passed: 851 registry signatures and 216
  attestations. No existing locked dependency versions changed.
- Packed-smoke option and installed-binary regressions passed, with direct
  ESLint validation of the late smoke-script changes.

## Validation and remaining measurements

- Red/green memfs regressions for parallel dependency scheduling, failure gates,
  immutable lint diagnostics, and malformed UTF-8 directory entries.
- Existing workspace execution/cleanup and lint guard suites.
- Smoke option regression and actual ordinary/prebuilt smoke runs.
- `npm run lint:workflows` for workflow changes; no workflow unit tests.
- Serial versus two-worker workspace builds on the same checkout.
- Unchanged-subject local lint timing and full required unit/stress checks.
- Push only an integrated valid commit, then monitor that exact GitHub SHA
  through successful publication and verify npm latest. Record elapsed time,
  checkout/install costs, cache state, and critical path without claiming a
  guarantee from one warm run.
