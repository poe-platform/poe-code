# Split command workspace

## Ownership

Baseline `3640f2f821` already owns mode parsing, streaming and chunk selection,
suffix generation, output lifecycle and synchronous evaluation in the private
`safe-bash-command-split` workspace. Safe Bash retains public adapters and
registration. Canonical contracts and shared byte/I/O engines remain lower-level
dependencies; no dependency returns to Safe Bash.

## Completion steps

- Move buffer admission, option compatibility and empty-output elision regressions
  to their command owner, preserving assertions. Shell and backend integration
  regressions remain in Safe Bash.
- Verify private admission, canonical build prerequisites and public adapters.
- Exercise public factories, registration/replacement, VFS scripts/pipes, byte
  values, error identity, cancellation, suffixes and explicit limits through the
  isolated packed consumer and strict NodeNext declarations.
- Run focused build, unit, type/lint and package distribution gates.

## Distribution and compatibility

The command stays `private: true`, bundled into the existing Safe Bash artifact.
Consumers use `@poe-platform/safe-bash/commands/split`; no standalone publication,
external runtime dependency, new default registration or behavior change is
part of this extraction. Preserve unlimited default limits, finite stream reads,
all suffix radices/widths, empty-file elision and awaited output cleanup. No help
or rendered CLI output changes are planned.

## Verification

The ownership characterization failed before the three regression suites and
unit prerequisite declaration were added. All 28 command tests then passed with
fresh prerequisite builds; all 63 retained Shell/backend cases passed. The moved
suites differ only in imports, with every assertion preserved. All 33 package
boundary cases and the split-specific memfs packaging cases passed.

Workspace lint/typechecks, the parent and root builds, and all seven package
privacy/export/bundle/asset gates passed. The packed public libraries passed the
split runtime fixture and strict NodeNext declarations in an external consumer
without private workspace packages. Browser and workerd bundles passed the same
runtime fixture in realms without host process/filesystem/network access; the
workerd harness admitted only packaged WASM assets, following the existing
publication harness. No independent command publication is introduced.
