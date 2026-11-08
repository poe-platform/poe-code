# Owned-output staged production rebase — author checkpoint

August 27, 2026. **Source review-ready; not release acceptance or promotion.**
No additional agents were spawned. No private checkout, query, import, build,
installation, package build/pack, root dist write, branch, or foreign cleanup.

## Frozen candidate

- Starting committed HEAD: `a03b9288a6f4b652387be9fefa8faf17ef58b9e7`; tree `d411959221ddce4c0b04d686aa5885c9db40e547`.
- Source + focused tests commit: `eba049535d154f4e028f57ffd8efd7622b2239ca`; tree `62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.
- Parent at commit: `954ddde45d7d77c36067f15f79d3881f2a51f8db`. All eight existing owned parent blobs still
  equal the start baseline; output.ts was absent. Other owners' accepted commits
  are retained, not transplanted over. Foreign index was unchanged by this commit.
- Nine-path source diff SHA-256: `83b339002970df881efb56cc50fa0e0e74f1f832edb6c8706287827a3dc5e4ad` (`source-rebase.patch-data`).
- Candidate all-src identity: `40914b93fe1a1a82d9abdcdf4f4cc4360ab6e85ab16b5d9f75768e00c73213ec` (247 entries including
  documentation, 206 TypeScript files; not test counts).
- Exact path/blob/byte hashes: `SOURCE-CANDIDATE.json`. Initial independent freeze,
  foreign untracked status and authenticated B0/V1/retention/S1 chain: `BASELINE.json`.
  Proposal and exact zero-only overlay authentication: `PROVENANCE.json`.

## API and implementation

`API-CHECKPOINT.md` contains the exact TypeScript shape published before source
edits at `/tmp/safe-bash-owned-output-production-api-checkpoint.txt`.
The API is unchanged from approved S1: optional `ByteSink.ownedOutput` with
`consumerClosed` and `write`; `createOutputOperation(context, destination)` returns
`signal`, `output`, `registerCleanup`, `acquire`, `child`, `close`.
`HttpRequest.registerCleanup` is optional. Only contracts/index.ts adds a barrel
export. No `accountedWrite` field, `runtimeOwnedOutput`, dependency or root export
change. The package remains virtual-bash.

The rebase applies authenticated feature hunks to current accepted source, not
old whole files. Current runtime/env/shebang/source/eval/errexit/stdin origin,
replaceEnv, middleware/accounting and invocation cleanup code stays in place.
The streams diff is confined to its required import and cat; all other stream
commands including retained tail changes are byte-identical to the baseline.
Shared zero validation remains byte-identical to accepted bb7f5972 and is untouched.

Internal corrections within the approved shape:

1. Close drains admitted pending acquisition success/rejection, including eventual
   once-only resource release. New admission is refused synchronously; parent
   closes/drains its children; child closure leaves siblings open. All cleanup
   drains and errors retain registration order.
2. Signal listeners remain attached through drain settlement, so a later caller
   or consumer abort still reaches an admitted pending child acquisition. Normal
   close alone does not abort the operation signal. Caller public abort identity
   precedes actual execution rejection, then cleanup failure; a nonzero result
   and an ordinary command throw converted to status are not execution rejections.
3. Curl registers timer cleanup before creating its timeout and always aborts its
   transfer lifetime even if cleanup rejects.
4. S1's next-only stdin adapter is restricted to an explicitly capable stdout.
   This preserves the required legacy unenrolled direct-sink iterator-return
   behavior while enrolled output never returns the borrowed cursor. No new
   ownership flag, cursor lease, handback guarantee, or stdin prebuffer.

## Author validation (separate cohorts)

| Cohort | Result | Binding |
| --- | --- | --- |
| Final new author tests | 42/42, no skips/TODOs/cancellations | `runs/focused-final-02` |
| Same 42 tests, committed source-only snapshot | 42/42 | `runs/committed-source` |
| Unchanged contract/cleanup/pipeline/accounting/network/cat regressions | 505/505 | 27 entrypoints, `runs/legacy-core-final-02` |
| Unchanged env/shebang/source/eval/errexit regressions | 203/203 | 6 entrypoints, `runs/legacy-state-final` |
| Focused strict TypeScript no-emit | exit 0 | `runs/focused-types-final-02` |
| Source-wide strict no-emit (build config, no emission) | exit 0 | `runs/source-types-final-02` |

The two 42-test rows replay the same cohort, not 84 distinct tests. The final
working-tree captures check before/after hashes and enumerate source file entries,
including file additions (not directory/metadata identity). Selected test entrypoints and author helpers are hashed;
this is not a complete legacy helper/data-closure inventory. All owned source
hashes match the committed candidate.

**Foreign dirty qualification:** five HTML TypeScript paths in those worktree
runs differ from the committed candidate: entities.ts, input.ts, parser.ts,
render.ts, and new text.ts under src/commands/html-to-markdown/. They were never
edited, staged, committed or fixed by this author. Therefore 708 legacy passes
and the working-tree typechecks are not a complete frozen-candidate qualification.
The source-only committed snapshot removes this ambiguity for the 42 author
runtime tests: only committed src/package.json/four author TS inputs were
regularly extracted to a unique owned TMP directory; no live source overlays,
symlinks, builds or installations. Exact file inventory before/after detects new
regular files and rejects symlinks; empty-directory, special-node and metadata
changes are not covered. The owned snapshot was removed. Existing tsx tooling was used, not
an authenticated installed-tool closure. Build/moved-package checks remain pending.

The 42 tests include eight zero-policy network rows (200/302/429/503, stdin/file)
with CLI increases and Retry-After, one authorization/transport call per row,
no retry/redirect/upload replay, required file/header/stderr and disposal before
public settlement; streaming/no-prebuffer/borrowed cursor/reused chunks;
actual Node loopback transport; pending acquire/close races; cancellation and
error ordering; capability forwarding and per-write/per-stage accounting.
They do not establish deployed remote-service acceptance or RSS guarantees.

Earlier failures and exact fixture corrections are retained in
`DEVELOPMENT-ATTEMPTS.md` and original run directories. In particular, the
original 503/505 legacy run is preserved, not rewritten as 505/505. No existing
legacy test, oracle, golden, skip condition or discovery manifest was edited.

## Original five remain separate

These are historical authenticated S1 observations, not this candidate's five
requirements passing. No original fixture/assertion was migrated or rescored.

| Original requirement | Historical S1 result | Current-stage qualification |
| --- | --- | --- |
| first-read-local | FAIL, original 1200 ms deadline | Unresolved; original not rerun |
| first-read-s3 | PASS | Original not remeasured on this candidate |
| first-read-webdav | FAIL, original whole-stage abort assertion | Unresolved; original not rerun |
| first-read-curl-body | FAIL, original whole-stage abort assertion | Unresolved; original not rerun |
| first-read-curl-headers | FAIL, original whole-stage abort assertion | Unresolved; original not rerun |

The new cat fixture explicitly registers provider cleanup before `next`.
Unregistered raw-provider iterator finally promises are not promised to delay
public settlement; the original over-strong author assertion and its correction
are disclosed. No opaque command/input preemption, arbitrary host-promise drain,
byte cursor conservation, hard RSS, 72-hour completion, full parity or superiority
claim follows. Cooperative resources must honor their signal/cleanup contract;
normal close can wait for admitted work that never settles.

## Historical audit and next owner

The accepted TEMP zero-overlay audit is unchanged: source a61e63bc, author
ed21ae6c and different verifier 9f15ac3f, same 25 profiles each (19 existing plus
6 zero-policy), eight network rows, Surface07 dialect only. Its absence of an
actual/provenance blocker is scoped to that replay, not this production candidate.
No audit was rerun or relabeled as current acceptance.

ROOT should route `eba049535d154f4e028f57ffd8efd7622b2239ca` to the separate AUTHOR verification worker for
actual current built declarations and a MOVED packed-package public consumer,
then actual CURRENT private SafeJS regular copies with fresh before/after guards.
`public-consumer.mts.data` is a prepared strict public-only consumer, not an
executed/built-consumer pass. Copy it to `.mts` inside the worker's moved-package
consumer and compile/run against virtual-bash package exports, with no source
fallback. ROOT also retains the different FINAL verifier assignment.

No full-suite, global release gate, broad syntax campaign or getopts stage 2 ran.
The public snapshot cleanup suite that performs a build is deferred with the
build/package work, not skipped and counted as passing. No foreign type error
was observed in recorded no-emit runs; later unrelated edits are unqualified.
