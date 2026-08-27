# S3 rmdir source-author feasibility checkpoint

AUTHOR evidence only. Production is intentionally unchanged pending the root /
Curie contract decision. This is not independent acceptance or a fixture waiver.

## Blocking semantics

The current `src/contracts/filesystem.md:8` requires removal of an empty
directory entry, ENOTEMPTY for nonempty directories, and preservation on those
failures. Lines 15–21 require emptiness enforced by removal rather than a prior
listing. Memory checks and removes synchronously; real delegates to native
directory-only rmdir; mount forwards to that operation; readonly refuses;
overlay forwards upper-entry removal before publishing its whiteout.

S3 represents an explicit directory by a trailing-slash marker and an implicit
directory by descendants. A complete empty LIST followed by DELETE of exactly
the marker preserves every child, but a child inserted between those operations
leaves the logical directory present. The marker has changed despite a nonempty
directory at deletion. Reporting success redefines logical-directory removal.
Reporting ENOTEMPTY after deletion violates preservation on failure. Another
LIST merely moves the race. Reinserting a marker is not a safe rollback and
could overwrite a concurrent replacement.

Minimum interpretation needed, NOT implemented or presumed approved: explicitly
allow **snapshot-empty explicit-marker removal**, with success meaning only
marker deletion, not logical-directory absence. Children created after LIST
survive and keep the implicit directory alive. Unconditional marker deletion can
also remove a concurrently recreated marker (ABA). Even a truthful object ETag
condition would not predicate prefix emptiness or distinguish same-content ABA.
This would be a deliberate contract relaxation, not an implementation of the
current requirement. A provider-coordinated removal-time emptiness primitive
would be the alternative, but is absent from the current public transport/API.
No permission API, callback sandbox, provider inference, or new runtime
dependency is proposed. Trusted callbacks remain trusted namespace bindings.

The separate read-only contract reviewer reached the same blocking conclusion.
The precise proposed exception below is submitted to root/Curie, NOT approved:

> An object-prefix backend may implement marker-only directory removal by
> checking for observed descendants and then deleting only its exact, explicitly
> identified directory-marker object. Observed descendants cause ENOTEMPTY
> without mutation. This backend-specific operation does not atomically enforce
> prefix emptiness: children created after inspection survive unchanged and may
> keep the logical directory visible after success. It must never delete child
> objects or an ambiguous file/prefix representation. Backend errors,
> cancellation, root protection and unsupported marker conditions retain their
> existing behavior. This exception does not provide marker-instance/ABA identity.

If approved, it requires cross-references in BOTH the nonempty rule and the
removal-time-emptiness rule. Adapter-only caveats do not amend those requirements.
Provider listing completeness remains an independent prerequisite, not promised
by this proposed exception or by the existence of an HTTP200 LIST response.

The existing S3 rmdir refusal remains unchanged: explicit empty => ENOTSUP;
observed nonempty explicit/implicit => ENOTEMPTY; file => ENOTDIR; missing =>
ENOENT; root => EBUSY; readonly => EROFS; abort => ECANCELED. There is no positive
product rmdir result to claim under the current interface. Legacy nonrecursive
rm is a different operation and is not substituted for rmdir.

Measured exception: the pinned MinIO service's MaxKeys=1 LIST returned only the
marker with IsTruncated=false despite an independently readable child. The
unchanged product therefore returned ENOTSUP, not required ENOTEMPTY, at
pageSize=1. The original assertion remains failing. Native page-size/delimiter
isolation and a separate default-page-size ENOTEMPTY control classify this as a
provider listing issue; no source/parser defect was established or patched.
See `REPORT.md` for all original cohorts and the final non-green 19/20 result.

## Reproduction

Run `node tests/fs/s3/rmdir-real-service/run.mjs --download`, or supply an
existing binary matching `tests/fs/s3/http/interop/service.lock.json`. The
historical MinIO pin is not a latest-version/security recommendation. The runner
freezes the actual committed source, builds and packs the real manifest, imports
only public package exports, and launches the existing independently signed
native-curl service harness. A separately unpacked consumer exercises Shell.

Only task-owned files are written. Two disclosed harness path substitutions
relocate historical `/tmp` output prefixes under this owned directory; provider,
signer, profile, fixture assertions and lifecycle semantics are unchanged.
Downloaded binaries, snapshot/build/consumer, service home and data are removed;
raw requests, result classifications, hashes and cleanup records remain.

The measured profile explicitly enables verified PUT, disables native COPY,
selects MinIO's recorded form list decoding, and leaves conditional DELETE
false. Native exact-marker positive controls and race counterexamples are NOT
product rmdir passes. Original adapter-tools 77/79 is neither rerun nor relabeled;
the matrix owner separately owns that evidence and its two outstanding cases.
