# Approved S3 snapshot-marker profile — source author

Root's `ba200fe` contract handoff authorizes this implementation. Root decides
policy; this is no longer waiting on a separate Curie decision. No contract,
core, export, manifest, wrapper, WebDAV or matrix file is edited here.

## Stable source/configuration choice

Every S3FileSystem declares `capabilities.snapshotRmdir: true`; read-only S3
instances still refuse mutation. `atomicRename: false` and transport conditional
DELETE declarations do not change. No new constructor option, transport method,
permission API or runtime dependency is introduced.

Removal resolves the existing zero-byte trailing-slash marker, checks all
required pages with `MaxKeys = Math.max(2, pageSize)` and delimiter `/`, then
deletes only that exact key. The minimum is limited to removal inspection;
existing directory existence probes and other operations retain their policies.
The host must supply correct complete listings and exact-key deletion. An
explicit IsTruncated boolean is required for this destructive inspection;
truncated pages must provide valid nonrepeated continuation tokens. The marker
must be both HEAD-identified and present in the completed listing. No explicit
marker is ENOTSUP; an identified marker missing from the listing is ENOENT.

This avoids the exact-prefix MaxKeys=1 shortcut authenticated in `../list-oracle-review/`.
It does not certify arbitrary provider completeness or reinterpret HTTP200 as
proof. Original native MaxKeys=1 inputs and the original 19/20 remain immutable.

Observed children, including nested markers, remain ENOTEMPTY without DELETE.
Files, ambiguity, root, readonly, listing errors and cancellation retain typed
failures. A successful call means only successful exact-marker removal: late
children may keep the directory visible. No child deletion, batch operation,
rollback marker insertion, whiteout or post-delete ENOTEMPTY occurs. DELETE is
unconditional; replacement and same-content ABA can be affected. Issued-delete
failure/abort can have effects, including late completion by an uncooperative
host. There is no atomic emptiness, rollback or absent-at-return guarantee.

## Intentional fixture delta

`fixture-delta.json` preserves the complete original `tests/fs/s3/rmdir.test.ts`
and exact diff. Only three existing test scenarios change their success
expectations: the two conditionalDelete=false/true empty-marker cases, and the
post-LIST child race. The first two now require exactly one marker DELETE and
unchanged neighbors; the third requires success with the child unchanged,
marker absent and logical directory still visible. All original nonempty,
file/missing/root/readonly/cancellation/authorization assertions remain.

The additional 25 source tests cover minimum-two policy with pagination,
intermediate pages, incomplete/malformed/token/budget refusals, explicit-marker
ambiguity/disappearance, implicit-directory races, nested late children, ABA,
delete errors/response loss, abort before DELETE, abort during issued work with
and without completed effects, and uncooperative completion after cancellation.

Author source checks: **44/44 focused**, **269/269 other S3 regressions**,
**69/69 HTTP units**; **382 total**, zero failures/skips/TODOs. Scoped strict
types and an owned-output production build pass. Exact input hashes, dirty
source state and all command output are in `source-validation.json`. These are
precommit worktree checks, not a full product gate or deployed service result.
The wrapper owner separately handles the required 49 alias guards and broader
readonly/mount/overlay suites, profile propagation and matrix integration.

The prior 77/79 matrix is untouched and not rerun here. New service evidence
must use a frozen built/packed public package; the old service assertions are
not rewritten. Root's different-agent verifier remains separate.
