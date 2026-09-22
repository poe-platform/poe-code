# diff3 command integration review

## Scope and acceptance steps

Review the existing private command candidate against the archived package
pattern, preserving the pending move of that document and unrelated edits.
Inspect the real command definition, shared CLI/SDK execution, optional plugin,
safe-bash facade/export/private build profile and installed declaration closure.
Reproduce concrete safety findings with memory-only regression tests before
changing code. Run affected package tests, lint and maintained workspace build;
stage public artifacts and exercise the external installed runtime and types.
Inspect actual Shell output through an ad hoc screenshot. Preserve metadata
qualification guards and report any remaining delivery blocker.

## Review receipt, 2026-09-19

The working tree already contained the diff3 command/SDK/plugin implementation,
opt-in facade, paired export and qualified private workspace build profile.
Command logic stays in `packages/safe-bash-command-diff3`, whose manifest is
private, ESM and has no runtime dependencies. No default registration change
or standalone publication was made by this review.

Two findings were independently reproduced with failing tests and fixed:

- Engine chunk admission trusted a producer's shadowed `length`, undercharging
  a four-byte allocation as one byte. Admission now uses the existing intrinsic
  byte view before measuring or copying storage. Failure disposes retained state.
- The SDK reconstructed options using truthiness, dropping invalid empty selector
  and information values. It now passes options to the shared synchronous
  validator, which snapshots metadata and rejects those values before VFS I/O.
  This also removes duplicated option/default reconstruction.

Final affected package verification: 322 memory-only tests passed, package lint
and source/test typechecks passed. The maintained
`npm run build:workspaces -- --workspace=safe-bash-command-diff3` completed its
declared prerequisite closure. Build/publication boundary tests passed all 164
cases across `bundle-safe-bash-private`, `safe-command-publication` and
`package-safe`. `git diff --check` passed.

After the final build completed, `package-safe.mjs` staged version
`0.0.0-diff3-verified`. Only the three public safe package tarballs were packed
and offline-installed with lifecycles disabled in an external temporary
consumer. The permission-confined `safe-packages-diff3.mjs` fixture passed,
including CLI/SDK parity, canonical identity, optional registration/collision/
replacement, VFS aliases/scripts/pipes/redirection, directory rejection and
external-program rejection. The strict NodeNext diff3 declaration consumer
passed with exact optional properties and unchecked indexed access enabled,
without skipLibCheck. Both review regressions also passed against installed
code. No unpublished command package was installed.

An installed Shell report/merge/ed screenshot was generated with the maintained
screenshot tool and visually inspected: output was legible and statuses were
0/1/0 as expected. No screenshot test was added.

## Unresolved completion gate

The existing `packages/safe-bash/tests/integration/s3-http-exports/exports.test.ts`
was rerun directly. Its imported controls and main test completed with 223
passes and one failure, no skips. The failure is
`private checkout refuses qualification through retired public exports`:
pending package metadata differs from the selected committed HEAD, so the peer
binding guard rejects it before the expected public-runtime identity refusal.
This reproduces the blocker recorded in the behavior QA receipt. Do not weaken
the guard or commit unrelated manifest/lockfile edits to manufacture a pass.
Qualification needs a matching committed candidate; completion remains blocked
until that gate passes. This review does not claim a fresh root build, full
workspace test/lint pass, universal GNU alignment parity or browser/workerd
qualification. The advertised command profile remains Node ESM with the
documented GNU 3.12 alignment limits and safety deviations.

`/out` is read-only on this host. Task-owned staging and screenshots used ignored
workspace `out/command-diff3-review`; the installed consumer used an external
temporary directory. These artifacts were purged after this receipt.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or private package publication was requested or performed.
