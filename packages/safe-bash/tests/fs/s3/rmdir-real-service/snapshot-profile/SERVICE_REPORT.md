# S3 snapshot rmdir: source and service handoff

August 27, 2026. **AUTHOR evidence**, not root's different-agent acceptance.
Root authorized the profile in `ba200fe`; there is no pending policy blocker.
No WebDAV, wrapper, contract, core, export, manifest or matrix edit is included.

## Stable source

Source commit: `5660248b1ff89572a6164d0b0c7bd22d03630d9b`.
`src/fs/s3/filesystem.ts` SHA256:
`9ac11951d681db45cee474568ca46d227cfb5bbd9b0d5ce2d6c176d0c4f94833`.
Source is unchanged from that checkpoint at final inspection.

The public `snapshotRmdir: true` declaration accompanies exact explicit-marker
removal. Inspection requests `Math.max(2, pageSize)` keys, including when callers
configure pageSize=1; other operations retain their existing request policy.
It requires a HEAD-identified zero-byte marker, complete valid pagination with
explicit IsTruncated, and the marker in the completed listing. Any observed
descendant/nested marker fails ENOTEMPTY without deletion. Missing/implicit/
ambiguous representations, roots, files, read-only and cancellation retain the
documented typed behavior. There is one exact-marker DELETE and no batch,
recursive fallback, child cleanup, marker reinsertion or compensating whiteout.

The minimum-two policy avoids the pinned source's one-key exact-prefix shortcut;
it does not certify arbitrary provider completeness. A successful marker removal
can leave a logical directory through late children. Unconditional replacement
and same-content ABA remain possible. Issued DELETE errors/cancellation can have
effects. Neither atomic emptiness, rollback nor absent-at-return is promised.
`atomicRename: false` remains; verified conditional DELETE is not enabled.

## Checks and cohorts

- Source worktree: 44/44 focused (19 intentionally updated existing cases plus
  25 new), 269/269 other direct S3 regressions, 69/69 HTTP units: **382 total**.
  Strict scoped types and owned-output build pass; no input changed during them.
- Corrected frozen package run: build, scoped types, npm pack/unpack and the
  same focused 44/44 pass. Those 44 are a replay subset, not additional coverage.
- New actual service: **20/20 observations, exit 0**, including **four positive
  public workflows**. Other observations separately cover guards, races, errors,
  cancellation and an unsupported native condition; they are not twenty
  successful rmdir workflows.
- Offline primary-source/signature audit: 4/4, authenticating the retained
  original 68 native requests and six pinned source blobs. No service rerun.
- Final offline package reproduction: exact accepted tarball hash reproduced,
  inside-consumer module hashes verified, zero service launches/downloads.

Wrapper/49-alias checks belong to the separately assigned owner. Root relayed
wrapper commit `0487969` and a separate unchanged-fixture 78/79 matrix observation,
with stock WebDAV rmdir remaining. Those are not author executions here. Original
77/79 and prior 19/20 remain separate, unchanged evidence, not rebaselined green.

## Actual service boundaries

Accepted run: `evidence-bDQayH`, frozen complete source HEAD
`ab7cce5b8ae3ba88012f4ec682cf9a65b32fb2f7`; no live/frozen input differences.
Its S3 source equals `5660248`. Service is the original pinned MinIO Community
RELEASE.2025-09-07T16-13-09Z / commit
`07c3a429bfed433e49018cb0f78a52145d4bedeb`, Darwin ARM64, official binary SHA256
`7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`.
The existing service/reference-signature harness and exact version/hash checks
are reused with owned output-prefix relocation, explicit loopback, synthetic
credentials, fresh bucket/data, form LIST decoding, verified PUT and disabled
native COPY. Effective guarded-copy fallback remains separately declared by the
existing transport. Conditional DELETE remains false.

Four positive public workflows use the actual unpacked root/S3/HTTP subpaths:
1. API mkdir/rmdir removes the zero-byte explicit marker.
2. Shell mkdir/rmdir returns exit 0 and removes only its marker.
3. Shell mkdir/rm -d returns exit 0 and removes only its marker.
4. A printf/tee/cat pipeline preserves bytes `[0,255,128,10]` through VFS and
   stdoutBytes. After separately requested removal of its named file, a
   printf/rmdir pipeline removes the marker with exit 0.

Independent native GETs verify exact bytes or marker absence. This is observed
absence in quiescent controls, not an absent-at-return guarantee under races.
55 native requests are retained, not counted as 55 tests. Product trace has nine
rmdir marker DELETE attempts: eight HTTP204 and one authorization HTTP403. A
tenth DELETE is the explicitly requested pipeline-file rm, not rmdir child
cleanup. Two HTTP204 marker effects are followed by caller-visible errors, below.

Guard observations retain file ENOTDIR, missing ENOENT, root EBUSY, implicit/
explicit nonempty ENOTEMPTY, ambiguity ENOTSUP, readonly EROFS and cancellation
ECANCELED. Configured pageSize=1 now actually sends two keys for inspection and
returns ENOTEMPTY for the known marker+child; default-size control also passes.
This changes the request policy, not the old native one-key expected result.
No new native MaxKeys=1 claim is made; the authenticated original false-complete
response remains a known provider deviation.

After a real complete LIST, a trusted forwarding hook inserts a byte child,
nested marker and nested byte child with independently signed requests. Public
rmdir succeeds, deletes its marker and leaves all three descendants intact;
public stat still sees the logical directory. The ABA control removes/recreates
the same marker with changed metadata and equal ETag before the product DELETE;
the replacement is removed, explicitly demonstrating the limitation.

Actual DELETE with deliberately incorrect synthetic credentials returns403;
the adapter returns EACCES and the marker remains. Abort after an actual LIST
prevents DELETE. Abort after the issued DELETE's HTTP204 callback returns
ECANCELED while native GET confirms the marker is already gone. The response
callback is forwarded before abort injection. A separate, clearly synthetic
host response-loss error after actual HTTP204 returns EIO without reinsertion
or retry. Source tests additionally cover uncooperative host completion after
cancellation, incomplete pages, budgets, malformed keys and error causes.

Native stale If-Match still returns204 and deletes the guard object, not the412
needed to verify the condition. No conditional DELETE guarantee is inferred.

## Provenance erratum: new 9/20 versus original 19/20

`evidence-6zhLg6` is preserved **9/20, exit 1**, with its exact original runner,
checks and source/file manifests. The API failure stack directly names
`/Users/kjopek/Workspace/safe-bash/dist/fs/s3/filesystem.js`, proving this new
attempt executed shared repository dist instead of the newly packed S3 module.
It is a harness execution-provenance failure, not a source566 regression cohort.
Building/packing the right source did not establish which package was imported.

The defect was **not introduced solely by the new generator**. The sealed
original runner in `../evidence-1D1P9B/author-inputs.json` and the new failed
runner both place service-checks.mjs under an owned scratch/consumer directory
inside the repository, unpack virtual-bash beneath consumer/node_modules, and
omit a consumer package.json boundary. Their archive/package.json is a sibling,
not the consumer's ancestor. Recorded root manifests name/export virtual-bash;
the original Git tree contains no intervening tests/fs/S3 package boundary.
Node package self-reference therefore applies to this layout. The corrected
run records a before-isolation resolution to shared repository dist with the
unpacked package already present, reproducing the mechanism without service I/O.

The original 19/20 did not retain resolved product-module URLs or loaded shared
dist hashes. Its layout has the same provenance defect, but we cannot now
authenticate the exact shared-dist bytes it executed or claim a hypothetical
corrected product outcome. Do not treat the old build/tarball manifest or
factory-identity assertion as packed-source execution proof. Its raw outcomes
and assertions remain unchanged; its native independent curl/signature/namespace
proof is unaffected. This qualifies product-source certainty only, not the
authenticated MinIO LIST deviation or the separately owned matrix harness.

The corrected runner writes a distinctly named consumer package.json before
loading product code. Inside that consumer, import.meta.resolve records the
root, S3 and HTTP subpaths; the runner asserts all three exact URLs under the
unpacked package BEFORE download/service launch. Factory identity remains an
additional check, not the provenance test. The packed S3 implementation hash
also matches the isolated build before launch.

Accepted tarball SHA256:
`22e0b39c778c061588d1b1f7fd44ecf62fac408284e90aa199941e3fe60407f6`.
Accepted compiled S3 SHA256:
`8a29148a5e41ed27087cd9784c564623b73d9c6c79f52ec2710db0cd29fba680`.
`package-proof.json` independently reproduces that exact tarball without MinIO
and reads root/S3/HTTP/implementation hashes from within a newly isolated packed
consumer. All match build artifacts and the recorded compiled S3 hash. These
additional module hashes are offline corroboration, not retroactively labeled
runtime captures from the accepted service. Actual runtime URLs and the compiled
S3 hash are already in `evidence-bDQayH/public-resolution.json`.

## Cleanup and limits

Both new MinIO children exited0; owned home/data, binaries, source/build/consumer
trees and npm caches were removed, including after the failed9/20 attempt.
The offline package audit also removes its owned tree. No root dist, ambient
credentials, external bucket, private package or global TLS/environment state
was modified. Only public-source/doc downloads accompanied the earlier audit;
two new binary downloads were required for the failed and corrected new proof,
and no further service download/run was used for provenance corroboration.

`SHA256SUMS` seals this entire profile directory except itself; original seals
are unchanged. Raw HTTP CRLF and service whitespace remain byte-exact, so a
broad whitespace checker may flag raw evidence; code/docs checks are separate.
This is bounded source-author acceptance of the disclosed profile, not provider
certification, universal parity, full-gate success or root independent review.
