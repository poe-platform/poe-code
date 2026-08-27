# Independent DU + Overlay candidate verification

Date: 2026-08-27

## Decision

**BOUNDED CANDIDATE ACCEPTANCE for the delegated DU/Overlay scope.** Exact
candidate `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d` closes the 12 original REDs,
keeps all unaffected cases and controls green, and passes the corrected
execution of every refined-v2 target exercised here. No candidate product bug
was found in this bounded verification.

This is not authorization/migration acceptance, a whole gate, native parity,
superiority evidence, or project completion. The separate authorization and
migration-report verifier remains authoritative for that pending decision.

## Immutable inputs and chronology

- Initial freeze: `510c621e1dfa8f7ffba1d796f5f7e55d967368e2`.
- Refined freeze: `8c28d7c848311372cbef5ec3e4facff546baf0a8`.
- Baseline evidence: `82e97559330cff52f63f22c7d5fd80185fe65f44`.
- Baseline source: `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`.
- Handoff: `87833f33cb7fa6d2a6c098201dd53fe5404a7fcb`.
- Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`.
- Combined author evidence reference: `c5fe1a68341b3a2ebbefd9fee6793a1e6c5df10b`.

Commits `1c793b934dcd06aa42e0df24a7228b395178cf3d`,
`0d6b9fcf57866fa38e6c065365b11e0fb8e5707b`, and
`32c5b60c3323101ebd3d4a3339931caa93867ae5` are ancestors of the exact
candidate. This verifier did not duplicate the separate authorization or
canonical-migration report audit.

The final authenticated capture is
`evidence/candidate-9a5a6f92-2026-08-27T184742640Z-4378-47r2eR/`. Its manifest
SHA-256 is
`733f314e4f187d90971e08e59e4d49f8a772752d01fd090948a6a1de31ba97be`.
The 249-file selected committed archive is append-checked, remained immutable,
and has SHA-256
`b6c8055a335f5a3e316501267d5ed4590a765cf380cc44eec9d0e84774321381`.
It contains no `AGENTS.md`.

Relevant exact source SHA-256 values are:

| Path | SHA-256 |
| --- | --- |
| `src/fs/overlay/index.ts` | `829352e34a662868ddac3385317bf2f7eea8f605ea55e995865a6dd95ddc0d17` |
| `src/commands/du/arguments.ts` | `1c25d25f2c1464b2b47e9a574d8c786c032d2c5f80b231d15e444a7020a3c409` |
| `src/commands/du/du.ts` | `89a7e96bd08f72fd91a140841cf4dd362ba7e741374ec31e476b2db480cbaf03` |
| `src/commands/du/index.ts` | `73a4ea414b6a6325fb8c4c507fc8f86e7b6b743cb2b94f13437ef42f4d545cd7` |

## Original RED closure and refined execution

The unchanged original harness passes 24/24 from source and again from the
moved installed package: 17 holdouts and seven controls. Its exact baseline
partition was 12 REDs, five unaffected purity passes, and seven controls. The
ten upper-cleanup REDs and two selected-`DU_BLOCK_SIZE` REDs are all closed;
the unaffected and control cohorts remain green. The complete mapping is in
`CASE_MAP.md`.

The final refined run passes 33/33 from source and again from the moved package:
26 holdouts, four positive controls, and three executable behavior mutants.
These are overlapping targeted checks, not counts to add to author-reported
191/30/416/6 cohorts. They cover the exact literal bytes and paths, both mount
directions, direct and read-only views, pending whiteout/stage state, deterministic
listing order, actual backing identity/comparison stability, exact child `EIO`
and retry, exact pre/mid caller reasons, the paused stage-`mkdir` barrier, all six
1500-byte environment rows, explicit and lifecycle cleanup, normal mutation,
and read/removal/copy-up mutants.

Action-window evidence reports zero content reads, zero copy-ups, and zero
mutation methods for metadata/DU holdouts. Pending bytes remain present and
hidden. The active-stage reads admit no backing call before release and match a
mutation-completed-first control. The actual Shell cancellation lifecycle
preserves the identical caller reason and executes the DU registered cleanup
once. A separate consumer-registered `overlay.cleanup()` control is executed by
Shell settlement and removes the exact pending root; this is not claimed as
default DU behavior.

Overlay-above-mount is correctly read-only/non-atomic. RV3-016 through RV3-019
verify metadata purity and ordering at `/mnt/holdout`; pending staging for that
composition remains unsupported and receives no credit.

## Frozen-fixture correction and retained failure

The exact first refined execution is preserved under
`evidence/refined-v2-frozen-atime-observer-fail/`. It failed 22/32 because the
verifier used public Memory `readdir` and `readFile` to take full-stat snapshots;
those observer operations update `atimeMs`, including around pure direct
`stat`/`lstat`. It also transcribed the successful retry as one output line even
though unsummarized `-b` emits the nested directory first.

`FIXTURE_CORRECTION_V3.md` records the rationale and raw hashes before the
revised run. Version 3 excludes only access time from the structural snapshot,
retains file bytes and every other stat field, and keeps separate strict
action-window call, identity, namespace, whiteout, and deterministic-order
oracles. The frozen documents and raw failure were not rewritten. This is a
verifier correction, not a product repair or silent expectation migration.

## Package, load, type, and regression proof

The authenticated build was actually packed. Tarball SHA-256 is
`17ea61cadba802e971cdefd545a56c889d28540b378142870cabacab12b67159`.
The consumer was installed before being moved to a distinct path. All 789
packed-file hashes match the moved installation. Built/installed standalone DU
SHA-256 is
`b8257103248aa0f4a21cb6dab6d916661a5fb04423e414475e68370807cdc5c4`;
built Overlay JavaScript SHA-256 is
`17244dcf61fe1c33ceb07e9af5d8f87689a76d1895de2594cc0a0be068ea5737`.

Loader `nextLoad` records attest 56 package module loads across original and
refined replays. Every attested source hash matches the physical moved package,
including standalone DU and Overlay. Source and installed-package target
projections are identical for both suites. Public root `createDuCommand`, the
public `virtual-bash/commands/du` subpath, and default aggregate DU registration
are all absent as intended; no command-count inference was made.

Strict NodeNext typechecking passed with `skipLibCheck:false`. A real syntax
error inserted into the copied installed DU declaration made the unchanged
consumer fail with TS1110. Executable wrong-root, missing-installed-DU, and
cleanup-restoration behavior controls all failed unchanged assertions as
required. The behavior mutant reopens the original cleanup path rather than
inverting expected values.

The four relevant scoped regression files pass 128/128. No whole repository
test command was run.

## Limits and closure

O060 is not implemented and repeated-operand policy remains unapproved. Public
or default DU registration was intentionally not added. No deployed-provider,
GNU/Linux/native ordering, performance, whole-project, or superiority claim is
made. The historical three native ordering differences remain outside scope.

No source, package manifest, root export, existing test, freeze, baseline,
evidence, or `AGENTS.md` file was edited. No subagent or worker was created. All
spawned child processes settled; the final manifest records an empty child set.
Task-owned scratch was authenticated and removed after capture. The foreign
cached-index fingerprint was
`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391` at both capture boundaries.

At atomic staging, this verifier added an explicit 311-file owned list. During
the first post-stage inspection, 18 separately owned `migration-audit-9a5a6f92`
paths concurrently appeared in the index; the combined cached-diff fingerprint
was `5ed8abf6ad9f4aa2d22c24da1e0b4bae7c140c9a`. Those foreign paths disappeared
before the next read without action by this verifier. Immediately before commit,
the index again contained only the 311 owned paths. The commit uses `--only`
with the same explicit owned list, so any later foreign staging is excluded and
preserved.
