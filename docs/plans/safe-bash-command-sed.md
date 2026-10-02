# Private sed command extraction

## Ownership

Revalidated remote main `97884e8b22`: extraction commit `9ec52b1650` already
placed parsing, addressing, branching, substitution and transactional in-place
editing in private `safe-bash-command-sed`. `safe-bash-regex-engine` owns shared
regex algorithms; `safe-bash-io-engine` owns shared input handling. Canonical
contracts remain in `safe-bash-contracts`. None depends back on Safe Bash.

Safe Bash retains the text-program compatibility facades, default sed/awk
composition, and public `@poe-platform/safe-bash/commands/sed` export. Existing
private admission, wildcard root workspace discovery, lockfile and Turbo unit
prerequisites already cover the package. No new registration, runtime dependency,
release job or standalone publication is required.

## Completion work

- Move direct BRE/address/branch/replacement regressions into the sed workspace,
  retaining every assertion and C locale. Keep Shell integration regressions in
  Safe Bash so the command has no reverse dependency.
- Extend maintained memfs packaging and isolated consumer fixtures for public
  sed exports, strict NodeNext declarations, VFS script pipelines, byte argv,
  error/runtime identity, collision/replacement, cancellation, limits and -i backups.
- Exercise Node and portable browser/workerd consumers without private packages.
- Run the maintained selected workspace builds, command lint/type/unit checks,
  focused Shell regressions, packaging tests and relevant package-lint rules.

## Distribution and behavior

All supporting command/engine workspaces stay private and are bundled into the
existing parent. Examples use only public imports. Latest UTF-8 matching,
replacement case conversion, null-data, output retention and in-place ancestry
fixes remain intact. This work changes no CLI output/help and needs no screenshot.

## Delivery

Record verified checks and remote-main commit in the completion report. Release
publication is separate; the requested delivery does not wait for publication.

## Verified completion

The dedicated sed workspace passes 87 unit tests and lint/source/test typechecks.
The retained Shell/text-program suites pass 1,392 tests. All 224 maintained
packaging tests pass, including the new memfs sed boundary and declaration
consumer. The boundary test first failed with sed absent from the fixture graph.
Seven package-lint privacy/dependency/export/asset gates report no violations in
the maintained 207-workspace Safe Bash build closure; unrelated root asset
findings are outside this change. The root-only bundle gate was not counted as
passed without its root build.

The maintained Safe Bash and optional Cloudflare build closures completed.
Public tarballs were installed outside the repository without private workspace
packages. Actual legacy/default composition, VFS scripts, strict NodeNext types,
and browser/workerd condition bundles passed. Portable bundles executed in
isolated realms without global Buffer or host filesystem/process/network access;
remaining imports were limited to shipped WASM assets. Runtime/error/argv/value
identity, binary null records, in-place backups, replacement/collision policy,
finite budgets, pre-abort and active cancellation cleanup were exercised.
Sed's existing decoded program-argument policy remains unchanged. No runtime
implementation, default inventory or publication scope changed in this completion.
