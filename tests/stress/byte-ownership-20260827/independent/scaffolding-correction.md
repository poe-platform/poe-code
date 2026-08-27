# Preserved scaffold correction before author source edits

Original frozen commit: `8410a0c`. First raw evidence commit: `9d7e5e0`.
The original `freeze.json`, literal byte vectors and first transcripts remain
unchanged. The first internal attempt discovered 10 tests: 6 passed, 2 genuine
byte-corruption failures, and 2 erroneous exact-message fixture assertions.
The public attempt failed module setup, so **zero public product tests ran**;
the TAP file-level failure is not a 0/20 product result.

Two narrow scaffolding corrections are frozen before replay:

- Give the moved consumer its own differently named package scope. Without it,
  Node self-reference resolved `virtual-bash` to the repository's package, not
  the moved package. The existing exact resolved-path assertion caught this.
  No assertion was removed and no product manifest/export was changed.
- Match `FsError`'s actual documented constructor formatting, including the
  `EFBIG: ` prefix, in both limit controls. The exact code and complete message
  remain checked; the expected bytes and statuses are unchanged.

`freeze-scaffold-v2.json` binds the corrected scaffolding and unchanged vector
file. Use phase `prepatch-v2` for the baseline; never overwrite `prepatch` evidence.
The new baseline must still fail genuine ownership tests on unfixed source.

## Third freeze: error-path contract correction

The complete moved-package v2 replay is preserved in commit `ff11513`:
internal 8/10, public 14/20. Five public failures are ownership corruption;
the sixth is a mistaken expectation that a command-handled sink error rejects
the outer exec promise. Source inspection at `src/commands/streams.ts` shows
the per-file catch emits a diagnostic and returns status 1. Inspection of
`src/shell/shell.ts` shows capture precedes the awaited external sink write.

The corrected sink control therefore asserts the full diagnostic, status 1,
and the exact first attempted output bytes retained by the shell capture.
No existing literal byte expectation changes; this adds an exact error-path
byte assertion rather than waiving a diagnostic. The Buffer schedule and all
other 29 cases are unchanged. `freeze-scaffold-v3.json` binds the final
pre-author scaffolding. The v2 manifest and raw failures remain untouched.
