# Independent mount identity compatibility review

Date: August 26, 2026, America/Chicago. Scope: this new review directory only.
No production, contract, existing-test, or other reviewer's file was changed.

## Verdict

**Compatibility acceptance remains RED.** On the fixed source there are **43
tests: 23 pass, 20 fail, 0 skipped, 0 todo, 0 cancelled**. Scoped typechecking
passes. Of those cases, **38 require successful ordinary operations: 18 pass
and 20 fail**. The other **5 are explicit, passing rejection controls**, not
successful compatibility workflows. No red success expectation was converted
to an accepted rejection or excluded from the denominator.

The alias repair preserves useful distinct-file copies for memory, shared
memory mounted twice, read-only/overlay/opaque source views, and separate Real
adapters sharing one native root. It does **not** establish ordinary remote
overwrite or cross-mount move compatibility. No source fixes were made here.

## Frozen provenance

- Source: `4fa4ba9502dac843bd13aa5031d128a3171f597d`.
- Author evidence reference: `0db472ad`; not counted as this review's tests.
- Authoritative contract: `fa539de61ea2280cdaeaccf7bbf5c76d34e0e4f4`.
- Contract Markdown SHA-256:
  `13d82a1a15d9b86370cd54c904608e8eed37da63e5ce05e754dc6e53f0ff821e`.
  The runner verifies equality between that contract revision and the source
  snapshot before executing tests.
- Frozen archive: `evidence/pinned-final/source-4fa4ba9.tar.gz`; SHA-256
  `2cb5b02d9d2fa802fba6b20ff3986b7a76f1026d29528c5781bb3c81cb96f87b`.
- Manifest source-set SHA-256:
  `01618dbf95c03aca3dc1bbc15e12182cf572e929c83be239a7056d4afc45ab48`.
- `src/fs/mount/index.ts` SHA-256:
  `192ada25798791dcb7cf6c3f323ba3a64b814c75e749ae1cea13937de238ccc7`.
- `src/fs/mount/identity.ts` SHA-256:
  `a561928d082232d034c436a89a63b85e5f137c82879281adc9f6aacfcb54d2d2`.
- Final test SHA-256:
  `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
- Runtime: Node `v22.22.2`, existing `tsx`/TypeScript development installation;
  zero new dependencies. The archive contains all `src`, package metadata,
  TypeScript configuration, and the existing WebDAV mock, not moving sources.
- Every source file's SHA-256, exact command, timestamps, exit codes, and
  concurrent worktree status observations are in each cohort's `manifest.json`.

## Counts and evidence

| Disjoint final cohort | Tests | Pass | Fail |
| --- | ---: | ---: | ---: |
| Memory / native Real / wrapper controls and moves | 12 | 9 | 3 |
| S3 workflows, alias control, default-rename limit | 16 | 10 | 6 |
| WebDAV workflows and alias control | 15 | 4 | 11 |
| Total | 43 | 23 | 20 |

`evidence/pinned-final/tests.stdout.tap` is the complete raw TAP run;
`observations.json` retains all 43 cases with actual before/after bytes,
directory entries, operation outcomes, and remote method/key traces.
`types.stdout.txt` and `types.stderr.txt` are empty with typecheck exit 0.
The test process exits **1**, as required for the unsatisfied positive cases.
The independent evidence audit in `evidence/audit.json` rechecks archive/test
hashes, the 38/5 denominator split, and unchanged snapshots for all 20 failures.
Source, runner, and report whitespace checks pass. Raw TAP intentionally keeps
Node's whitespace-only assertion-formatting lines, which `git diff --check`
flags when raw evidence is included; the captured output was not rewritten.

Initial evidence remains separate in `evidence/pinned/`: **42 tests, 22 pass,
20 fail**, typecheck exit 0. One initial WebDAV alias-control setup failed at
`mount.stat` before it could observe the copy. The final test reads identity
from the actual remote backends and explicitly records that traversal can
reject before identity comparison. One shared-memory cross-mount move case
was also added. Initial and final test snapshots are preserved as `.ts.txt`;
this is a test-harness correction plus an added case, not a source repair.

`evidence/worktree-final/` is a **separate moving-worktree snapshot**: again
43 tests, 23 pass, 20 fail, typecheck exit 0. Its observed HEAD was
`5ddce1b0550ad7de8f2a8082f0402fae7aa001b7`, with concurrent uncommitted work.
Its source-set SHA-256 is
`ed9fa5cb4e830dea39ff7c15d412eb5dd688a5198796385402da14278f49aa28`.
Filesystem and contract hashes match the pinned cohort; shell, aggregate,
package, archive, and table-text sources differ. This is not clean-HEAD
validation, and the repeated 43 cases are not 86 independent tests.

## Blocker 1: existing unknown-identity overwrites

**Four S3 required-copy cases fail with typed `FsError.code === "ENOTSUP"`:**
one mount, separate clients of one bucket/prefix on two mounts, memory-to-S3,
and S3-to-memory, all with an already existing distinct target.

Exact single-mount reproduction is the test named
`REQUIRED s3 one-mount copy, target existing`: create actual `S3FileSystem`
with the capable `MockS3Client`; write `/source` as
`[0,255,128,13,10,65,66,67,0]` and `/target` as `[79,76,68,255]`; wrap it in
`createMountFileSystem({ root: backend })`; call
`mount.copyFile("/source", "/target")`. Expected: source unchanged, target
replaced by source bytes, both names retained. Actual: ENOTSUP, both unchanged.
The paired direct `backend.copyFile` overwrite succeeds using `copyObject`.

`src/fs/mount/index.ts:420` rejects unknown existing identities before the
same-mount native-copy delegation. `evidence/history.txt` preserves the exact
`4fa4ba9^..4fa4ba9` diff: this checkpoint moved that rejection above the
same-mount branch. Thus same-mount S3 overwrite is a compatibility restriction
introduced by this checkpoint relative to its parent. Cross-mount unknown
overwrites were already rejected in the parent; do not label every failure a
new regression at this checkpoint.

For WebDAV the source has the same generic unknown-identity restriction, but
the actual mounted workflows fail **earlier**, at Blocker 2. Their failures
are not dynamic proof that the identity gate ran.

## Blocker 2: actual WebDAV cannot traverse the mount

**Eleven required WebDAV workflows fail**: eight mounted copies (same-mount,
separate clients, memory-to-WebDAV, WebDAV-to-memory, each missing/existing
target), one same-mount rename overwrite, and two cross-mount shell moves.

`src/fs/mount/index.ts:212` calls `backend.access(directory, 1)` while walking
paths. `src/fs/webdav/webdav.ts:815` rejects execute/write permission queries
with ENOTSUP because it cannot safely claim portable permission enforcement.
Raw copy/rename causes identify `access write/execute permission checks '/'`;
their remote trace consists only of root PROPFIND. No source GET or destination
PUT/COPY/MOVE occurs. Shell moves fail during target stat before rename.

Exact reproduction: use `WebDavFileSystem` with the existing `MockDav.fetch`,
base URL `https://compatibility.invalid/dav/`, default lock policy, and seed
the same `/source` bytes. `createMountFileSystem({ root: backend })`
`.copyFile("/source", "/target")` fails even when `/target` is missing.
Direct backend COPY to a missing or existing distinct key succeeds; direct
MOVE overwrite also succeeds, using LOCK/MOVE/UNLOCK for the existing target.

History pins mount traversal to `81ba2feb` and the WebDAV access restriction to
`a5d68b97`: this is a pre-existing interoperability blocker, not an identity
repair regression. No permission method was stubbed, relaxed, or relabeled to
make tests pass. Root must reconcile traversal requirements with actual remote
capabilities without pretending WebDAV enforces native execute permissions.

## Blocker 3: shell cross-mount moves lack a fallback

**Five required moves reach EXDEV and fail:** independent memory stores with
missing/existing target, the *same* memory backend mounted twice with an
existing distinct target, and separate S3 clients of the same bucket/prefix
with missing/existing target. Both WebDAV move cases fail earlier as above.

Reproduce with `new Shell({ fs: mounted(left, right) }).use(standardCommands())`
and `shell.exec("mv /left/source /right/target")`. Expected successful move:
target receives payload, source entry disappears, unrelated names unchanged.
Actual exit status is 1 and both byte contents and namespaces remain unchanged.
These tests assert command success rather than treating stderr as an errno
serialization protocol; raw stderr is retained as human-readable evidence.

`src/fs/mount/index.ts:400` correctly retains its declared cross-mount rename
boundary; `src/commands/filesystem.ts:153` invokes rename without a cross-device
copy/delete fallback. Both predate this repair (`81ba2feb` and `01c9a0f1`).
The product-level missing move behavior is not a demand to make filesystem
rename falsely atomic or to erase mount boundaries.

## Supported defaults, preconditions, and honest tradeoffs

- Six distinct-existing-file copy controls pass: independent memory, shared
  memory mounted twice, read-only/overlay/opaque source views, and separate
  native Real adapters sharing one root. Real uses the agreed process-wide
  `Symbol.for("virtual-bash.fs.native")`, not per-instance disjoint tokens.
  Destination views are writable; this does not cover every overlay copy-up.
- Direct S3 copies to both missing and existing distinct keys work by default
  with the capable injected mock. Mounted S3 missing-target copies also work:
  same-mount server copy or cross-mount GET/PUT streaming. Mixed memory/S3
  missing-target copies work in both directions. Exclusive-create capability
  is required; no claim is made for a transport that cannot honor it.
- Direct and same-mount S3 overwrite rename work only with
  `allowNonAtomicRename: true` plus the mock's conditional destination and
  conditional-delete capabilities. The default rename is intentionally
  ENOTSUP before any remote request; that fifth negative control passes.
  Opt-in rename remains non-atomic copy/delete; ETags are not incarnation
  identity, snapshot isolation, or proof against ABA.
- Direct WebDAV COPY/MOVE distinct-key controls work with default destination
  locking against the existing mock. A real provider must support the required
  protocol operations. No production endpoint was contacted and these tests
  do not establish real-provider locking or interoperability.
- Separate S3 transport-client objects share one mock service, bucket, and
  prefix; separate WebDAV fetch clients share one endpoint/root and mock store.
  Both adapters correctly omit identity scope. Equal data or textual remote
  addresses do not become authoritative identities.
- Opaque local/native aliases are rejected with exact EINVAL and unchanged
  bytes/namespace. Opaque remote aliases return exact ENOTSUP without data I/O;
  WebDAV's rejection is traversal, **not demonstrated identity comparison**.
- All 20 failed required workflows retain the exact initial bytes and complete
  directory-entry snapshots. That is useful fail-closed behavior, not success.

The contract does not allow inventing disjoint tokens for two clients that may
share storage, nor treating incomplete identity as proof of distinctness.
Restoring ordinary overwrite needs an authoritative backing identity or an
explicitly negotiated safe backend-native guard; arbitrary `copyFile` method
presence is insufficient. Missing-target exclusive creation remains a useful
supported default. A safety-only green suite cannot satisfy user acceptance.

## Reproduction and ownership

From the repository root, with its existing development dependencies:

```sh
node tests/fs/mount/identity-compatibility-review/run.mjs pinned
node tests/fs/mount/identity-compatibility-review/run.mjs worktree
```

Each command returns 1 while required compatibility cases remain red, writes a
fresh uniquely named evidence directory, and runs scoped TypeScript checking.
An optional third argument supplies a new evidence label; existing labels are
refused rather than overwriting raw evidence. The runner extracts/copies into
owned `.runs/`, loads no moving source during the pinned cohort, and deletes
only its own scratch directory. Real operations use an isolated newly created
temporary root with cleanup. Remote tests use only injected existing mocks.
The saved scoped-tsconfig records the actual ephemeral snapshot path; rerun the
runner to regenerate it rather than using that deleted path directly.

These intentionally red tests also remain visible to the repository's ordinary
test discovery. There are no skip/todo markers or capability-based exemptions.
This review does not duplicate the other leaf's original/required/mutation/full
filesystem gates, certify complete compatibility, or claim product superiority.
Commit identity is supplied in the final `/tmp` handoff rather than embedded
self-referentially in the commit being described.
