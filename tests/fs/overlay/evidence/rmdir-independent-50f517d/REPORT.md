# Independent rmdir checkpoint — 50f517d

**Overlay static-lower correction verified; aggregate adapter-tools acceptance remains RED, 77/79.** No product source, author tests/evidence, old expectations or matrix files were edited. Only this new evidence publication is owned by the leaf.

## Fixed source and scope

- Pin: `50f517d4e28281ccba8c7580d017fe65a4bf8e20`. Fresh isolated Git archive; no live-source overlay or dependency installation. Node v22.22.2, tsx 4.23.12, TypeScript 5.9.3, esbuild 0.28.2, @types/node 22.20.1.
- Original review read: `/tmp/safe-bash-overlay-rmdir-3a9177a-AGvOuU/REPORT.md`. Its report, original probe/output, runner, manifests and checksum list are copied byte-for-byte under `original/`. All 10 original top-level files, including the original source tar, remained unchanged; `original-stability-{before,after}.json` records them.
- Exactly three commands ran once: same-eleven observation replay, unchanged revised adapter-tools matrix, and strict scoped FS TypeScript. Raw stdout/stderr, exact argv, UTC times, cwd and exit records accompany each. No original-matrix rerun, full-FS suite, full-repo suite, unrelated fix or owner wait.
- No private provider or public network service was contacted. Matrix remote coverage uses existing injected S3 mock and WebDAV loopback fixtures.

## Results: observations are not test-suite counts

| Gate | Result | Exit |
| --- | --- | --- |
| Same original eleven labeled observations | All eleven required checks hold: ten within lifetime preconditions, one explicitly outside | 0 |
| Unchanged revised aggregate adapter-tools matrix | **77 pass / 2 fail / 79 tests**, zero cancelled/skipped/TODO | 1 |
| Strict FS typecheck, 94 source/test entrypoints plus transitive imports, --noEmit | No diagnostics | 0 |

Do not add eleven observation rows to the 79-test denominator. They are a standalone asserting repro, not eleven Node test cases. `summary.json` maps every original case name and result to the fixed result; exact names/order are asserted identical.

### Same-eleven replay

The original reproducer is unchanged in `original/probe.mjs`. The new `probe.mjs` changes only the four previously unjustified ENOTSUP expectations to required success, updates the pin, and strengthens successful-removal assertions. Fixtures, queue scheduling and outside-contract diagnostic remain the same. `probe-delta.patch` records the exact change; no historical acceptance expectation or repository test was modified.

| Observation | At 3a9177a | At fixed pin |
| --- | --- | --- |
| Static lower-only empty | ENOTSUP | Success, zero backend mutation, directory whiteouted |
| Static preexisting upper-only empty | ENOTSUP | Success, exactly one upper.rmdir |
| Static merged empty | ENOTSUP | Success, exactly one upper.rmdir |
| Overlay-created upper empty | Success | Success, exactly one upper.rmdir |
| Logical empty after individual lower-child whiteout | ENOTSUP | Success; hidden backing child bytes remain |
| Logical empty with opaque recreated directory | Success | Success; hidden backing child bytes remain |
| Visible lower child | ENOTEMPTY | ENOTEMPTY; exact namespace/bytes preserved |
| Visible upper child | ENOTEMPTY | ENOTEMPTY; exact namespace/bytes preserved |
| Same-instance child queued before rmdir | Child succeeds; rmdir ENOTEMPTY | Same; new child preserved, no backing rmdir |
| Same-instance child queued while rmdir holds queue | rmdir succeeds; later child write ENOENT | Same; no child was created/deleted |
| Deliberate external-lower write during listing | ENOTEMPTY | ENOTEMPTY; external bytes retained; outside preconditions |

Every static failure preserves complete before/after snapshots. Successful removal leaves exactly the prior overlay/upper child maps minus the removed directory; lower snapshots remain identical, excluding permissible read-side atime. Traps permit only upper.rmdir during the measured successful operation, with an exact one-or-zero call count. No rm, recursive flag, rename, staged removal, garbage cleanup or lower mutation is used by rmdir. Full snapshots retain byte arrays and metadata rather than merely exit status.

The final row is deliberately outside the documented unchanged-lower/exclusive-upper lifetime prerequisites. Its outcome is retained as an observation, NOT a supported mutable-lower guarantee, additional acceptance requirement or justification to reject valid static callers. The correction supplies no global snapshot, cross-instance identity or persisted-whiteout guarantee.

### Unchanged actual aggregate-plugin matrix

`tests/integration/adapter-tools/fixtures.ts:168` creates the shell with `.use(agentCommands())`; dispatch middleware forwards to the actual handlers. No substitute registry/implementation was installed. Both matrix and fixture blobs are byte-identical to the prior frozen `3731587` cohort (`matrix-identity.json`).

| Backend/group | Pass / total | Fail |
| --- | --- | --- |
| memory | 11/11 | 0 |
| real | 11/11 | 0 |
| S3 | 10/11 | 1 |
| WebDAV | 10/11 | 1 |
| mount | 12/12 | 0 |
| overlay | 12/12 | 0 |
| readonly | 10/10 | 0 |
| structured split | 1/1 | 0 |

Exact failures, both at unchanged `matrix.test.ts:105`:

1. `s3: create, copy, append, inspect and remove files`: shell status **1**, expected 0; stderr reports `ENOTSUP: S3 object deletion cannot atomically require an empty directory prefix` for rmdir `/work/scratch/nested`.
2. `webdav: create, copy, append, inspect and remove files`: shell status **1**, expected 0; stderr reports `ENOTSUP: rmdir has no safe portable WebDAV equivalent` at the same virtual path.

The failing command is `rm scratch/nested/copy.txt && rmdir scratch/nested && rmdir scratch && test ! -e scratch`. Earlier creation/copy/append/read/find assertions pass. The `&&` trace reaches rmdir after file removal, so this is not an all-or-nothing workflow; the unchanged test does not separately capture the entire postfailure namespace. No unsupported-provider skip, recursive workaround or expected-status rewrite was made. These remain real required interoperability gaps, distinct from the corrected overlay behavior and the four old adapter-stress classifications.

**Separate historical cohorts:** original `6a259ff` modern-source diagnostic **71/79** is not this revised matrix and was not rerun. Prior frozen revised `3731587` **79/79** is historical, not today's result. This run is explicitly **77/79**, not a rebaseline of either cohort.

## Scoped type/readonly and stability verification

- Both readonly FsOptions fixes committed in `3a9177a` remain byte-identical at the fixed pin: `readonly.test.ts` passes only FsOptions to rmdir; `conformance.test.ts` removes its recursive argument. `readonly-fixes.json` records matching Git blobs and `readonly-original-fix.patch` preserves the exact prior change. Those files participated in the clean 94-entrypoint FS typecheck; their runtime tests were not redundantly rerun by this leaf.
- `manifest-{before,after}.json` covers **278 archived inputs**, including every pinned source file and the relevant FS/test/matrix files (historical evidence subtrees excluded from this per-file census). Every archived input matches pinned Git content and remains unchanged. Complete selected archive hash is in `trees.json`.
- Pinned whole-source tree: `2004411f4d8c67812c56369306917754bbce95fa`.
- Pinned and captured live FS tree: `d819224f37042b624034a0b55615bc8dc9ec41d1`.
- Captured live HEAD before/after execution: `cb707e69a4733a5cf1a7ff5e48060c2984934796`; its whole-source tree is `bf17a3ebeaceb70185e8839623a2383dcdacec20`, NOT substituted for the pinned source. Non-FS source history can differ without changing this test pin.
- Broad FS status (source, tests/fs, adapter stress, S3 policy, remote cancellation and both adapter integration scopes) and seven-backend source/test status are empty before/after execution. Scoped live-file hashes are stable; pin-to-live FS diff and scoped index diff are empty. `live-{before,after}.json` contains full hashes/status rather than assuming live HEAD was the pin.
- Per-backend source/test Git trees are in `trees.json`. Publication adds only this evidence directory; it does not change the source tree. Any publication-only test-tree change must not be mistaken for backend source remediation.

## Limits, processes and handoff

The source author's focused **23/23**, overlay **182/184** (two known required-red aliases) and conformance **202** are author evidence only, not independently repeated here. Passing this observation replay and overlay's 12 matrix cases does **not** close those aliases. Identity remains a Root/Curie coordination blocker.

The four old stress classifications are unchanged; immutable `ebe36d2` evidence remains intact (`four-red-evidence-identity.json`). Neither those stress tests nor the original matrix were rerun or edited.

The checkpoint runner PID was **81086**. All three synchronous child commands returned; final process capture confirms **zero active checkpoint runner/test/typecheck processes**. Raw process captures are retained. The runner's first path-match capture used `/private/tmp` while its invocation used `/tmp`; the final check explicitly handles both aliases and checks the runner PID. The reporting leaf and ephemeral capture process are not asserted absent. No unrelated worker was stopped or signalled.

Only new files under `tests/fs/overlay/evidence/rmdir-independent-50f517d/` may be committed. `SHA256SUMS` covers the new delivery; historical checksum lists under `original/` remain original. Frozen tar/dependencies remain in the fresh /tmp archive rather than being vendored. Rerunning historical runners at their original absolute paths would overwrite captures: treat them as immutable reproducer evidence and use a fresh directory for any future run.
