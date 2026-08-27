# Independent bounded native-data config review: frozen criteria

Frozen before author implementation, results, helpers or producer inspection on
2026-08-27. This leaf owns only this new review directory and its assigned `/tmp`
coordination files. No delegation; source/config/author helpers/producer data and
other fixtures are read-only. No full default suite, current-release corpus,
dependency installation, root build emission or unrelated fixes.

## Immutable identity

- Candidate: `78e80717b9791a4bc5f49005b962b1da9232335d`.
- Candidate tree: `50e1de0655fb89515ef6ff82fe4060d4d1d2f7f4`.
- Parent: `f6406cdc1d946bbe829535d888d6e8a09a7c8d9e`.
- Parent package blob: `3c5fc677b77b569131529ce4471828f689576bff`.
- Parent root config blob: `d88bb739f6c298272a80da3796a7e901e409062e`.
- Parent/candidate build config blob: `89e6b5617b949858c6e90953b561b38089c78dd7`.
- Candidate package blob: `993420b9ea50f62650e8a5b8a4cbc1bbb36dd282`.
- Candidate root config blob: `cc967cb47dedff9e0f5cb516cf42bb504bc135c0`.
- Initially observed live HEAD: `b22d00c2834358dc3083de58774f3aa188093f9b`;
  never substitute moving HEAD for the candidate.

## Exact exclusion and raw pins

The only permitted new exclusion is
`tests/commands/regex-execution/continuation/artifacts/native`, both for automatic
root TypeScript discovery and actual default test discovery. No broad artifact,
test, compiler-option, source, producer, runtime, error-waiver or fixture change.
The exclusion must contain no genuine source/test/helper, demonstrated using
producer provenance rather than extension alone. Independently classify/hash the
claimed 72 files (22 raw payloads, 50 tsx JSON caches), retaining a complete census.

Six relative paths: `dialect-bFUsLx/alpha.ts`, `dialect-bFUsLx/beta.ts`,
`dialect-uhGVu3/ab.ts`, `dialect-uhGVu3/🙂.ts`, `dialect-xj7h8F/a.ts`,
`dialect-xj7h8F/d.ts`. Each is exactly `hit\n`, four bytes, SHA-256
`74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8`.
Before exclusion each must report TS2304 at (1,1), Cannot find name 'hit'.
These ignored files are absent from git archives: authenticate and copy the actual
entire data subtree into an owned isolated candidate before compiler controls.
Never create canaries or alter bytes in the original namespace. Compare all
original and copied raw hashes before/after.

## Independent control intentions

1. Inspect the exact parent-to-candidate diff: only the exact tsconfig entry,
   actual package script filtering, narrow documentation and author-owned tests.
   Check every compiler option and build config unchanged.
2. Use the candidate source plus copied actual data for before/after compiler
   programs; retain diagnostic identities, complete file lists and classification
   counts. Maintain all genuine source/test/helper eligibility, distinguish
   program files, test-tree files, discovered tests, tracked tests and libraries.
3. Freeze a small independent fixture set before execution. An undefined symbol
   outside the exact exclusion must produce its own exact TS2304, not merely a
   nonzero exit. Neighbor artifacts/native-sibling source and canonical helper
   inputs must remain included. An explicit-import control may additionally
   demonstrate that exclude is discovery-only, not diagnostic suppression.
4. Execute the actual package test script in a separate owned fixture tree.
   Direct and nested arbitrary `.test.ts` data canaries must not execute/select;
   canonical tests, imported helpers, neighboring artifacts and native-sibling
   paths must execute. Include whitespace/Unicode path boundaries. The original
   parent script must fail on the excluded canaries as a mutation negative.
   Test empty selection against bare-glob fallback and prefix over-exclusion.
5. Run scoped actual source/build config noEmit without root output. A separate
   read-only live global compiler run may report foreign errors; capture exact
   HEAD/config/source/input hashes and drift. Global failure remains FAILED,
   never a scoped pass relabeled whole-global success.
6. Record genuine bugs before any correction and route minimal reproductions to
   root without modifying product/author code. Preserve failed harness attempts
   and fixture freezes. Commit only owned durable review evidence atomically.

## Non-claims and retained boundaries

Do not reinterpret Dirac `aac345a0` 470/470 + 485/485 history, standalone `.mts`
11/30 omissions, current-release 22 maintained tests/13 groups, public
`65b7ae`/`66b079a` scoped passes, or `02`/`c652d99` WebDAV 12/13 release failure.
Runtime 1b/Sagan build success is not lifecycle acceptance. Five cleanup cases
await Arch and remain open. Foreign eight TS2307/TS7006 are not authorized for
exclusion or waiver. No all-TypeScript, full-package, whole-product, superiority,
72-hour completion or broader lifecycle closure claim.
