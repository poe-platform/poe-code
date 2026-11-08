# Migration audit protocol correction v2

Date: August 27, 2026. Role: delegated independent leaf verifier, not root and
not the candidate or migration author. This is a bounded rerun of only the four
canonical DU expectation migrations. It is not a whole-gate result, product
repair, installed-package claim, or superiority claim.

## Result

The guarded rerun reproduces the earlier technical classification without
rehabilitating the unsafe earlier protocol:

| Snapshot | Exact revision | Selected result | Selected archive SHA-256 | Before/after manifest SHA-256 |
| --- | --- | ---: | --- | --- |
| baseline product and old expectations | `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3` | 4 pass, 0 fail | `1a8981cb26c52fa56f8a9b0c1ed197fe08fb568e5ab9fa70796f96ef84617f54` | `3a2ffcc7c90130c297c6505a2c264b284ead88e2920df09de9f23fbb1786a786` |
| fixed product and old expectations | `31f5678e62e3f3d43b4825d839ec970e7768da7d` | 0 pass, 4 fail | `10526ed45eec412ec5871e3ee54a12494a51aeaafeb07ad904c52c78595dfd38` | `792dc2503a2ef2ee8cb68bed68acb929b5361ba3e1ba751faab065d8fa15097c` |
| fixed product and migrated expectations | `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d` | 4 pass, 0 fail | `79e98be2b895d23d2fc96753c0468e0bc62688347e6d4009e6137a972bfe61b1` | `f8a9938c0d7a344527a223e01cc1dfcd46b7ed04f0ab9cbbb49e3b77e7f340b5` |

The four selected migrations are the behavior aggregate for the two selected
environment cases plus O062, O086, and O087. The exact behavior and native test
name selectors and commands are recorded per snapshot. The parent's four real
assertion failures are retained verbatim in
`evidence/run-2026-08-27T190004580Z-fe09c9a6/parent/behavior.stdout.txt` and
`parent/native.stdout.txt`; they are expected evidence, not reclassified passes.

## Confirmed earlier incident

The prior migration-audit commit
`2dd6d631f1862487b0874e03f07301769c3a4271` created full archives and extracted
all three revisions before running them. Its `audit.mjs` lines 82-90 perform the
full archive and extraction, lines 131-135 invoke that function for baseline,
parent, and candidate, and lines 229-230 remove scratch. That source is Git blob
`b2a371621e634f38892819332446b0c5c99eb30b`, 13,227 bytes, SHA-256
`51176a14154a6da707828f58bc1a7fb4b46e2f2ade91bfb4e8469d92bf90ade6`.
Its `RESULTS.json` is blob `88eff43632da42d63a4e5c8f145c59d8fcbc060b`,
SHA-256 `b6ada9d27f713cecf7bbd5f292c4cb67e343f50a58e95370d1800d3cf79f8915`;
line 499 records scratch cleanup. The exact random scratch suffix was not
recorded.

Each archived tree contained these five prohibited paths:

- repository-root `AGENTS.md`;
- `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/AGENTS.md`;
- `tests/stress/regex-execution/production-review/snapshots/baseline/AGENTS.md`;
- `tests/stress/regex-execution/production-review/snapshots/production-final/AGENTS.md`;
- `tests/stress/regex-execution/production-review/snapshots/production-first/AGENTS.md`.

Therefore the old run created 15 prohibited temporary copies: five in each of
the fully extracted baseline, parent, and candidate trees. Those copies were
removed by the old finally cleanup; the real repository files were not modified.
Root already disclosed the violation to the user. This v2 rerun does not undo,
hide, minimize, or retroactively cure it. The old `audit.mjs` remains unchanged
as incident evidence and its use is prohibited; `audit-v2.mjs` is the replacement.

The distinct candidate capture at
`66975ea8ffeedd7c1df510bac2b13e1767bef610` was clean: its authenticated report
records a 249-file selected archive, manifest SHA-256
`733f314e4f187d90971e08e59e4d49f8a772752d01fd090948a6a1de31ba97be`,
archive SHA-256
`b6c8055a335f5a3e316501267d5ed4590a765cf380cc44eec9d0e84774321381`,
and no prohibited copy. It is not part of the 15-copy incident.

## V2 admission and preservation protocol

The replacement selects only `package*.json`, the two tsconfig files, `src/**`,
the two named canonical tests, `helpers.ts`, and `native-profile.json`. Git
metadata expands that to an identical 245 regular-file path set at all three
revisions. Before any capture write, archive creation, or extraction:

1. the executable synthetic negative control feeds a prohibited basename into
   the same inventory admission function and is rejected with all three counters
   still zero;
2. every actual Git entry is checked for a relative contained path, allowed
   regular-file mode/type, uniqueness, and prohibited basename;
3. only the resulting explicit 245-path list is passed to `git archive`.

After each archive is written, the harness parses and checksum-validates every
tar header, rejects unsafe/unexpected paths and link/special types, compares the
245 regular entries to the admitted list, and only then invokes extraction. Each
archive has 289 headers including expected directory/global metadata. The full
selected path list, archive inventories, prewrite log, and per-file
mode/Git-blob/content hashes before and after execution are retained under
`evidence/run-2026-08-27T190004580Z-fe09c9a6/`. All three before/after manifests
are byte-identical. No selected input changed, no unexpected extracted file was
present, no link or special entry was admitted, and zero prohibited copies were
created.

The five real repository instruction files were hashed before and after the v2
capture and are unchanged. The run used Node v22.22.2 with absolute installed
tsx loader tooling rather than a scratch symlink. `RESULTS.json` records the
Node executable, loader, package metadata, package-lock, Git, and tar identities
and hashes, as well as exact commands and raw output hashes.

## Native provenance and still-open policy question

This correction did not duplicate the native audit. It reuses the immutable
Darwin GNU coreutils 9.7 evidence authenticated in the old results and combined
author evidence
`c5fe1a68341b3a2ebbefd9fee6793a1e6c5df10b`: O062/O086/O087 and both scoped
lower-priority probes were corroborated there. The read-only oracle binary
before/after SHA-256 was
`f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b` and
`du.c` SHA-256 was
`3cd1c0120881ba28da3345b1324e9d146f948a95db6ce2900ba27b3fe8f45bf9`.
This remains a Darwin GNU 9.7 observation, not GNU/Linux or universal parity.

The policy question remains open. Commit
`32c5b60c3323101ebd3d4a3339931caa93867ae5` applies fallback to invalid or empty
selected `BLOCK_SIZE` and `BLOCKSIZE` too. Native behavior is corroborated, but
root authorization explicitly names invalid selected `DU_BLOCK_SIZE` and is
ambiguous for empty selected values and the lower-priority variables. This audit
does not infer authorization and makes no product change.

Three native ordering differences remain retained, O060 remains unimplemented,
and root wiring remains unchanged. The already-run 33/33 primary package suites
and 789-file cohorts were not duplicated or promoted into this bounded result.

## Closure

All child processes were awaited and none remained. The authenticated exact
scratch directory was traversed without following symlinks and removed with
individual unlink/rmdir operations; no broad shell removal was used. The run
reports `scratchRemoved: true`. No failed attempt occurred. Foreign staging
fingerprints are recorded in `INDEX_FINGERPRINTS.json` and only owned v2 paths
are staged and committed.
