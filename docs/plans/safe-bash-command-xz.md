# XZ command workspace

## Ownership and compatibility

Keep XZ command behavior in private `safe-bash-command-xz`: the XZ/LZMA
profiles, factories, plugin, option parsing and index listings. Keep reusable
codec, streaming and file publication logic in private
`safe-bash-compression-engine`, importing canonical `safe-bash-contracts`.
Safe Bash retains compatibility facades and composes the existing inventory.

Preserve `xz`, `unxz`, `xzcat`, `lzma`, `unlzma` and `lzcat`, format and check
options, explicit memory and decoded-byte limits, and existing default limits.
Preserve current behavior fixes independently of the ownership refactor.

## Distribution

Admit both private workspaces and their assets through the existing declarative
build and packaging graph. Bundle them into the existing public distribution;
add no standalone publication, external runtime dependency or consumer-facing
private import. Examples use `@poe-platform/safe-bash/commands/xz`.

## Verification

- Maintain package-boundary characterization and the moved command regressions.
- Build the declared workspace dependency closure and run focused command and
  compression unit, type, lint, package-lint and packaging checks.
- Run the maintained XZ consumer fixtures against isolated packed artifacts,
  including strict NodeNext declarations without private workspace installs.
- Exercise Shell pipes and VFS scripts, registration/replacement, byte argv,
  canonical errors, cancellation, checks, formats, assets and explicit limits.
- Preserve platform conditions and run the consumer with browser/workerd
  conditions. Inspect screenshots if CLI output or help changes.
- Verify committed delivery on remote main separately from release publication.
  Keep temporary evidence under `out` and remove it after verification.
