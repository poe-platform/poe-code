# WebDAV mount traversal: material source fix, compatibility still incomplete

## Decision and change

The original11 WebDAV mounted positive cases from independent d799cbb fail during mount path resolution, before the intended operation. The unchanged fixture SHA256 is `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`; its frozen4fa4ba9 report and all evidence remain untouched.

Root cause: `src/fs/mount/index.ts` unconditionally calls `backend.access(directory,1)`. Actual WebDAV explicitly declares permissions:false and rejects write/execute probes as ENOTSUP. Its existing access0 performs authorized PROPFIND; its actual read/mutation requests enforce provider authorization independently. The shared contract does not require the mount to manufacture portable execute checks for non-permission providers.

The two-line functional correction selects access0 only when the **selected backend** explicitly has permissions:false. True or absent permission capability retains access1. This is not the mixed mount's aggregate flag, an error-catching fallback, synthetic-mode authorization, a backend-name exception or a new trust flag. No WebDAV API behavior changed: explicit mounted X_OK/W_OK still returns ENOTSUP. Actual PROPFIND/GET/PUT/COPY/MOVE failures and caller cancellation propagate. No identity fields or comparison rules changed; no native/memory execute, chroot, symlink or mount-boundary check was removed.

## Fixed inputs and results

Baseline: fresh archive of actual initial HEAD21a6b9149e3a0e35e14f1c740860971f08053686. Its mount/WebDAV implementation retains the reported4fa traversal defect. Final verification freezes fresh actual HEAD37e19b773327a9e8b08d500a1280f3c4f4687adc, including Curie's independently committed core cp identity correction, then applies only this leaf's three owned file changes. Later concurrent commits are not silently included. Per-phase provenance contains full source/fixture hashes, exact commands, times, exits and worktree observations; source manifests are stable before/after every run. Node22.22.2 and existing development tooling; no new dependencies.

| Gate | Result | Meaning |
| --- | --- | --- |
| Original selected11, unchanged required-success assertions | 0/11 | all11 traversal failures reproduced |
| Final same11 | 5/11, six required reds | traversal repaired, not11 successful workflows |
| New focused regressions | 18/18 | actual mock/loopback, mounted tools, denials and cancellation |
| Scoped mount/WebDAV root backend test files | 515/515 | includes new18 and overlapping guard tests |
| Original immutable alias reproduction | 4/4 | byte-loss protection retained |
| Required immutable guard cohort | 49/49 |42mount+7overlay guards retained; overlay source untouched |
| Unchanged WebDAV shared conformance | 50/50 +2provenance |52/52 executed |
| Strict scoped types | exit0, no diagnostics | owned source/test entrypoints, transitive imports; not global typecheck |

All cohorts have zero skipped, cancelled and TODO cases. Do not sum overlapping denominators. No full-repo/all-FS, unrelated shell/curl, S3-policy or remote-cancellation suite ran. The full43-case independent compatibility suite was not rerun and its recorded18/38 positive acceptance remains historical, not rebaselined.

## Exact11 disposition

Five now succeed with the independent fixture's unchanged exact byte/namespace assertions:
- WebDAV one-mount copy to missing target.
- WebDAV separate-client mounts copy to missing target.
- Memory to WebDAV copy to missing target.
- WebDAV to memory copy to missing target.
- WebDAV same-mount rename replacing an existing target.

Six remain required failures, each with exact unchanged before/after snapshots and only PROPFIND operations:
- Four copies to existing targets (one mount, separate clients, memory-to-WebDAV, WebDAV-to-memory) now reach the actual unknown-identity guard and reject typed ENOTSUP. Before this change they failed earlier at traversal. The contract requires an authoritative safe same/distinct-entry guard before destructive existing-target publication. Do not invent per-client disjoint scopes, infer identity from paths/ETags, or bypass the guard. Curie/root own the remote-authority contract review referenced by6df52ef; no proposed API is assumed approved.
- Both separate-client cross-mount `mv` workflows (missing/existing target) now reach mount rename's EXDEV boundary. Core command mv still exits1 and leaves both namespaces/bytes intact on this final pin. Cross-mount consumer behavior remains Curie's task, not permission to make backend rename falsely atomic or add copy/delete here.

The detailed per-case old/new outcomes and verified no-effects classification are in summary.json. No existing success assertion was changed to expect rejection.

## Focused protection coverage

The new test uses the actual MockDav, including real loopback/global fetch, to require mounted cp to a missing target and same-mount mv to an existing target with exact status/stdout/stderr and bytes/names. Direct mounted missing/existing writes remain ordinary authorized operations: exclusive creation carries If-None-Match:*; ordinary `w` is not falsely described as conditional or transactional. Nested-directory PROPFIND denial, GET denial after successful metadata, missing/existing PUT denial, and shell COPY denial all preserve backing bytes. Access0 ENOTSUP/EACCES are propagated with original cause, never swallowed. Native Real and Memory actual execute denials remain effective even beside WebDAV in a mixed mount; unknown permissions still requests execute. Explicit remote execute/write probes remain unsupported. Missing/file ancestors retain ENOENT/ENOTDIR without mutation. Pre-abort preserves the exact caller reason (including ENOENT); in-flight authorization cancellation reaches the injected host signal and returns typed ECANCELED without mutation.

The initial candidate and final-named iteration logs are intentionally retained, not acceptance: a new author test incorrectly expected If-Match on ordinary overwrite PUT, first with default policy and then with irrelevant COPY/MOVE overwritePolicy:etag. Reading prepareWrite and the existing README established that plain `w` is an ordinary overwrite, while wx/append carry their documented conditions. The final verified test asserts the actual ordinary-write contract and exact bytes; no source workaround or old independent assertion was changed. Product correction stayed the same throughout.

## Handoff and replay

Only src/fs/mount/index.ts, its README, the new tests/fs/mount/webdav-traversal.test.ts, and this NEW evidence directory are committed. WebDAV product files are unchanged; no S3/contracts/commands/other-wrapper edits. Existing evidence, identity-compatibility-review and identity-authority-review are excluded from writes/staging. Root can now independently rerun the unchanged11; do not claim FS closure, global alias closure, solved existing remote overwrite or cross-mount mv.

To replay, create a fresh archive of each provenance.pin with the runner's exact archive path list, apply that phase's candidate.patch with apply_patch, verify manifest-before.json, attach the existing Node/tsx/TypeScript tooling and run commands.json with outputs in a fresh /tmp directory. Each historical phase keeps its own input pin. runner.mjs also supports SOURCE_REVISION for a fresh snapshot but must not be run into an existing phase directory. Raw output is byte-preserved; assertion-formatting whitespace is not normalized. The initial4fa independent report and d799cbb fixture are never overwritten. No own server or runner remains active after validation.
