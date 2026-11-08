# du command workspace

## Ownership and scope

Revalidated remote main `40fa406f66`: `safe-bash-command-du` already owns the
implementation (introduced by `b9634cd075`), including argument parsing,
recursive accounting, scoped inode deduplication, exclusions, formatting,
limits and the synchronous evaluator. Safe Bash retains the public facade.
The package is private and admitted by the root workspace, Safe Bash's explicit
privateWorkspaces profile and lockfile. Its dependencies point to canonical
contracts, filesystem primitives and pure byte/IO engines; there is no return
edge to Safe Bash. No new command, default registration, dependency or release
job is needed.

## Completion steps

1. Add a failing boundary check for owned regression tests and unit prerequisite
   builds, then move direct tests without changing assertions. Keep actual Shell
   and backend integration tests in Safe Bash to avoid a dependency cycle.
2. Declare the command's `test:unit` dependency on `^build`. Exclude its test
   helper from runtime declarations. Describe supported flags, allocation
   prerequisites, registration and limit defaults in the package README.
3. Add maintained packed-consumer fixtures for root/subpath factories, actual
   Shell execution, VFS scripts/pipes, byte-value/carrier identity, symlink and
   hardlink accounting, exclusions, collisions, limits and cancellation.
   Compile strict NodeNext public types, and execute browser/workerd bundles
   without host filesystem, process or network access.
4. Run selected workspace builds, command unit/lint/type checks, retained du
   integration tests, boundary tests and package-lint gates. Pack and install
   only public shipping packages in an isolated consumer; verify the private
   workspace cannot resolve there. Preserve existing behavior and tests.
5. Commit, rebase onto current remote main as needed, push and verify ancestry.
   Publication remains GitHub-owned; release completion is separate from delivery.

## Validation

The boundary test failed before adding owned tests and the build prerequisite.
The moved direct suite passed 26 tests; retained Shell/backend suites passed
131 tests without skips. Source and test NodeNext checks passed. Temporary
packaging outputs and verification logs belong under `out/du-1017` and are
removed after verification. No output/help behavior changes require CLI visual
changes or screenshots.

Final verification also passed all 246 package-safe tests, 35 command-boundary
checks and two portable packaging tests. The recursive du integration run had
177 passes and one explicit skip for the unavailable pinned GNU 9.7 binary.
The dependency-aware unit runner passed uncached. Installed public tarballs
passed Node execution, strict NodeNext declarations and browser/workerd VM
execution without host filesystem/process/network capabilities. The private
command package was absent from that installation. No runtime implementation
or default limit changed.

Source-level package-lint checks passed privacy, dependency resolution, public
exports, cross-package imports and asset colocation. The repository-wide asset
packaging check reported five findings in unrelated CLI packages; none involved
du or Safe Bash. Root bundle lint requires the separate root CLI build and was
not counted as passed; the actual packed Safe Bash consumer and both portable
bundle graphs were verified directly instead.
