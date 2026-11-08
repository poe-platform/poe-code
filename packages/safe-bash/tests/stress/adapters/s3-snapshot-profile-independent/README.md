# Independent S3 snapshot-profile fixture verification

## Decision

**Accept the approved fixture-only migration at
`8b19cf4fad31ed4c11ca76bcb0cc38ef1a5ce508`, bounded to the explicit snapshot-marker
profile.** No production defect was found in this scope. This reviewer is neither
fixture author nor production author. Only this new subtree is owned or changed.

The historical evidence seal is
`12782961ce72a7b84f9043bb1f0d75456cf6c5d1`. The subsequently available author
evidence commit is `71ecb39df73a46210e923c59141c89eb3f3fd311`; its committed-run
report and raw stream hashes were independently authenticated, not substituted
for fresh execution. Its reported **49 passing checks are confirmed** by counting
individual TAP results and summaries in both the sealed author run and this replay.

## Exact old/new distinction

- Old S3: unconditional `FsError ENOTSUP` from the unchanged named-file cleanup
  input. The original b494 fixture blob is
  `3035b03a8179f211665f6b0e54e3aa65cd9a95f4`, SHA256
  `e8f5e47e15f8e601b08176954533eacff02102c4910d4c6da52547546989f4e5`.
- Original b494 failure remains **failed**, `Missing expected rejection.`, at
  decoded TAP line 109632, original assertion `remote-safe-workflows.test.ts:58:5`.
  Encoded/decoded raw hashes, excerpt, evidence-manifest cross-binding and routing
  are authenticated. Historical **16,520 pass / 307 fail / 13 skip**, 16,840 tests,
  remains RAW UNQUALIFIED; nothing is erased, relabeled or subtracted.
- New S3: explicit `snapshotRmdir === true`; exactly one successful DELETE of
  `safe-workflows:work/scratch/nested/`; all remaining object bodies, metadata,
  ETags, parents and sentinel preserved. Quiescent directory absence is checked
  only in the quiescent fixture. Migrated fixture SHA256:
  `c82963893dd92fb08c2b684d8f359e1ecc94d8cfb7f38d79aee6095e5a41d689`.
- Stock WebDAV still requires exact typed `ENOTSUP`, syscall `rmdir`, requested
  path, zero mutations, unchanged namespace/bytes and all parents. It is not
  promoted to snapshot or atomic removal.
- The original setup/payload, four other workflow bodies and WebDAV refusal
  assertions are preserved. The historical report's 24 passing controls are
  covered by the unchanged WebDAV workflow plus the 23 selected control tests;
  they are not an additional 24 distinct checks on top of the 49.

The old assertion was also replayed from its exact archived bytes against the
frozen candidate source: one expected assertion failure with the same diagnostic.
That is **fresh negative evidence**, not reconstructed historical raw. The earlier
investigator's cleaned temporary raw remains unavailable; its surviving report
is the immutable captured `.data` file in the author subtree.

## Fresh results

Successful run: `evidence/attempt-003/report.json`, SHA256
`8bd427e8227ed2b75b2ddc6b0fe10e9045d162b49880c51eefc9ce1c7d1ed6cc`.

| Cohort | Observed result |
| --- | --- |
| Migrated/unchanged remote workflows | 6 pass |
| Author preservation/capability/tamper guards | 20 pass |
| Unchanged marker controls | 10 pass |
| Unchanged inspection controls | 9 pass |
| Unchanged authority refusal | 1 pass |
| Unchanged stock WebDAV controls | 3 pass |
| **Author cohort, independently replayed** | **49 pass** |
| Separate independent runtime guards | 10 pass |
| Isolated mutant rejection executions | 23 expected assertion failures; 13/13 mutants caught |
| Pristine workflows/independent guards after restoration | 16 pass, repeated checks |
| Exact old assertion replay | 1 expected assertion failure |
| Scoped strict no-emit types | exit 0 |

There are **59 distinct positive checks**, plus 16 restoration repetitions,
not 75 distinct checks. Successful-run totals across positive and deliberately
negative executions are 75 pass / 24 expected fail; every TAP cohort has zero
skips, cancellations and TODOs. No import, syntax, timeout or process failure is
accepted as a mutant detection: the single selected named test must fail with
`ERR_ASSERTION`.

The independent tests do not import the author's assertion helper. They fully
paginate a page-size-one backing inventory and retain owned byte copies. They
cover exact quiescent deletion, three observed descendant representations,
post-inspection byte child/nested marker/nested bytes surviving with directory
visibility, missing completeness, missing/repeated tokens, failed final listing,
and exact stock WebDAV refusal with preservation.

## Mutations

Each mutation is applied with `apply_patch` only in a fresh owned isolated copy.
The patch, source-before/after hashes, application output and failure TAP are
retained. Ten mutants are rejected by **both** the frozen author workflow and
the independent test: false/omitted capability, extra child DELETE, extra
sentinel PUT, parent DELETE, WebDAV false success, and silent backing-store
byte/parent/metadata/ETag corruption. Silent mutations leave the request trace
unchanged, proving that snapshot preservation checks actually detect damage
rather than relying only on extra-operation detection. The parent-marker mutant
leaves other descendants making the parent logically visible, so a stat-only
check would not suffice.

Three further independent detections cover explicit and silent removal of a
late child, and accepting an incomplete listing. The extra-child DELETE mutant
can target an absent key: even unchanged final bytes cannot excuse the extra
destructive request. Positive late-child tests require success, exact marker-only
DELETE, unchanged surviving descendants and continued logical visibility.

## Closure, attempts and cleanup

The archive is created from the exact fixture commit, not moving HEAD. Every
one of 239 inputs (237 committed inputs plus two exact independent overlays) is
hashed before/after. All 213 product source/document files are frozen. All 223
non-fixture author-start inputs are byte/blob-identical. Historical b494 and this
candidate have identical filesystem/contracts and selected helper/control paths;
**not all product source is identical to b494**: unrelated `src/commands/env-split.ts`
and `src/commands/execution.ts` changes are explicitly recorded in `AUDIT.json`.

Scoped typing checks all 177 product TypeScript files and the selected tests and
helpers: 188 local TypeScript inputs and 166 installed development type inputs.
All 354 actual compiler-listed inputs are hashed, classified and checked again.
No root configuration/discovery change, build, shared dist, service runner,
download, real bucket, private checkout or live source mutation is used.

Two verifier failures remain preserved beside the successful run:

1. `attempt-001`: an overly broad commit-delta assertion treated unrelated
   concurrent evidence commits between the seal and fixture commit as fixture
   changes. No tests ran. Corrected to authenticate the fixture commit's own
   paths and compare the entire non-fixture input closure byte-for-byte.
2. `attempt-002`: 49 author plus 10 independent tests passed, with the old
   expected failure, but scoped types failed TS2339 because the concrete WebDAV
   capability literal omits `snapshotRmdir`. Only the independent test's variable
   annotation changed to public `FileSystemCapabilities`; the exact assertion
   was not weakened. Before attempt-003, the runner's deletion-only patch byte
   comparison was also corrected, and silent-corruption mutants were added.

Each attempt retains its precise runner/test source as captured `.data`, report,
commands and raw stdout/stderr. An initial read-only inspection guessed the
nonexistent `src/fs/webdav/filesystem.ts`; inspection then used the actual
`src/fs/webdav/webdav.ts`. This was not a product/test failure or a file change.

All three owned `.work-*` archives were removed after integrity checks, and all
13 mutations were individually restored before final pristine replay. Every run
records clean input integrity and an unchanged index. Other workers advanced HEAD
and their existing tracked/untracked work was not changed, staged or cleaned.
Actual recorded execution windows are August 27, 2026, 13:09:10–13:09:15 UTC,
13:09:33–13:09:49 UTC and 13:10:39–13:11:01 UTC; no 72-hour claim is made.

## Reproduction and limits

From the repository root, choose a **new** output path:

```sh
node tests/stress/adapters/s3-snapshot-profile-independent/run.mjs tests/stress/adapters/s3-snapshot-profile-independent/evidence/new-run
node tests/stress/adapters/s3-snapshot-profile-independent/audit.mjs tests/stress/adapters/s3-snapshot-profile-independent/new-audit.json
```

Exact executable, loader/compiler versions/hashes, environment override, cwd,
test names, arguments and raw hashes are in each report. Existing local Node,
tsx, TypeScript and `apply_patch` are prerequisites; no installation occurs.
`AUDIT.json` authenticates the retained attempts, source/type closure, runtime
counts and all existing owned assets except its own self-referential hash.

Acceptance is profile-bounded fixture acceptance, **not** atomic POSIX empty-only
semantics, marker-instance/ABA protection, all-provider/deployed interoperability,
a full current gate, superiority, or universal safety. Provider listing truth
remains a prerequisite; successful marker removal need not remove the logical
directory. No unrelated historical failures are waived.
