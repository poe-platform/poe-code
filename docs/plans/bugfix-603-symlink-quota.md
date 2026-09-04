# Issue #603: quota accounting through symlinks

## Validated defect

At `a18a8313f`, a quota-wrapped memory filesystem accessed through the supported
Node bridge admits a 128-byte write through a 100-byte symlink under a 128-byte
quota. The resulting namespace retains 228 logical bytes. The delta subtracts
the symlink's size even though the write changes its referent.

This is the concrete follow-up to #579, not a new automatic shell write policy.

## Scope

- Account data mutations against the file they actually affect, following links.
- Charge newly created link entries without subtracting an existing referent.
- Preserve cumulative streaming admission and partial-write behavior.
- Use small in-memory regressions for dangling and existing symlink targets,
  overwrite, append, copy, truncate, streaming, and link-entry creation.
- Do not claim physical-memory accounting, concurrent external-mutation isolation,
  or a general hard-link alias accounting redesign.

## Delivery

Run the regressions red before implementation, then focused safe-fs tests,
the selected workspace build, and maintained lint. Commit only this issue's
files, push main, close after verified delivery, and monitor releases separately.

## Results

- Before implementation, five of the eleven quota tests failed with missing
  expected rejections. All eleven passed after the two-line accounting fix.
- All 986 SafeFS tests passed, and the selected `@poe-code/safe-fs` workspace
  build passed. Both were repeated successfully after fast-forwarding the
  unrelated upstream release-tooling commit `4056af26b`.
- Guarded root ESLint completed before that fast-forward against the same owned
  source/test bytes: 9,617 configured files, zero errors/warnings, 25 receipts.
  The upstream change altered root tooling, not either quota file.
- Independent guest-bridge review confirmed rejection before target creation,
  exact-quota admission, and rejection of the next byte without mutation.
- A separate in-memory check confirmed overwriting through a short symlink
  releases referent capacity and preserves exact-limit append admission.
- `git diff --check` passed. Unrelated staged changes remain untouched.

Ordinary-file hard-link growth is separately reproduced and tracked in #604.
It concerns logical namespace accounting, not duplicated physical storage.
