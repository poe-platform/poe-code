# Diff command workspace

## Ownership and compatibility

Baseline: remote main `3183af6865` already owns diff parsing, comparison,
formatting and synchronous evaluation in the private `safe-bash-command-diff`
workspace. `safe-bash-diff-engine` owns shared budgets, line comparison and hunk
primitives used by diff and patch. Both consume canonical `safe-bash-contracts`;
neither depends on Safe Bash. Existing Safe Bash diff and diff-patch paths are
compatibility facades, and the existing default inventory stays unchanged.

Complete the extraction by moving command-only directory, format, ignored-hunk
and retained-input regressions into the command workspace. Preserve every
assertion. Keep Shell, synchronous substitution and diff/patch round-trip tests
in Safe Bash, where those integration dependencies belong. The command test
helper uses the in-memory filesystem and canonical contracts, with no source
imports back into Safe Bash. Exclude test support from shipping declarations.

## Distribution

The command and supporting engines remain private and are bundled into the
existing Safe Bash artifact through admitted private workspace profiles. Public
examples use `@poe-platform/safe-bash/commands/diff`. Do not add publication jobs,
consumer dependencies on private names, or external runtime dependencies.

## Verification

- Demonstrate the standalone regression suite fails with the old Safe Bash
  helper imports, then passes with the leaf-only helper.
- Build the selected diff and Safe Bash workspace closures using the maintained
  workspace builder. Run diff, shared engine and patch units, diff lint/typechecks,
  retained Safe Bash integration suites, package-lint and package-safe tests.
- Extend maintained packed Node/browser fixtures and strict NodeNext consumer
  declarations. Check public factory and error identity, canonical carriers,
  byte output, VFS scripts, pipes, cancellation, registration and explicit limits.
- Install actual parent tarballs in an isolated consumer without workspace source
  or private packages; execute the diff fixture under Node and bundle/run its
  browser and workerd conditions in a realm without host process/filesystem APIs.
- Verify remote main contains the final commit before closing the work. Release
  publication is a separate event, not a prerequisite for this delivery.

The extraction does not change output or help, so it does not require a new CLI
screenshot. Packed byte assertions and existing format goldens preserve output.
Temporary logs and consumers are discarded after verification.
