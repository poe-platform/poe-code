# Cross-adapter failure triage — August 26, 2026

## Immutable measurements

Every run archives the specified commit and uses unchanged
`tests/integration/adapter-tools/matrix.test.ts`. Node v22.22.2 runs with strict
unhandled rejections. Main package and lock hashes must match the cached tooling;
reports retain archive hashes, exact commands, per-test TAP and all nonpasses.
No native tool, cloud credential, capability skip, stub command or custom
executor is substituted for the actual six-family, 49-command aggregate.

| Archive | Report suffix (`adapter-matrix-*.json`) | Pass | Fail |
| --- | --- | ---: | ---: |
| 6a259ff4c38f64efb506e39812166ff7f003f6ce | initial | 58 | 21 |
| b01ceda66945fb9a651c7add3610b6a53e52e467 | after-touch | 61 | 18 |
| a5d68b970412248b67d48cf747ab0d86a2ae2ba7 | after-webdav | 66 | 13 |
| 1c846a1ff39974d5b2fa330d2d55e07f523fd30e | s3-isolated | 76 | 3 |
| b8df9e10df55f84b6736586344f92237b0a51263 | after-s3 | 68 | 11 |

All denominators are **79**, with **0 skipped, 0 TODO, 0 cancelled**. The latest
recorded archive is not the moving worktree. The `after-s3` report also includes
shell commit 19149d3; the isolated S3 archive separates its diagnostic changes.

| Family | Initial | After touch | After WebDAV | Isolated S3 | Latest archive |
| --- | ---: | ---: | ---: | ---: | ---: |
| memory | 11/11 | 11/11 | 11/11 | 11/11 | 10/11 |
| real | 11/11 | 11/11 | 11/11 | 11/11 | 10/11 |
| S3 | 1/11 | 2/11 | 2/11 | 11/11 | 10/11 |
| WebDAV | 5/11 | 6/11 | 11/11 | 11/11 | 10/11 |
| mount, including cross-backend case | 10/12 | 10/12 | 10/12 | 11/12 | 10/12 |
| overlay, including lower-preservation case | 11/12 | 11/12 | 11/12 | 11/12 | 10/12 |
| readonly | 9/10 | 10/10 | 10/10 | 10/10 | 8/10 |
| standalone jq split | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 |

Required-backend subtotal progresses **28/44 → 30/44 → 35/44 → 44/44 → 40/44**.
Ten named probes execute within each of six cases; their 60 subassertions are
not added to the test count. The matrix is neither every tool flag nor every
backend composition. Earlier passing backend/conformance suites were insufficient
to establish cross-layer pluggability. Prioritize real interoperability, not
additional tool names, without narrowing the user's full goal.

## Original 21 failures, exact names and current routing

All names below are in `tests/integration/adapter-tools/matrix.test.ts`.
`Fixed` means the unchanged case passed at isolated 1c846a1, not that every
related capability is complete or that its latest diagnostic assertions pass.

| ID | Exact test name | Cause / owner / disposition |
| --- | --- | --- |
| A01 | s3: independent six-family named-file probes | Throwing stream stubs; Poincare, fixed 1c846a1. |
| A02 | s3: aggregate six-family coding-agent flow | Same stream blocker; Poincare, fixed 1c846a1. |
| A03 | s3: binary stdin, compression, hashes and redirected bytes | Streaming/remote redirection; Poincare, fixed 1c846a1. |
| A04 | s3: cwd, supplied stdin and explicitly empty stdin | First named read failed, not stdin-origin regression; Poincare, fixed 1c846a1. |
| A05 | s3: create, copy, append, inspect and remove files | Remote operations/readback; Poincare, fixed 1c846a1. |
| A06 | s3: touch creates an empty file successfully | Unnecessary optional timestamp call after creation; Curie, fixed b01ceda. |
| A07 | s3: move retains bytes and removes source | Default nonatomic rename refusal; Poincare changes policy in 1c846a1, see below. |
| A08 | s3: in-place edit, diff-to-patch stdin and reverse | Stream/mutation interoperability; Poincare, fixed 1c846a1. |
| A09 | s3: missing paths, stderr redirection and command errors | Stub returned ENOTSUP instead of ENOENT; fixed 1c846a1; latest diagnostic assertion fails. |
| A10 | s3: output limit terminates real binary reads | Read failed before output limit; Poincare, fixed 1c846a1; not proof of a prior shell-budget defect. |
| A11 | webdav: independent six-family named-file probes | Streaming/read authorization; Poincare, fixed a5d68b9. |
| A12 | webdav: aggregate six-family coding-agent flow | Same cross-layer blocker; Poincare, fixed a5d68b9. |
| A13 | webdav: binary stdin, compression, hashes and redirected bytes | Redirection access and streaming; Poincare, fixed a5d68b9. |
| A14 | webdav: cwd, supplied stdin and explicitly empty stdin | Named/redirection access, not EOF provenance; Poincare, fixed a5d68b9. |
| A15 | webdav: touch creates an empty file successfully | Unnecessary optional timestamp call; Curie, fixed b01ceda. |
| A16 | webdav: missing paths, stderr redirection and command errors | Access/read integration; fixed a5d68b9; latest diagnostic assertion fails. |
| A17 | mount: independent six-family named-file probes | Mounted S3 stream support; Poincare, fixed 1c846a1. |
| A18 | overlay: independent six-family named-file probes | Named gzip rejects nonstreaming capability; Poincare, still fails. |
| A19 | mount: cross-backend pipeline and copy use real mount plus S3 | S3 traversal fixed; both cross-backend copy directions still EXDEV; Poincare. |
| A20 | structured capability gap: raw slurped text can be split into lines | Unsupported jq split/1; Archimedes, still fails. |
| A21 | readonly: rejects mutation: gzip payload.bin | ENOTSUP preflight instead of EROFS, not a write escape; Plato, fixed 247756d. |

Curie's touch change has seven independent regressions, three red before the
fix, seven green after; 17 focused core cases, all six matrix touch cases and
scoped strict types pass. Existing-file/reference timestamps still require
`utimes`; missing support for `-r` fails before creating a partial target.
The after-touch archive also includes Plato's fix: do not credit Curie with
all three improved matrix rows.

S3's 1c846a1 makes stream methods available only when its transport negotiates
actual streaming, rather than exposing always-throwing optional methods.
Access remains synthetic, not IAM permission prediction. Its default rename
changes to conditional copy/delete: **atomicRename remains false**, partial
effects remain possible, and `allowNonAtomicRename: false` retains fail-before-I/O
policy. The mock pass does not establish atomic remote moves. Root must review
this deliberate policy change explicitly; it must not disappear behind totals.

## Latest 11 failures: three functional, eight diagnostic assertions

At b8df9e1 the three substantive failures remain:

1. **Poincare — A18:** `gzip -c payload.bin | gzip -dc` rejects overlay named input
   with `ENOTSUP: named input requires VFS streaming reads; no readFile fallback`.
   Do not lie about streaming or introduce an unbounded fallback.
2. **Poincare — A19:** `cp payload.bin /objects/copied.bin` and
   `cp /objects/seed.bin returned.bin` both fail `EXDEV`. The gzip pipeline to
   `/objects/archive.gz` now passes, exposing the subsequent copy barrier.
3. **Archimedes — A20:** `jq -R -s 'split("\n") | map(select(length > 0))'`
   returns 3 (`unsupported function split/1`) for `alpha\nbeta\n`.

Eight additional exact names fail after Sagan's 19149d3 diagnostic change:

- `memory: missing paths, stderr redirection and command errors`
- `real: missing paths, stderr redirection and command errors`
- `s3: missing paths, stderr redirection and command errors`
- `webdav: missing paths, stderr redirection and command errors`
- `mount: missing paths, stderr redirection and command errors`
- `overlay: missing paths, stderr redirection and command errors`
- `readonly: rejects mutation: printf 'changed' > target.txt`
- `readonly: rejects mutation: printf 'changed' >> target.txt`

The six missing-path rows pass command stderr redirection and nonzero failed
input-redirection status, then expect `/ENOENT.*missing\.txt/`. Actual shell
stderr is `shell: line 1: missing.txt: No such file or directory\n`. Checks for
unknown commands and invalid rg expressions later in those rows are not reached,
so they are not credited as passes. Both readonly rows establish nonzero status
and unchanged full namespace/bytes before expecting `/EROFS/`; actual stderr is
`shell: line 1: target.txt: Read-only file system\n`.

Route **Poincare (matrix) + Sagan (shell)** for independently grounded diagnostic
reconciliation. No expectations are changed here. These observations demonstrate
assertion/protocol presentation disagreement, not newly successful writes or
eight backend semantic regressions. Archive isolation reproduces the transition;
there is no evidence of a test race. Required nonzero status, exact error meaning,
path and filesystem state must remain asserted if diagnostic fixtures change.

## Relationship to the earlier full-suite failures

Commit 06fb1a3 already records every original 51 name and owner in
`FAILURE_TRIAGE.md` and `failure-triage-index.json`, including raw focused native
controls and later complete-run logs. Original f4eb0b3: 4,755 pass / 51 fail /
5 skip / 4 TODO of 4,815. Classification: 23 verified later source fixes,
1 corrected pipeline-format fixture, 11 Apple oracle limitations, 6 dialect
expectations, 4 obsolete duplicate-status assertions, 1 patch-boundary semantic
gap and 5 shell differences. These are historical dispositions at the stated
revisions, not a current claim that every residual still fails after later fixes.

Most recent recorded **complete** archive 22fd7e5: 6,729 pass / 59 fail / 9 skip /
0 TODO of 6,797; 45 failures route to Faraday, 14 to Sagan. Build/typecheck,
49-command built-root smoke and six actual-local SafeJS cases passed. Its
comparison is 118/118 virtual versus just-bash 3.4.2 at 108 pass / 9 fail /
1 unsupported. It predates this matrix and subsequent source fixes. **Do not add
51 + 21, combine denominators, or substitute this matrix for a fresh full run.**

Faraday's inspected `tests/commands/diff-patch-stress/checkpoint/REPORT.md`
separately freezes b92841a: 2,909 pass / 30 fail / zero skips or TODOs of 2,939.
Failures divide into formats 14, parser native controls 5, compatibility 9 and
standalone fuzz 2. Its 7,168 seeded GNU properties are nested, not extra tests
or an exemption for the 30. Its built-package 14/14 and 118/118 small comparator
are independent gates. This report is attributed owner evidence, not another
execution here; exact old-51 identities remain in the existing triage index.

## Reproduce and remaining evidence

```sh
node benchmarks/verify-adapter-matrix.mjs --revision 6a259ff --output /tmp/matrix-initial.json
node benchmarks/verify-adapter-matrix.mjs --revision 1c846a1 --output /tmp/matrix-s3.json
node benchmarks/verify-adapter-matrix.mjs --revision b8df9e1 --output /tmp/matrix-diagnostics.json
```

Each command returns nonzero because retained cases fail. Archives are retained
in OS temporary directories for inspection; the runner never cleans another
worker's files. Tests use real temporary files, S3 MockS3Client, and a loopback
WebDAV HTTP protocol server. No real provider credentials/signing or deployed
WebDAV server is exercised. Full protocol, authorization, large-transfer,
wrapper-composition, concurrent mutation and host-cancellation evidence remains
necessary. Zero runtime dependencies, full product scope and the unproven exact
superiority requirement remain unchanged.
