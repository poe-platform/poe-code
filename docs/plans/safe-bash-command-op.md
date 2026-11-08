# Op command workspace

## Ownership and compatibility

Remote baseline `def4c5038b` already contains the migration from `packages/op`
to the private `safe-bash-command-op` workspace. It owns the dispatcher, object
backend, approvals, environment invocation, VFS adapter and 62 unit suites.
The only current SDK consumers are Safe Bash composition and its command facade;
the snapshot codec retains its existing format marker for stored-data compatibility.
Canonical runtime contracts and filesystem identities come from the lower-level
workspaces. No dependency returns to Safe Bash.

The current `docs/op.md` delivery contract supersedes the old standalone Node
host: use injected VFS, backend and child-command capabilities through public
`@poe-platform/safe-bash/commands/op`. The root package removed its former op
subpath in `8b29278d77`; current examples use the established Safe Bash export.
Preserve this portable design, existing inventories, explicit registration,
replacement policy, authorization and confirmation stages, environment isolation,
unlimited defaults and configured finite limits. No new command or runtime
capability is introduced.

## Completion steps

- Characterize private ownership and unit prerequisite builds before changing
  the maintained build graph. Preserve every existing command regression.
- Add maintained packed runtime and strict NodeNext consumers exercising public
  factories, canonical identities, registration/replacement, VFS scripts/pipes,
  resolved approval, denied backend access, environment invocation, limits and
  cancellation. Run them without private workspace packages or source resolution.
- Verify focused workspace builds, units, lint/types and package admission gates.
- Keep all code bundled in the existing parent artifacts; no private command or
  supporting engine is independently published. Preserve the stored snapshot
  identity and historical evidence.

No user-visible output or help changes are planned.

## Verification

The unit-prerequisite characterization failed before the graph declaration and
passed afterward. All 832 existing op unit cases, 12 retained Shell integration
cases, 89 ownership/workspace graph cases, 252 memfs package cases and 128 selected
guarded-build admission cases passed. Command lint and source/test types passed.
The maintained selected-workspace builds and normal parent build passed.

An external consumer installed the packed public Safe FS, Safe JS and Safe Bash
artifacts and could not resolve private op/contracts/filesystem workspace names.
The op runtime fixture and strict NodeNext declarations passed, as did its
browser-condition bundle and an actual workerd request with bundled assets.
The generic VM harness's host structuredClone returns objects from another realm;
it is not used as evidence for this backend. Runtime and type fixtures are wired
into the maintained public smoke, browser and declaration checks.

All seven selected package privacy, dependency, export, bundle and asset rules
passed across 296 packages with zero violations and zero skips. No output/help
behavior changed, so no CLI screenshot was needed. No standalone private package
publication or release completion is claimed.
