# Independent traversal-fix followup

Frozen runs: August 27, 2026, 00:21–00:26 UTC. This is a new report, not a
replacement or relabeling of the original `d799cbb` evidence.

## Decision and counts

**Material traversal improvement independently verified; compatibility is not
closed.** The byte-identical original 43 cases change from **23 pass / 20 fail**
on `4fa4ba9` to **28 pass / 15 fail** on frozen `59b1269`. Exactly five original
positive requirements improve; no previously passing case regresses.

| Distinct cohort | Total | Pass | Fail | Scoped types |
| --- | ---: | ---: | ---: | --- |
| Frozen `59b1269`, original acceptance fixture | 43 | 28 | 15 | exit 0 |
| Its successful-operation requirements | 38 | 23 | 15 | same cohort |
| Its explicit rejection controls | 5 | 5 | 0 | same cohort |
| New final traversal-authority controls | 9 | 9 | 0 | exit 0 |
| Separately copied moving-worktree acceptance | 43 | 33 | 10 | exit 0 |

All runs have zero skipped, cancelled, or todo cases. Do not sum overlapping
rows, repeated runs, or author denominators. The original acceptance process
still exits 1, preserving every required-success failure. The new nine-control
process exits 0. Author 18/18, 515/515, original/required/conformance evidence is
not recounted here. No broad filesystem gate was rerun.

## Fixed inputs and preservation

- Source revision: `59b1269a4f4e0323c49926f4dacf2c02a395666b`.
- `src/fs/mount/index.ts` SHA-256:
  `6d260317b76b60f05596c00c8f80ff5da82cdca511a2e8bab38489d6befa64a4`.
- Original 43-case fixture SHA-256, unchanged:
  `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
- Acceptance source archive SHA-256:
  `787481088e492178e084c2a7bd23648d02023af830066134fbebe894d4e32e9a`.
- Acceptance source-set manifest SHA-256:
  `b7d2756b0dfdc44572db5da44bf72ed528cee1bb1356d1b9f4938a7943c62c33`.
- New final control fixture SHA-256:
  `85fe14f1f40196b3954ebd0bb9d24b89ae97903522769f99b861e0bad1f9a9c3`.
- Node `v22.22.2`; existing development tooling, no new dependencies.

The runner archives committed source rather than executing moving production
files. Every source file, selected test, command, exit status, and timestamp is
recorded under the new evidence directories. The control archive additionally
contains the existing `tests/fs/webdav/property-fixture.ts` loopback helper;
its archive/source-set hashes therefore differ from the acceptance archive.
Its mount hash and frozen source revision are the same.

`evidence/traversal-followup-audit.json` verifies the unchanged original fixture
and all **31 historical committed files other than the permitted runner**,
byte-for-byte against `d799cbb`. Old reports, archives, raw TAP, observations,
and test snapshots remain untouched. Only the runner gains an additive revision
mode and a frozen-fixture integrity check; default `pinned` still selects
`4fa4ba9` and its original fixture. No original expected output changes.

## Exact five recovered positive requirements

1. WebDAV one-mount copy to a missing target.
2. WebDAV separate-client cross-mount copy to a missing target.
3. Memory-to-WebDAV copy to a missing target.
4. WebDAV-to-memory copy to a missing target.
5. WebDAV same-mount rename replacing an existing distinct target.

Each passes its original exact bytes and complete namespace assertions. No
capability skip, substitute adapter, or safety-only expected error was used.

## Remaining failures and changed root causes

**Four WebDAV existing-target copies remain ENOTSUP**, but now reach the real
unknown-identity guard instead of failing during execute-access traversal:
same mount, separate clients sharing one endpoint/root, memory-to-WebDAV, and
WebDAV-to-memory. Both WebDAV cross-mount `mv` cases now reach **EXDEV at rename**
rather than ENOTSUP during target stat. The frozen core has no move fallback.

The other **nine** failures are unchanged: four S3 existing-target unknown-
identity copies, two S3 cross-mount moves, and three local cross-mount moves.
Thus the frozen remaining total is **8 unknown-overwrite copies + 7 moves = 15**.
Remote copy/move traces for these failures contain metadata operations, not
data acquisition/publication. All fifteen required failures retain the exact
initial source/target bytes and namespace snapshots. That is useful safety,
not ordinary-overwrite or move compatibility.

The source fix selects `access(0)` only when the **selected backend explicitly
declares `permissions: false`**; missing or true still selects `access(1)`.
Neither this review nor that permission choice authorizes inventing per-client
disjoint identity tokens or bypassing unknown-copy identity requirements.

## Nine focused independent controls

These are new composed scenarios, not a rerun or copy of the author's 18 tests:

- Actual WebDAV with an opaque decorator omitting the permission declaration
  remains ENOTSUP beside a known-false sibling; an aggregate false flag must
  not replace the selected backend's missing declaration.
- Memory and native Real destination directories with actual execute denial
  reject a copy **after remote source metadata authorization, before any source
  data acquisition or destination mutation**. Two cases, no fake native errno.
- Explicit `access(1)` through an opaque read-only nested WebDAV view remains
  ENOTSUP, while its preceding `access(0)` succeeds.
- Real loopback HTTP **401** on source-directory reauthorization and **403** on
  destination-directory reauthorization preserve typed EACCES. The first
  PROPFIND for that directory returns 207; the *second*, access-zero probe is
  denied. Both cases require zero GET/PUT/COPY/MOVE and zero local data calls.
- Cancellation at that second authorization probe preserves the exact caller
  `FsError("ENOENT")` object as the transport signal reason and nested cause of
  ECANCELED. A subsequent pre-aborted operation returns that exact object and
  issues no request. No cancellation is mistaken for a missing directory.
- Truly opaque permissions-false composite views preserve a hidden symlink
  boundary (EACCES, no leaked copy) and hidden mount-root removal protection
  (EBUSY, no remote deletion). Two cases; the wrapper is verified not to be a
  `MountFileSystem` instance, so constructor flattening cannot supply the result.

Every negative phase retains backend bytes/namespace and has metadata-only
remote traffic. Native work uses one newly created temporary Real root with
cleanup; HTTP uses the existing loopback helper and injected mock, no external
service. The paired positive reads in the boundary controls run before the
negative-phase request log is cleared; no claim is made that setup uses no GET.

### Preserved initial control iteration

`evidence/frozen-59b1269-authority/` preserves **9 tests, 8 pass / 1 fail** and
typecheck exit 0. Its proposed symlink-boundary control observed ENOTSUP before
reaching the expected EACCES boundary because the mixed read-only wrapper's
global symlink capability is false. Also, proxying the mount instance directly
did not make the removal view genuinely opaque to constructor flattening.

The final fixture corrects those test-design problems: a plain-object forwarding
decorator is genuinely opaque; the symlink case omits the global symlink claim
(**unknown, not true**) and delegates the actual selected-path readlink. It
asserts one actual readlink before the original EACCES expectation. This does
not claim the default read-only mixed wrapper supports all symlinks. No expected
errno was broadened or relaxed, no source changed, and the original 43-case
fixture was never edited. Both new-control snapshots and raw runs are retained.

## Concurrent core-command work, separate observation

The moving-worktree snapshot observes HEAD
`be29e3822736472a26450182bb3987709238e0db` with concurrent uncommitted core files.
Its **33/43** result comprises **28/38 successful operations** plus **5/5 rejection
controls**. Source-set SHA-256:
`09284e401c99d562518d703425e843b34fcf4720984a3e2e691c9ab8e8299952`.
Its filesystem/mount source hashes equal the frozen fix, but core command files
and unrelated archive sources differ. This is **not clean-HEAD validation**.

Relative to frozen `59b1269`, the extra five successes are the three local moves
and missing-target S3/WebDAV cross-mount moves. Existing-target S3/WebDAV moves
still fail, alongside the eight unknown-overwrite copies. This leaves ten red
requirements. These additional gains belong to concurrent core-command work,
not the mount-only traversal fix. No red expected result was edited to obtain
them; no consumer/authority design is approved by this observation.

The worktree runner's legacy `revision` field remains its original `4fa4ba9`
comparison reference, **not the executed worktree source**. Interpret that
cohort using `mode: worktree`, its observed HEAD, status, and per-file snapshot
hashes. Frozen `revision` mode records the actual committed source revision.

## Replay and artifacts

From repository root, choose unused labels (existing evidence is refused):

```sh
node tests/fs/mount/identity-compatibility-review/run.mjs revision rerun-59-acceptance 59b1269
node tests/fs/mount/identity-compatibility-review/run.mjs revision rerun-59-authority 59b1269 traversal-authority.test.ts
```

The first returns 1 for the fifteen unmet compatibility requirements; the
second returns 0 for the nine negative controls. Each also runs scoped types.
New authoritative raw cohorts are `evidence/frozen-59b1269-compatibility/` and
`evidence/frozen-59b1269-authority-final/`. Moving observations are isolated in
`evidence/moving-traversal-followup/`. The audit records all 43 before/after
outcome transitions and zero previously passing-case regressions.

Only this review directory is owned. Production, contracts, existing tests,
sibling identity-authority review, and adapter-tools integration remain untouched.
No broad-FS gate, full closure claim, or evidence-denominator relabeling occurs.
Raw TAP retains Node's assertion-formatting whitespace; hand-authored file
whitespace checks pass. Final commit identity is in the `/tmp` root handoff.
