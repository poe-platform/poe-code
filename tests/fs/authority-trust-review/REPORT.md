# Independent first-fixed authority review

Independent leaf review, August 27, 2026 UTC. **No source edits, staging or
commits.** Only this new test/evidence directory is owned. Root receives the
handoff artifacts; no direct conversation with Poincare or Curie is claimed.

## Decision and provenance

The fixed closure supports the narrow faithful-forwarding behavior. It does
**not** establish arbitrary-provider completeness, race-proof copying, a host-JS
sandbox, or acceptance of the later public constructor callback.

All **165 author inputs / 156 source files** reconstructed from committed
`eab1d48a90456c1c2cdeb9289b32f1ed62429137` match both retained author manifests
in `1b0cbb96bebadb915809014207999799f4e9aa0c`. Source-set SHA256:
`fc3269f23944309ee92ff8ecfb3cae12654d19bdb3d8e41d26523ab54be39066`.
Required source ancestors: S3 `91d5926+d49d9e5`, DAV `8c863cd`, Memory
`d82cca9`, contract `cd8b5c8`, core `0bee8e7`.

The retained author scratch had been removed. Reconstruction used tracked bytes
only, not moving source or a worktree. Recorded dirty archive README/format
bytes were excluded by the author and by this reconstruction. No dirty input
was needed; this does not describe a globally clean checkout. The author's
dependency symlink is not reused: existing lock-version-checked dependencies
were copied once into regular files, hashed, and checked unchanged on cleanup.
No download or independent registry-tarball integrity verification was performed.

**Provenance exception:** the original43 fixture is unchanged from `d799cbb`
and prequalification `b02bbe8`, SHA256
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
Its sole test helper, `tests/fs/webdav/mock.ts`, is **not unchanged**:
`8c863cd` removes method-table registration and changes factory forwarding.
The helper exactly matches the author freeze, but the stronger requested
unchanged-fixture-and-helper claim is rejected. Both baseline/helper hashes
and the delta hash are in `evidence/session.json`; root was notified through
`/tmp/safe-bash-authority-review-provenance-question.txt`.

## Separately counted results

| Cohort | Pass / total | Fail | Skip / cancel / TODO |
| --- | ---: | ---: | --- |
| Unchanged original positives | 38 / 38 | 0 | 0 / 0 / 0 |
| Original controls, same invocation | 5 / 5 | 0 | 0 / 0 / 0 |
| New compliant positive/adverse test cases | 12 / 12 | 0 | 0 / 0 / 0 |
| Separate boundary characterizations, no acceptance credit | 2 / 2 | 0 | 0 / 0 / 0 |
| Original guards | 4 / 4 | 0 | 0 / 0 / 0 |
| Required guards | 49 / 49 | 0 | 0 / 0 / 0 |

Scoped TypeScript exits **0**. Complete-source declaration/build compilation
using the frozen supplemental `tsconfig.build.json` exits **0**. No global test
typecheck is claimed: the snapshot intentionally excludes unrelated tests.
No tar tests, benchmarks, whole-FS suite, or whole-package suite ran.

There are exactly **14 new top-level tests**, not 14 independent provider
implementations. Cases04/08/12 have paired backend/error-stage variants; alias
and byte/namespace assertions within a case are not extra counted tests.
Exact names, commands, hashes, outcomes and literal effects are in the cohort
JSON/TAP evidence. Expected bytes originate in the independent seeded constants;
no native utility oracle or result-derived expected-output file is used.

## What the new cases establish

- 01–04: opaque S3/DAV existing-target shell `cp` actually exits0; readonly
  source copying works. Shared backing and native hardlink aliases stay safe.
  Different actual maps remain distinct despite matching URL/bucket/key hints.
- 05: a truthful Real-backed DAV transport has unknown cross-protocol authority
  by default: both alias directions refuse ENOTSUP before GET/PUT. An explicit
  **existing FileSystem.compareEntry method** using actual native identities
  rejects aliases with EINVAL and allows a distinct existing-target copy. This
  is not the later constructor callback or automatic real-provider support.
- 06–07: fresh metadata binds the exact filesystem/path/stat. Cached S3 HEAD,
  wrong binding and copied stat cannot acquire private authority. DAV response
  cloning drops private authority; honest unknown refuses mixed overwrite.
- 08–10: late metadata/body EACCES propagates. Pending metadata cancellation
  reports ECANCELED and keeps files unchanged; pending streaming body cancellation
  preserves source/sentinels but leaves the already-open Memory destination empty.
  Both late rejections are handled under strict unhandled-rejection mode.
- 11–12: invalid/conflicting answers fail EIO, complete aliases dominate, and
  readonly destinations refuse EROFS before content acquisition.

These are point-in-time observations, not leases, ABA defenses or transactions.
Protected staging or authoritative native operations may offer other valid
implementation choices; they must still guard aliases, source preservation,
permissions and publication. An unknown existing target is not permission for
a truncating open. No general destination rollback guarantee is established.

## Boundary evidence and limitations

**B1** deliberately violates the declared namespace: private remote metadata,
but PUT writes to the local Memory source. It reports `distinct`, invokes PUT,
returns EIO, changes `source sentinel` to `damaged`, leaves remote bytes
`remote sentinel` and local `keep` unchanged. Passing this characterization is
**not** a compliant safety pass or justification for banning faithful transports.

**B2** faithfully routes content but copies SDK-like HEAD metadata. Comparison
is unknown; existing-target copy refuses ENOTSUP, preserving source and old
target. Generic serialized SDK authority remains **OPEN**. Default mocks passing
38 workflows do not close that gap. Historical original31/38, qualified38/38,
and earlier binding-violation damage remain unchanged, not relabeled successes.

Initial reviewer attempts are preserved as `*.prior-*`: 9/12 (two omitted async
Real-factory awaits and an overstrong cancellation reason-identity assertion),
then12/12, then11/12 while extending the Real/DAV case with a mock that had not
yet consumed streaming PUT bodies. These are reviewer fixture defects, not
product fixes. Cancellation normalization to ECANCELED is already documented in
the frozen S3 README; no contract promises caller-error object identity there.
The final mock consumes the actual upload and writes the same declared Real
backing. The first scoped type run reports15 reviewer diagnostics; final is clean.

## Reproduce and handoff

From the repository, use `node tests/fs/authority-trust-review/run.mjs MODE`,
in order: `original`, `provenance`, `review`, `types`, `guards`, `build`,
`cleanup`, `seal`. `original` creates a new isolated session; subsequent modes
reuse that one dependency copy. Do not run the test files directly against
moving root imports and call that a frozen replay. The type config is copied
to the snapshot root by the runner, not invoked in-place.

The runner bounds each child to120 seconds /4 MiB per output stream, records
residual-process checks, cleans its fixture directories, and removes its fixed
source/dependency/build scratch on cleanup. Only evidence remains here.
`MANIFEST.sha256` lists every owned commit candidate except itself; include the
manifest itself as well in any root-approved explicit-path tests-only commit.
Nothing is staged. Detailed handoff: `/tmp/safe-bash-authority-review-detail.txt`.
