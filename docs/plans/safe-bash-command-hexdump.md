# hexdump command workspace

## Ownership and scope

Revalidated remote main `88613aec0b`: the private workspace
`safe-bash-command-hexdump` already owns command execution, formats, display
units, offsets, repeated-row squeezing and the `hd` alias. Safe Bash retains
compatibility facades and the existing public exports and command inventories.
Canonical contracts and the IO engine remain lower-level dependencies, with no
return dependency on Safe Bash. Existing manifests, lockfile and explicit
privateWorkspaces admission already describe that graph.

## Completion steps

1. Characterize missing regression ownership and unit build prerequisites with
   a failing boundary test. Move direct command tests and native fixtures into
   the workspace without changing assertions. Keep Shell integration suites in
   Safe Bash to avoid a dependency cycle.
2. Declare the unit task's prerequisite builds and exclude test-only helpers
   and fixtures from runtime compilation. Preserve all current format, byte,
   EOF, lifecycle and explicit-limit behavior.
3. Extend maintained memfs packaging coverage and isolated public consumers.
   Verify root/subpath factory identity, both aliases, VFS scripts, pipelines,
   canonical byte argv/value/error identity, cancellation, collision policy and
   output limits. Verify strict NodeNext declarations and browser/workerd
   execution without unpublished packages or host capabilities.
4. Run focused workspace build, lint, type, unit, integration and package gates.
   Keep temporary artifacts in out and remove them after verification.
5. Commit, rebase as needed, deliver to remote main and verify ancestry.
   Release publication is separate and is not awaited for this delivery.

No runtime behavior, help or CLI visual output changes are intended.

## Verification

The boundary characterization failed with missing `native.test.ts` ownership
before the move. All ten moved files retain their original contents except for
import rewiring. The command suite passes 323 tests, including native format,
offset, squeezing, EOF, byte ownership, lifecycle and explicit-limit regressions.
The retained Shell suites pass 93 tests. The uncached maintained unit task passes
and builds its eight prerequisite workspaces. Command lint and source/test
NodeNext checks pass.

The maintained boundary and memfs packaging suites pass 289 tests. Package-lint
passes command privacy, private-dependency, cross-package import, workspace
resolution, public export and asset-colocation rules. The selected public Safe
Bash and required SafeJS/Cloudflare companion build closures pass. CLI output and
help are unchanged, so no visual screenshot validation is needed for this move.

The existing public packages were packed and installed outside the checkout.
Actual Shell execution and strict NodeNext declarations pass there; the command,
contracts and IO-engine workspace names cannot resolve. The same fixture passes
browser and workerd bundles in isolated VM realms with no host filesystem,
process or network access (the workerd root's existing WASM uses the maintained
asset loader). Public factories, aliases, scripts, pipes, canonical carriers and
errors, cancellation, permission diagnostics, collision atomicity and finite
output limits all pass. No standalone command package or release job was added.
