# gzip command workspace

## Ownership and compatibility

Baseline revalidated at `a48143133a`: the private `safe-bash-command-gzip`
workspace already owns the gzip/gunzip/zcat handlers, factories and plugin.
`safe-bash-compression-engine` owns shared options, codecs, checksum verification,
bounded streams and staged VFS publication. Both remain private; Safe Bash's
existing bundler admits their code and assets. No standalone package is published.

The public import is `@poe-platform/safe-bash/commands/gzip`. Safe Bash's byte
command aggregate retains its existing inventory and default limits. The plugin
preflights collisions before registration and supports explicit replacement.
The canonical contracts and filesystem remain shared with the host shell.

## Completion work

- Add the missing canonical runtime marker to all three command definitions,
  reproducing the registration-boundary gap with a failing unit test first.
- Move existing direct gzip regressions from the mixed compression suite into
  the command workspace without changing assertions. Keep Shell, archive and
  multi-codec integration tests with Safe Bash.
- Exercise canonical private-artifact rewriting in the maintained memfs packaging
  suite, including gzip's public facade.
- Add isolated packed-consumer execution for binary pipes, VFS scripts, argv/value
  brands, runtime/error identity, plugin collision/replacement, cancellation,
  read-only capability denial, CRC rejection and explicit decompression limits.
  Include the same fixture in browser/workerd publication verification.
- Run the maintained selected workspace build closure, command lint/typechecks,
  command and compression-engine units, focused Safe Bash regressions and
  package-lint/packaging checks. Verify strict NodeNext public declarations and
  packed execution without private workspace packages installed.

## Qualification boundaries

Keep gzip's current GNU-compatible option profile and exact diagnostics; this
work changes ownership and verification, not command behavior or help output.
Native codecs and their asset/checksum admission remain with the existing engine.
Tests use the in-memory filesystem and synthetic bytes, with Node zlib only as a
unit-test oracle. No network or host command capability is introduced.

## Verification

The new runtime-marker test failed before the implementation change and passed
afterward. Fresh maintained unit execution passed 70 gzip and 60 shared-engine
cases; the remaining Safe Bash compression integration suite passed 368 cases.
Gzip and engine lint/typechecks and focused changed-file lint passed. The existing
packaging suite passed 239 cases, and the added gzip memfs artifact case passed.
Package-lint passed 17 rules; its two root-bundle rules require unrelated root
build outputs and were not counted as passes.

The maintained shipping packager produced tarballs installed outside the checkout.
Gzip execution, canonical contracts, registration, CRC failures, limits and
cancellation passed under Node and browser/workerd export conditions. Portable
verification ran without Buffer/process globals. Private gzip, engine and contract
package names were unresolvable. Strict NodeNext declarations passed with compiler
and Node types installed inside the isolated consumer, without workspace source or
node_modules resolution. No help/output formatting changed; no visual CLI change
required screenshot qualification.
