# unrtf CLI, SDK and artifact wiring qualification

The existing command remains owned by `packages/safe-bash-command-unrtf`,
named `safe-bash-command-unrtf`, private and ESM, with no runtime dependencies.
Safe-bash composes it through `commands/unrtf/index.ts`. Its qualified private
workspace profile admits bundling and declaration rewriting through the
maintained artifact assembler. No default registration or publication changed.
The shared contract owner is `safe-bash-contracts`; command definitions preserve
its runtime identity. The package-pattern document is currently located at
`docs/plans/archive/safe-bash-command-package-pattern.md`.

## Executed checks

- Added failing memory-VFS tests for an option terminator followed by a literal
  option-shaped operand, cleanup registration before output acquisition, and
  rejecting NUL paths before VFS access. Implemented fixes and reran all 60
  command workspace unit tests successfully.
- Workspace lint and source/test TypeScript checks pass. Output backpressure
  is awaited; external cleanup cancels a pending pull and requests source return.
- Ran the maintained selected safe-bash workspace build closure successfully.
- Assembled safe libraries with `scripts/package-safe.mjs`, packed safe-bash
  and safe-fs, and installed those tarballs into a separate consumer directory.
  No command workspace was installed there. Executed the unrtf runtime fixture
  and strict NodeNext TypeScript fixture successfully. The runtime fixture
  verifies default absence, opt-in registration, canonical contract identity,
  file extension retry, CLI/SDK equality, literal paths and profile refusal.
- Captured and inspected the installed-consumer verification transcript through
  the screenshot tool. Temporary artifacts are removed after qualification.

## Explicit compatibility boundary

`standards-strict` text/HTML remains the admitted profile. `UnrtfResult` exposes
its typed status. The public SDK signature no longer exposes the implementation's
CLI parsing switch. `--` now terminates options; this deliberately differs from
GNU 0.21.10. Dash is still a literal filename. To open a file named `--`, pass
`-- --`. Unknown switches fail explicitly before input access; no ambient
configuration or environment search occurs.

This wiring qualification is not full GNU compatibility admission. GNU output
personalities/configuration merging, native legacy Unicode and low-byte output,
the full codec/charmap inventory, additional rendering profiles, nested/merged
tables and VFS picture exports remain unimplemented. Existing strict parsing and
encoding failures use status 1, as documented in the command README; they do not
imitate upstream silent recovery, binary suffix loss or decoder prefix loss.
Pictures and objects remain inert skipped content rather than exported files.
The source archive identity is provenance, not proof of native output parity.
No commit, push or release was requested or performed.
