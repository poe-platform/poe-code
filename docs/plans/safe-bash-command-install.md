# Install command workspace

## Ownership and compatibility

Revalidated remote main `4dcc3e189f`: extraction was already delivered by
`b9634cd075` and integration corrections by `f8ddf79ce7`. The private
`safe-bash-command-install` workspace owns argument parsing, mode and identity
resolution, backups, file operations, sync evaluation, and explicit host hooks.
Safe Bash retains the static adapter, public `/install` and `/commands/install`
exports, existing inventories, and registration/replacement policy.

The dependency graph is safe-fs → contracts / IO engine → install → Safe Bash.
Canonical arguments, byte values and errors come from those existing owners.
The private optionalModules admission bundles code and declarations into the
existing parent artifact. No new publication, external dependency, runtime
capability, or default limit is introduced.

## Extraction follow-through

- Move unchanged argument and direct file-behavior assertions to the command
  workspace. Keep registry, actual Shell, output-budget, cancellation, and native
  oracle integration suites at the Safe Bash composition boundary.
- Declare the command unit task's prerequisite builds and protect ownership with
  a failing boundary regression before moving tests.
- Document public imports, supported capabilities and explicit/default limits.
- Extend the maintained packed consumer for install scripts, pipelines and
  byte-valued argument diagnostics, retaining existing identity, registration,
  host-hook, cancellation and output-budget checks.

## Verification

Run the maintained selected install and Safe Bash build closures; install unit,
lint and strict source/test typechecks; the retained install integration suites;
command-boundary and package-safe tests; applicable package-lint gates. Package
Safe Bash through the existing generic packager, install tarballs into isolated
consumers, and run optional runtime plus strict NodeNext declaration fixtures.
Verify advertised portable exports using the existing profile checks. Preserve
all prior test assertions and report unavailable native oracle cases as skipped.
No CLI output or help text changes are planned.
