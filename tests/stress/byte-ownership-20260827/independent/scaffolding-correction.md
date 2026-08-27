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
