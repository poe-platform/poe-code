# ROOT qualified module acceptance — SOURCE/DATA adjudication only

ROOT explicitly accepts the bounded apply_patch module profile identified below.
This additive note records that decision and authenticates existing observations;
it does not change fixtures, source, raw records, expected values or scores.
No new product/runtime execution, test, retry or process census was performed.
Developer Git metadata verification and this documentation commit are not product
execution. Root README/ledger/default integration remains Curie's separate scope.

## Immutable identities

- Candidate: `753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d`.
- Derived coherent tree: `6a59ca403c5411344dea2ee057909ba179bf7043`.
- Full882 package SHA256: `f04afbf9230fd9e3275f83c7dab26837aeb618bd6178f4ac0b794b93302d6d95`.
- Full54 evidence: `83c2711f3eb28474531de94b468c6612dab32b1b`.
- Continuation preseal commit: `4eb3bf73ab9d595471d83223fe46cc413114f900`.
- Continuation preseal SHA256: `b23396701e4e06318eb200b8b04866bb81d87c3b1cd511bd528604f86d0ed4a4`.
- Captured continuation evidence: `9ed30e1d0d18b105c264143718ac668541b6c57b`.
- `attempt-01/RESULT.json` SHA256: `f61cc0d9ce7b13eec713cf974688db77c05fa991eed994debb17621b2fac48b1`.
- `attempt-01/POSTGUARD.json` SHA256: `2b30799125e63ce35fa085f22007181ab5d0ec61fcd77fc8be1b2372713195e2`.
- `attempt-01/source.stdout.raw` SHA256: `f427e384efb48f71b43bbbd28d328af051431dca5e08173b6cffeb2a985c4819`.

Before adding this note, Git diff against the exact9ed30e1d commit was empty for
the continuation subtree. All15 manifest-referenced capture files were checked
against POSTGUARD bytes/hash/mode. Captured source metadata and its BINDINGS were
reauthenticated against the continuation preseal. No live product source was used
as a substitute for the selected candidate composition.

## L07 positive cleanup-count adjudication

The raw source worker records at lines3/4 are L07-16383/L07-16384; line5 is over.
RESULT contains the same records under the source evidence entry.

| Recorded field | L07-16383 | L07-16384 | L07-16385 |
| --- | ---: | ---: | ---: |
| Exact absolute path bytes | 16383 | 16384 | 16385 |
| Patch bytes | 16430 | 16431 | 16432 |
| Components / maximum component bytes | 65 / 252 | 65 / 252 | 65 / 252 |
| Fulfilled command status | 0 | 0 | 1 |
| Stdout bytes | 16424 | 16425 | 0 |
| Stderr bytes | 0 | 0 | 39 |
| Registered closures | 2 | 2 | 1 |
| Cleanup rejections | 0 | 0 | 0 |
| Complete namespace entries | 68 | 68 | 3 |
| Command filesystem calls | 262 | 262 | 0 |
| Frozen case classifier | FAIL | FAIL | PASS |

Both successful cases captured a one-byte LF target (hex0a; SHA256
`01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`),64 created parent
directories, unchanged /work and /, and unchanged binary sentinel
`00ff8053656e74696e656c0d0a`. Exact success summaries and the complete namespace
assertions passed. Stdout was emitted in [16384,40] and [16384,41] byte chunks.
The65 components are below256, each at most252 bytes below the provider255-byte
limit; the patch/output sizes are below the unchanged4194304/1048576 byte caps.
No lowered limits or alternate provider were used. Over refused before filesystem
access with exact `apply_patch: UTF-8 byte limit exceeded\n` and no target.

Each positive raw record contains only one failed assertion group: cleanup and
preflight, `2 !== 1`. The frozen code registered both callbacks, awaited
Promise.allSettled on both, and captured cleanupFailures=0. SOURCE identifies the
owners; callback identities were not serialized by the observer:

- Selected `src/commands/apply-patch/apply.ts:196` registers work.close; line221
  constructs the output operation only after successful publication.
  Candidate revision753f33d2fa1a2ccd86089c563d4ad66b9a1ae26d, blob
  `8082bf27ac4c4a0f2ea5f44554c21220fc55e872`,11929 bytes, SHA256
  `4444754643de62e7d1385a2205f8ffde2f0b7787c5cbd466388ca351ff70a36e`.
- Selected `src/contracts/output.ts:68` registers OutputOperation.close.
  Accepted-base revision67eab12e315054907ef4ef435c6bbca2f59e0c36, blob
  `3b1fe9536352a5e13c94ff231ce20ead354aabc8`,4661 bytes, SHA256
  `5e262bda9541a5b70fcb23d4950e92844d404f9029f02c32c889b90d7c92d83e`.

ROOT adjudicates two fulfilled owners as correct. The expected one was a
negative/preflight-path fixture assumption; that path does not construct the
output operation. No production fix or runtime retry is needed. Literal7/9 and
both assertion failures remain. Later assertions in the failed grouped checks
were not reached and are not retroactively credited as executed assertions.

## Qualified acceptance scope, without aggregate scoring

ROOT accepts the unchanged module with the following bounded evidence:

- Six new U12 public Shell cases across archived source/installed/moved. Ordinary
  sink failure fulfills status1 with the exact42-byte captured summary and31-byte
  diagnostic. Caller abort rejects with the actual caller object identity. Both
  middleware cleanups finish before settlement; later disposal does not supply
  that proof. Actual target bytes are new\n before disposal, without rollback.
- Provider-legal MemoryFS path16383/16384 success and16385 preflight refusal,
  qualified by the cleanup-count adjudication rather than a9/9 fixture claim.
- Prior15 expected type outcomes,189 unchanged-author outcomes,12 versioned-tail
  outcomes,8 scoped adapter outcomes and10 targeted mutant kills remain distinct
  prior cohorts. Instrumented S54 mechanism/mutation evidence stays separate from
  unmodified outcomes; neither is presented as universal resource instrumentation.

Original33/36 unmodified S54 and16/18 limit classifiers remain unchanged. Legacy
11 failed records remain: source/moved S62,S64,S71,S74 and installed S62,S64,S71.
The seven uncredited entries in each old layout remain S32; S54's inherited static
label; S57/cleanup-only, S57/execution-first, S57/caller-first,
S57/mapped-nonzero; and S61 —21 total, none promoted to pass.

S32 composed-authority, S57 lifecycle variants, S61 zero-budget admission,
WebDAV not independently run, and other source-only resource gaps remain explicit.
No global RSS bound, hard preemption, atomic namespace/transaction, rollback,
full native compatibility or all-provider long-path guarantee is accepted.
Original L07 ENAMETOOLONG/truncation, original U12 missing observations, all HOLDs,
capture losses and old cohorts stay immutable. No aggregate all-green score,
historical rescore, public/default registration or global project acceptance.

The prior run's four processes/peak2, exact three child close-and-absence receipts,
owner exit0, zero unhandled rejections and scratch removal are recorded evidence
only. This adjudication did not repeat a process census or clean old archives.
