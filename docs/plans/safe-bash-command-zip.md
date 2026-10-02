# ZIP command workspace

## Ownership and compatibility

Revalidated at `2defe5004d`: `safe-bash-command-zip` already owns command
execution and the synchronous help evaluator, introduced by `9ec52b1650`.
`safe-bash-zip-engine` owns ZIP format, crypto, ZIP64, repair and volume helpers
shared with unzip and document readers. Safe Bash retains static compatibility
exports and composition. Both workspaces remain private; consumers import only
`@poe-platform/safe-bash` or `@poe-platform/safe-bash/commands/zip`.

The root workspace glob, explicit Safe Bash private-workspace admission,
canonical `safe-bash-contracts` dependencies and declared unit build prerequisites
already include these owners. The packaging graph bundles their implementations
and codec assets into the existing parent distribution. No new runtime package,
release job, default command, capability or limit is introduced.

## Verification plan

- Extend maintained ownership coverage to ZIP and retain all existing command
  regressions, including encryption, ZIP64, repair, split volumes and limits.
- Exercise installed public exports with binary VFS scripts and pipelines,
  canonical byte-valued password arguments, error identity, cancellation,
  registration collisions, replacement and explicit archive quotas.
- Run command/engine build, unit, lint and type checks, packaging tests and
  package-lint gates. Check strict NodeNext public declarations in an isolated
  packed consumer without private workspaces or source access.
- Verify advertised browser/workerd resolution using the packed public exports.
  Help/output text is unchanged, so no visual CLI change needs qualification.
- Deliver the verification changes to remote main after the checks pass.

The initial extraction predates this reconciliation. These checks characterize
that existing implementation; no failing-before-extraction result is claimed.

## Verified outcome

- ZIP's maintained build closure, command/engine lint and strict typechecks passed.
- All 2,287 ZIP/unzip regressions passed before moving the 11 extended-help
  cases unchanged into the command owner; all 15 owner tests and 13 engine tests
  passed afterward. The 89 ownership checks and 225 memfs packaging cases passed.
- Eight package-lint gates passed for ZIP's declared 12-workspace dependency
  closure: privacy, private dependencies, import/export resolution, cross-package
  imports, transitive bundling and runtime asset placement/packaging.
- Real parent-package tarballs passed in an external consumer with its own
  compiler and no private workspace resolution. Strict NodeNext declarations,
  VFS scripts/pipes, byte passwords, cancellation, registration/replacement,
  quotas, deflate, bzip2, AES and independent LZMA decoding passed.
- Browser and workerd export-condition bundles passed the same consumer checks
  without global Buffer. This verifies the portable bundles, not browser UI or
  a deployed Worker service. No product output/help text changed.
