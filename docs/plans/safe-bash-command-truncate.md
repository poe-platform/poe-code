# Truncate command workspace

The private `safe-bash-command-truncate` workspace owns argument parsing,
execution and synchronous evaluation. Safe Bash retains composition and its
existing root, `/truncate` and `/commands/truncate` public exports. Consumers
install only the shipping parent package; no standalone command is published.

## Compatibility requirements

- Keep `truncateCommand` as the default retained/atomic resize profile and
  `createTruncateCommand` as the opt-in portable profile. Preserve their distinct
  diagnostics, capability requirements and block metadata interpretation.
- Preserve injected `ioBlockSize` and `seekEnd`, permissions, creation masks,
  canonical byte arguments, cancellation, explicit replacement and default limits.
- Import canonical contracts and filesystem primitives through workspace exports.
  Never depend on Safe Bash from the command workspace.
- Keep command grammar and capability tests with the implementation. Shell,
  aggregate registration, oracle and filesystem integration tests remain in Safe
  Bash because they verify the composing host as well as the command.

## Verification and delivery

1. Revalidate current remote main and existing extraction before editing.
2. Characterize the missing standalone unit build prerequisite with a failing
   integration assertion; add the maintained `^build` task edge.
3. Move grammar and capability assertions unchanged, adapting imports only.
4. Run selected workspace builds, unit tests, typechecks, lint and packaging gates.
5. Verify public packed imports, strict NodeNext declarations, both runtime
   profiles, byte identity, scripts, pipes, cancellation and replacement without
   private workspace dependencies in the consumer.
6. Commit and verify delivery on remote main. Publication remains the existing
   parent release process.

## Qualification

The missing task edge was reproduced before correction. Verification passed:
138 private-workspace tests, 1,756 host regression tests (one optional native
oracle skipped), 168 discovery tests, nine focused packaging/graph assertions,
workspace lint/typechecks and 17 applicable package-lint rules. The two root
bundle-specific lint rules require the unrelated full CLI build and were skipped.
The actual shipping tarballs passed isolated runtime and strict NodeNext checks
without private workspaces installed, including canonical identities, hooks,
scripts, pipes, cancellation and explicit registration. Browser and workerd
export conditions also executed successfully under Node; this is export-route
qualification, not a new browser or workerd host-runtime certification.
