# Reduce informational npm publication output

## Observation and scope

Release run 33582884227 emitted 4,449 npm notice lines occupying 413,041 bytes,
mostly the package-file inventory. Use npm's supported `warn` log level only in
the GitHub Release Stable step. This omits informational npm notices, including
tarball details, while retaining npm warnings/errors, native lifecycle output
and semantic-release's own progress and publication summaries.

Do not use silent logging, discard stderr, filter exception messages or change
concurrency, tests, builds, lifecycle hooks, package contents or publication
authorization. Informational npm provenance notices are omitted too; verify
publication through GitHub and the npm registry rather than treating console
notices as the proof of publication.

This is separate from removal of the unsupported pnpm settings in `.npmrc`.
That root-cause fix is already published in 14.0.6: the complete release log
for run 33587532314 contains zero npm/runtime warning signatures without this
verbosity setting.

## Validation

- With Node 22.23.2 and npm 11.19.1, a read-only dry-run pack of a small private
  fixture emits 510 stderr bytes at the default level and zero at warn level;
  the stdout package filename is byte-identical. Lifecycle scripts were disabled
  only for this logging probe; this is not package/build/publication validation.
- An intentionally unknown environment setting still emits `npm warn` at warn
  level. A missing package still emits the complete npm ENOENT error and exits
  254. No warning or failure is changed into success.
- Probe outputs remain under `/tmp/poe-npm-verbosity-*.{out,err}`; the fixture is
  `/tmp/poe-npm-verbosity-probe`.
- Validate this workflow configuration with `npm run lint:workflows`, not unit
  tests for the GitHub workflow. Run the normal commit/push gates and monitor
  the following release for actual publication and retained failure visibility.

## Runtime observations

Run 33586435609 completed workspace tests in 12m30s and the job in 19m09s, but
skipped publication because main advanced. The subsequent published 14.0.6 run
completed tests in 17m45s and the job in 27m27s. Do not turn the faster observation
into a guarantee for all runners or claim the slower published run met the target.
