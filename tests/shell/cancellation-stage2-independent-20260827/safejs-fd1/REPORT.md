# Existing qualified SafeJS25 replay on the fd1 reconstruction

## Verdict and scope

**25/25 qualified regression cases pass: surface 8/8, lifecycle 11/11,
zero-retry controls 6/6.** Exactly 25 actual engine executions, one per case;
no retries, blocked cases, containment interventions, or guest reruns.
Execution was August 28, 2026, 01:57:35–01:58:10 UTC. Preparation began at
01:57:27 UTC. Preparation/recipe binding was committed before the executions
as `064741d7b1c3a82ee008a8852f69e8bce55b05ec`.

This is the existing qualified actual-engine regression, not a new guest
`invoke({ signal })` feature test, universal SafeJS compatibility, a combined
WHICH77/Stage2 candidate, or a whole-gate result. Previous Stage2 evidence's
"SafeJS not run" remains historically accurate; this follow-up supplies a new,
separately authenticated execution. No product files changed.

## Exact selected source and package

Source origin is `fd1daa123298568546d9ea4e95f8c81dde9c52ff`, but **whole fd1
HEAD was not executed**. The selected 254 inputs are fixed baseline
`12e196af8d8b0866339747150b02ca00b9764a09`, accepted helper
`57855a0293edb83bff98113123806497b4427416`, and exactly the five fd1 blobs:

| Path | SHA-256 |
| --- | --- |
| `src/contracts/command.md` | `ace3670c3820fff94055c6a9d6bee7ac1206a06bcb7607fdafe30f340c0234c6` |
| `src/contracts/command.ts` | `d2f6c788a48b3bb0bed9570f0e69bb2bfab845528376a7fe9288d1c07556df7c` |
| `src/shell/types.ts` | `aaef878966d35d1c671cf84e5b416f10f6a31433f1ec264ef1730b9c6570f990` |
| `src/shell/runtime.ts` | `b44d60ed225c2d2add07499b965043d104491edf837cb5cf7f07096230286169` |
| `src/shell/shell.ts` | `3e36a27bbf98b384c7351ffa40d396485c788b0aa0bbefb8702e3bd45ce11a24` |

The selected archive and complete already-built package are read from sealed
`review-fd1/focused-02.json.gz.base64` at independent review commit
`7ca45f2decea9faab958b15577a55aac2be1c40c`, not mutable live dist:

- Source archive SHA-256: `51b9013eb0ac70849059403cddf22d5f8f0fab360da7a41e308ae0ca88595e87`.
- Package SHA-256: `87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af`.
- Selected source manifest SHA-256: `fda910fd019f0790417e75b78d79787164dabb10e8b48252f78ce8d09837ea72`.
- 834 package files, including 832 emitted files; all match the sealed build.
- Every one of the 25 children actually loads **204 authenticated packed
  product modules** and **63 allowed actual-engine source copies**.

The old recipe's commit/tree fields now identify the actual selected-input
Git snapshot: commit `6bd651e6e3c7c0a6bcec10cf86d504c50d96b7b1`, tree
`654af9a68732ac64e907b50396b84b9a91d1856b`. These are synthetic fixture
object identities, **not repository commits or the fd1 whole tree**. Blob,
tree and commit hashes were computed and cross-checked with read-only Git
`hash-object`, without storing Git objects, creating refs, or worktrees.
Raw object material is in the capture. No new package build or installation
was needed; the existing recipe copies and physically moves the complete
package into each isolated public consumer. Product source fallback is denied.

## Existing recipe, not new expectations

The recipe is `tests/integration/owned-output-production-rebase/author-public`
at `7204b9e01752c700dd791afd332e7f1b5fd8ba73`. Its supervisor, loader,
assessment, private guard, tooling profile, and frozen reference resolver are
authenticated before execution. Guest/case selection stays at the existing
frozen reference revisions, including `a61e63bc46e8389e59c0d8fdc1d424003f62c769`.

Mechanical harness deltas are recorded byte-for-byte in `supervisorBinding`:
bind original helper imports to their authenticated locations; replace
eba-specific identity checks with the exact fd1 selected-source/package checks;
change the owned temporary prefix. `auditImports` and `childRun` are byte
identical to the original. Loader and semantic assessments are unchanged.
The existing runner's literal `AUTHOR_COHORT_PASS` status remains in raw data;
it labels that runner, not a reuse of an old execution. All rows here executed
again against the new fd1 package. `verify.mjs` reconstructs these substitutions
and validates raw imports against both the selected package and private hashes.

Qualifications retained:

- Surface cases 07 and 08 are dialect/reflection profiles, explicitly **not
  membrane acceptance**; missing-cleanup/acquisition cases retain their negative
  capability semantics. Eight passing assessments do not mean eight successful
  unrestricted guest operations.
- Lifecycle L05 retains its selected S1 after-command diagnostic source variant,
  including `owned-guest\n)` for the execution-error row. Caller/execution/cleanup
  failures remain expected rejections, not converted success. The existing
  exhausted-budget case returns 124; this is not a new timeout-command test.
- Z01–Z03 retain their existing open/closed, explicit mock-transport, zero-retry
  profile. All eight network rows (two lifecycle plus six controls) record one
  authorization, one transport, one transport cleanup and one response disposal;
  no additional transport entries. No external network service was contacted.
- Node **22.22.2 Darwin arm64**, binary SHA-256
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`;
  existing TypeScript 5.9.3/tool inventories are pinned. No Node24/Linux claim.
- Actual private source hooks are tested; this is not proof of an installed
  private package, its CLI, unsupported engine entry points, or opaque preemption.

## Outcomes

| Existing group | Observed expected-profile outcomes |
| --- | --- |
| Surface 01–08 | 8 passing unchanged assessments; 07/08 remain qualified dialect profiles |
| L01 aliases | Result 7; byte/alias assertions pass |
| L02 positive / exhausted | Results 0 / 124 |
| L03 live / after lifetime | Results 0 / 0; lifetime checks pass |
| L04 explicit children | Result 0; owned-child checks pass |
| L05 caller / execution / cleanup | Three expected rejections with original identity/ordering assertions |
| L06 curl open / consumer closed | Results 0 / 141 |
| Z01 open / closed | Results 0 / 141 |
| Z02 open / closed | Results 22 / 22 |
| Z03 open / closed | Results 47 / 47 |

`REVIEW.json` records each row and exact module counts. Raw assertions, event
ordering, bytes, errors, selected variants, child records and loader journals
are retained, not replaced by this summary.

## Private guards, cleanup, and retained initial failure

Private `poe-code` HEAD is
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`; tree
`ebcb4508690856b288a40e60e7682331d6fad8ff`. A preliminary read-only preflight
and all **three cohort pre/post pairs match exactly**: HEAD/tree, Git status,
staged changes, index hash/mode/times, six metadata files, and 264 regular engine
input files including hashes/modes/times. Approved untracked-plan names stay
in the status profile; their contents were not read. Engine inputs are regular
file copies, not symlinks/hardlinks. No private install, build, worktree, or write.

Copied inputs and public binding inventories match before/after including
added-entry detection. All 25 child processes closed naturally with exit 0,
without containment or signals; the supervisor checked PID absence after close.
Preparation root and all three cohort roots were removed. No owned child remains.
Compact evidence contains public test code, inventories and reports, **not
private engine code or binaries**. Foreign temporary directories were untouched.

The first replay-script syntax check failed before execution because a helper
function was missing its closing brace. The exact initial source and reproduced
syntax-only failure remain in `preparation-failure-01.json.gz.base64` (zero guests,
zero private queries). An inspected stdin omission in a read-only hash-check
call was corrected before execution. Neither is a product failure, guest retry,
or altered expectation. All actual guest execution is the single `actual-01`.

## Recheck without private access or guest rerun

Run from repository root:

```sh
node tests/shell/cancellation-stage2-independent-20260827/safejs-fd1/verify.mjs
```

This data-only check reads owned evidence and authenticated **public** Git
objects, validates all embedded record hashes, exact package/engine loads,
recipe transformation, guards, and cleanup. It executes no guests and does not
access the private checkout. The one-shot `replay.mjs` deliberately refuses to
overwrite `actual-01`; do not delete it or treat another run as this execution.

Compressed actual-capture SHA-256:
`15c632dfc66434239fec65b4efc0b26c7f535988ffc57a2fcb8681e2c8a40959`.
Preparation/preflight/actual bytes and public helper hashes are sealed by
`REVIEW.json`. Earlier Stage2, WHICH, first-read and SafeJS evidence is unchanged.
