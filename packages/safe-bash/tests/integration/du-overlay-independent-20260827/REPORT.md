# Independent DU + overlay metadata-read baseline report

## Status

**WAITING FOR AUTHOR CANDIDATE.** No candidate commit hash was supplied, so no
candidate source was inspected or executed and mutable `HEAD` was not substituted.
This is the bounded freeze and authenticated baseline assignment, not acceptance,
a public-DU wiring check, or a whole-project gate.

## Freeze and chronology

The literal/metamorphic contract was written before this verifier inspected or
executed product source and committed separately as
`510c621e1dfa8f7ffba1d796f5f7e55d967368e2` (`test(du): freeze independent
overlay purity holdouts`). The observations were timestamped
`2026-08-27T18:11:22Z`; Git recorded the commit at
`2026-08-27T13:12:07-05:00`. This verifier does not claim the freeze predates
author implementation work.

The contract recorded the known exact history before source inspection:

- source baseline `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`;
- author evidence `f2d6f710d9e0b9481957ff302bba90a0f11c9bad`;
- first-independent evidence `19cc7e8c3567b521e04159010efe32da5673b5b4`;
- observed mutable checkout `7f3ad2f53433e6944260659c8d3904108e5a5a6a`,
  recorded only as chronology, never selected as a candidate.

The pre-freeze foreign index was empty with Git-object fingerprint
`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`. The same fingerprint was recorded
before and after the final baseline capture. Foreign worktree/untracked changes
were neither staged nor modified.

At the final pre-fixture-commit check, a concurrent owner had staged only paths
under `tests/commands/expr-stress/extension-review/after-abort-fix/replay/`.
Their foreign cached-diff fingerprint was
`35ce356416f6deefb0e831cd6bd6a8ad3ee42ef3`; those paths were excluded from this
commit and left staged for their owner. The owner cleared that index state before
this verifier's successful staging retry; the immediately pre-stage fingerprint
then returned to `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391` without intervention here.

## Authenticated baseline

The final evidence is
`evidence/baseline-877144ea-2026-08-27T182141438Z-2e8b-bTCRpv/`, executed from
`2026-08-27T18:21:41.438Z` through `2026-08-27T18:21:48.358Z` on Darwin arm64,
Node v22.22.2, npm 10.9.7, TypeScript 5.9.3, and tsx 4.23.12.

Only the exact committed source and relevant regression fixtures were extracted.
The 249-file selected-input archive SHA-256 is
`eb0f0e229261a9e7763d31ed5e1721ae55056502693b0ec115b350c49d56376a`.
The manifest binds the Git tree, every extracted input hash, executable harness
snapshots, and the following relevant source SHA-256 values:

| Input | SHA-256 |
| --- | --- |
| `src/fs/overlay/index.ts` | `e5ac4a650662656f4256455ecabb965cb6fb6eb7ab8f01315115aa70a3aa3640` |
| `src/commands/du/arguments.ts` | `a777c2575100dbe305dd7376b525727cc213039eda90b659d323841ed05bf041` |
| `src/commands/du/du.ts` | `6954f5f86f69ec9aca39f464198d200b0895b6b286df9a5bd08c44444f9b8ca2` |
| `src/commands/du/index.ts` | `73a4ea414b6a6325fb8c4c507fc8f86e7b6b743cb2b94f13437ef42f4d545cd7` |

The selected input tree was byte-identical after execution. Its post-run check
also detects added files and symlinks under the selected tree; generated `dist`
is the sole explicit exclusion. The archive was checked to contain no
`AGENTS.md`. The seven harness inputs were unchanged during capture and their
exact bytes are preserved under the final evidence's `harness/` directory.

## Baseline outcomes

The holdout process exited 1 as required for the known baseline. Of 24 targeted
cases, 5 purity holdouts and all 7 controls passed; 12 holdouts reproduced the
frozen RED pattern:

- Direct, read-only-wrapper, mount-over-overlay, and overlay-over-mount
  `readdir` and standalone DU traversal each issued exactly one upper `rm`,
  changed the upper snapshot, and removed the pending hidden stage. DU used the
  authenticated standalone module path and performed no content read or copy-up.
- Injected metadata failure/retry removed the pending stage before surfacing the
  `EIO`; retry then succeeded, but the pre-failure snapshot was already changed.
- Deterministic cancellation injected during the actual upper directory read
  rejected with the exact abort reason, but one upper `rm` had already occurred.
- With the same discriminating 2049-byte apparent-size fixture, no-environment
  output was captured as `3\t/holdout\n` and lower `BLOCK_SIZE=1` output as
  `2049\t/holdout\n`. These values are observations, not a frozen numeric-default
  policy. Higher-priority `DU_BLOCK_SIZE=invalid-value` exited 1 with no stdout;
  the empty selected value did the same. Neither equaled the same-run no-env
  default as required.

Direct `stat` and `lstat`, pre-aborted metadata read, and both real active-stage
queue cases (`readdir` and standalone DU) passed: pending state/backing snapshots
remained stable, the exact pre-abort reason was preserved, and the metadata phases
after their active mutations added no mutation. Visible identity and whiteout
observations remained stable in the traversal matrix; pending names were never
exposed. These passes do not mask the `readdir` deletion REDs.

## Controls, regressions, and package proof

All seven executable controls passed:

- explicit `overlay.cleanup()` removed the pending stage and incremented the
  mutation counter;
- an ordinary overlay content mutation changed the backing snapshot;
- an ordinary content read incremented the content-read counter;
- actual readdir-removal, DU-content-read, and DU-copy-up adapter mutants were all
  detected by snapshot/operation oracles;
- invalid explicit `-B invalid-value` remained strict, while valid explicit
  `-B 1` remained functional and took precedence.

The isolated scoped regression run passed 128/128 across the exact baseline DU
behavior/backend tests and overlay allocation/adversarial tests. This includes the
unchanged historical RED detector that expects the baseline cleanup mutation, plus
the existing allocation, explicit-cleanup, backend, whiteout, failure/retry, and
active-stage positive behavior. It does not reinterpret those versioned baseline
expectations as the new purity contract.

The built package tarball SHA-256 is
`05414bf208b93cd303c440e50c1edcd08af8a6f15dbef7f749ce22b141b0fa22`.
It was installed into a relocated, distinct-name consumer. Strict NodeNext type
checking passed. Runtime resolution was asserted inside that physical installed
package for both root and DU leaf files, rejecting repository fallback. The
standalone `dist/commands/du/index.js` hash
`b8257103248aa0f4a21cb6dab6d916661a5fb04423e414475e68370807cdc5c4`
matched the authenticated build, and `du -bs /moved` returned the expected
17-byte result. This deliberately proves the moved standalone module path, not a
public DU package export or aggregate registration.

## Preserved harness failures

Two earlier captures remain byte-for-byte under `evidence/` and are not product
failures:

1. `baseline-877144ea-2026-08-27T181830687Z-55eb-9ag0q8` omitted the tracked
   WebDAV mock imported by the DU backend regression. The targeted holdouts had
   already reproduced their RED pattern, but scoped regression loading failed.
2. `baseline-877144ea-2026-08-27T181855293Z-81f5-qghdwk` added that mock and ran
   127/128 regressions. The remaining allocation test could not create its native
   scratch directory because the tracked `allocation-evidence/README.md` parent
   was not selected into the archive.

The final recipe versions both exact fixture dependencies rather than skipping
tests or rewriting those raw attempts. A preceding successful development capture
without self-authenticated harness snapshots is also retained as
`baseline-877144ea-2026-08-27T181918852Z-c20f-fhjlGl`. The later
`baseline-877144ea-2026-08-27T182017267Z-cbc5-YXsTka` added immutable harness
snapshots and start/end index fingerprints; final capture `...T182141438Z...`
additionally covers queued standalone DU during a real active stage.

The staged whole-owned-tree whitespace check reports eleven preserved diagnostics:
two trailing spaces in the raw one-line `PROTOCOL-ERROR.txt` messages and nine
blank-line-at-EOF notices across the three live consumer template inputs and their
six immutable captured harness snapshots. Rewriting those bytes would invalidate
the retained raw failures or final harness hashes. Executable `.mjs` syntax and
the final installed strict consumer checks pass.

## Handoff and limits

The authenticated baseline product defects for root/author follow-up are:

1. public overlay `readdir` uses the cleanup-enabled invocation path, so metadata
   traversal deletes pending upper garbage through wrappers and mounts, including
   on later failure/cancellation;
2. invalid or empty selected `DU_BLOCK_SIZE` is diagnosed rather than falling
   back to the same-run no-environment default, and must not fall through to the
   lower-priority `BLOCK_SIZE` value.

Repeated-operand policy is intentionally untested and undecided. Public DU
export/registry wiring is intentionally absent and was not treated as a failure in
this assignment. There is no deployed-provider, GNU/Linux, whole-repository,
performance, superiority, or completion claim. No subagents/workers were created;
all spawned child processes settled, `childrenAtFinish` is empty, and each
authenticated capture scratch root was removed.

Reproduce the bounded baseline capture with:

```sh
node tests/integration/du-overlay-independent-20260827/capture.mjs \
  877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3
```

The runner refuses mutable revision names and writes a new unique evidence
directory. Final candidate verification remains blocked until the coordinating
root supplies an exact author candidate commit hash.
