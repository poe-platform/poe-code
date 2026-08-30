# Atomic empty-directory extension: author feasibility, not product support

Root policy decision pending. Only this new test subtree changes. Production,
contracts, exports, mocks, independent fixtures and earlier evidence are read-only.
No new constructor field, public factory, Shell integration or product fallback is
implemented. Stock `WebDavFileSystem.rmdir` still returns ENOTSUP for an observed
empty collection. This is **not** a correction of the original 78/79 provider matrix.

## Primary semantics and preserved counterexample

RFC4918 section 9.6.1 and legacy RFC2518 section 8.6.2 require collection DELETE
to behave at infinite depth and prohibit a client from submitting another depth.
Consequently `Depth: 0` cannot request a portable empty-only collection deletion.
The DELETE operation covers members, not just the collection entry. Neither an
empty PROPFIND observation nor a DAV lock changes DELETE into native rmdir.

Primary documents (official RFC Editor, re-read August 27, 2026):

- `https://www.rfc-editor.org/rfc/rfc4918.html#section-9.6.1`
- `https://www.rfc-editor.org/rfc/rfc2518.html#section-8.6.2`
- Lock authorization context: RFC4918 sections 6.4, 7.4 and 7.5. A token is not a
  replacement for the caller's access rights; collection membership changes must
  respect the applicable locks.
- Node primary documentation: `https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisesrmdirpath-options`.
  The fixture invokes `node:fs/promises.rmdir(path)` with **no recursive option**.
  Actual effects, rather than an assumed errno from documentation, are recorded.

Previously retrieved complete RFC text hashes remain recorded in
`../rmdir-real-service/evidence/primary-corrected/sources.json`:

| Primary text | SHA256 |
| --- | --- |
| RFC4918 | `619ad705b4c0e26af2d0652bb48ca1fa9bd080546993d46730d604b9fe2bdf25` |
| RFC2518 | `64edb8d7a9a9a2fb1fbbfe131a600cde15b22f4f746f1e57eccfdbdf0ee8f63f` |

The immutable earlier native-writer loss is in
`../rmdir-real-service/evidence/feasibility-final/apache/feasibility.json` (also
observed in its `feasibility-first` cohort): genuine exclusive/write/infinity
LOCK, empty protected listing, native child bytes `00ff80410d0a`, followed by
token-authorized DELETE 204; directory and child both disappeared. That raw
counterexample was not a public rmdir call. Root rejects that algorithm as the
default. This proof does not rerun, overwrite or reinterpret those twelve-row
cohorts, the earlier Apache/WsgiDAV matrices, or the independent review.

## Concrete test-only service

`server.mjs` is an actual Node HTTP server and filesystem operation, not a DAV
mock or a fabricated success callback. Its only request-side mutation is native
`rmdir`; there is no request-side readdir, recursive deletion or unlink. Witness
reads and recursive **cleanup** are separate harness operations on the owned root.

`run.mjs` supplies a complete literal configuration at runtime: a newly created
owned root, numeric `127.0.0.1` ephemeral port, fixed endpoint
`/_test/atomic-rmdir`, declared `/dav/` namespace, synthetic bearer principal and
`/allowed/` policy. Each baseline records the actual port, root and root device/
inode. No placeholder hostname, ambient credentials, external requests, service
downloads, dependencies, subprocess server, HOME writes or global changes occur.
The `/dav/` mapping is a fixture declaration, **not an implemented DAV endpoint**.
This is not evidence of Apache/WsgiDAV sidecar registration or packaged Shell use.

HTTP is deliberately limited to synthetic loopback testing; the product's existing
HTTPS-only Authorization/Cookie policy is untouched. The client has one fixed
endpoint, does not follow redirects, bounds request/response bytes and deadlines,
and propagates abort. No path chooses a new URL, credential or native root.

The service verifies exact Host, method, endpoint, operation, configured namespace,
authenticated principal, canonical path and path grant. It rejects unknown body
fields, root deletion, dot/empty/backslash/control-character segments, observed
ancestor symlinks, final symlinks and files. JSON paths are not URL-decoded: literal
UTF8, percent and space names work. It verifies observed root device/inode before
walking. Those observations are safeguards, not leases or race-proof confinement.

Fixture requests are serialized as one namespace queue. Immediately before calling
rmdir, a synchronous in-process policy table checks path/parent token scope,
principal and expiry. A correct synthetic token succeeds; missing/wrong/expired or
wrong-path tokens preserve the directory. This is **not** a DAV LOCK implementation,
lock parser regression, real-provider lock database, or cross-process exclusion.
`If` and `If-Match` are explicitly refused, never silently ignored or fabricated.

## Proposed integration shape — NOT exported or implemented

`proposal.ts` contains exact standalone TypeScript request/result/error/binding
interfaces. A possible future *WebDavFileSystemOptions* field, subject to root's
handoff, is `atomicEmptyDirectory?: ProposedAtomicEmptyDirectoryBinding`.
It is a namespace-bound operation closure, not a boolean trust/capability flag:

```ts
interface ProposedAtomicEmptyDirectoryBinding {
  readonly namespaceUrl: string;
  readonly removeEmptyDirectory: (
    request: {
      readonly operation: "atomic-empty-rmdir/v1";
      readonly namespaceUrl: string;
      readonly path: string;
      readonly signal?: AbortSignal;
    },
  ) => Promise<{
    readonly operation: "atomic-empty-rmdir/v1";
    readonly namespaceUrl: string;
    readonly path: string;
    readonly outcome: "removed";
  }>;
}
```

Minimal integration decisions for root:

1. Adapter supplies its actual configured canonical namespace, normalized virtual
   path and invocation signal. It retains the original caller path for typed
   `FsError` reporting and enforces root/preabort protection. No invented inode,
   ETag, identityScope or unrelated-client distinctness assertion is supplied.
2. Trusted host binds the closure to that actual namespace's backing storage,
   one explicit endpoint/origin, separate explicit credentials and a server-side
   authenticated principal. Server canonicalization and principal authorization
   must apply to the same backing operation, not metadata from a different root.
   Unknown mappings/aliases must refuse. A host callback may invoke a local
   primitive instead, but must satisfy the same namespace/authorization requirements.
3. Server must provide actual empty-only native/provider removal and either stable
   trusted ancestor configuration or a race-safe descriptor-relative facility.
   It must integrate with the provider's real access controls and applicable lock
   manager. Lock validation, expiry and membership mutation must share the provider's
   transaction/serialization boundary, including aliases and other workers. An
   unrelated sidecar mutex or this fixture's policy table is insufficient.
4. Host closure owns provider-specific lock acquisition/token handling if required;
   the public rmdir caller has no token parameter. Validate actual grants, preserve
   access rights, cancel cooperatively, and finally release only locks it owns.
   No adapter reuse of recursive DELETE or pretend UNLOCK success. The fixture
   acquires no DAV locks and makes no real-provider cleanup claim.
5. Adapter checks returned operation/namespace/path/outcome exactly; success means
   the native empty-only operation completed. This prevents mismatched protocol
   responses, but cannot prove honest physical binding or undo wrong-server effects.
   Configuration must establish that binding before dispatch. No arbitrary callback
   result, echoed identifier or fake per-client token proves filesystem identity.
6. Map native ENOTEMPTY/ENOTDIR/ENOENT and access/root/IO errors to their typed
   meanings. Fixture EAUTH/EACCES map to EACCES, lock conflict to EBUSY, expired
   condition to EAGAIN, wrong binding/unsupported guarantees to ENOTSUP, malformed
   success to EIO. Do not collapse unknown errors into ENOENT or success. Preserve
   causes and cancellation. Exact mapping/API naming remains root's decision.
7. The only atomic predicate promised here is removal-time emptiness. If callers
   need an ETag or target-inode precondition, the server must atomically enforce it
   with the removal; a preflight stat is not sufficient. This fixture refuses
   those conditions. No automatic retries on ambiguous network failure: operation
   may have completed and the pathname may now identify a replacement.

There is deliberately no product-constructor example using the proposed field.
The existing public constructor takes baseUrl/fetch/headers/limits/timeout,
overwritePolicy and compareEntry; it does not accept this capability. The proposal
does not require a new generic filesystem contract, export or permission API, but
that architectural decision belongs to root.

## Measured cohorts and unchanged failures

Rows and native witnesses are captured even if assertions fail. Counts are row
counts, not individual HTTP exchanges; each complete cohort sends 37 requests.

| Cohort | Positive pass/fail | Guard pass/fail | Refusal observed/failed | Limitation demonstrated/failed |
| --- | --- | --- | --- | --- |
| first, unqueued | 3/1 | 19/0 | 1/0 | 2/0 |
| serialized, **patch had not applied** | 3/1 | 19/0 | 1/0 | 2/0 |
| serialized-applied | 4/0 | 19/0 | 1/0 | 2/0 |
| final | 4/0 | 19/0 | 1/0 | 2/0 |
| final-replay, unchanged final inputs | 4/0 | 19/0 | 1/0 | 2/0 |

The second directory's name is misleading and intentionally preserved: a shell
patch-format error left its server/runner hashes identical to `first`; it is not
serialized evidence. Both initial cohorts observed two concurrent native rmdir
calls resolving successfully for the same path, contrary to our one-success/
one-ENOENT assertion. We retain both actual 200 responses and the failed oracle;
we do not generalize host-native behavior or loosen the assertion. A fixture-only
queue subsequently makes our requests execute sequentially, giving 200 then 404.
`first/inputs` freezes both initial cohorts' identical fixture inputs;
`serialized-applied/inputs` freezes the changed profile. Final cohorts additionally
snapshot their inputs automatically and harden finally cleanup; no assertions change.

Positive rows: empty, UTF8/percent/space, fixture lock-authorized, serialized
concurrent removal. Guards: existing/late binary child, file/final/ancestor symlink,
root/missing/auth/path grant/namespace/Host/canonicalization/operation/method,
token scope/expiry and pre/in-flight abort. Refusal: unsupported atomic conditions.
The two limitation rows are **not product-support positives**.
On disconnect rows the server's recorded `status`/`result` is its intended local
completion, not a received wire response: `disconnected: true` accompanies a
rejected client request. In particular, the late-abort 200 was never delivered.

Final source baseline HEAD was `4c16d9c5a0e8661bc326a754205559a3e7ea6a32`;
the repository advanced concurrently while inspected WebDAV source stayed fixed.
Complete per-cohort heads, package export map and unrelated worktree state are in
each baseline. Key final SHA256 values:

| Input | SHA256 |
| --- | --- |
| Unchanged `src/fs/webdav/webdav.ts` | `d61d6d36eeea65f0c7e6eb5ecbe118e353ffe5a87131e4e26c1a3d772ee71acf` |
| Test HTTP/native server | `6c9999e8b06232e9819a32717d8c481f80db9b56e9cdde3c7dee5cd7b5714bfe` |
| Final runner | `bb36d7a7c8933eb9152683f5d0e9e639456f97bac6e53ea177d393637c48ab64` |
| Proposed types, not public API | `309cd356bf9817cb010c387a2ae1e72421f2f87e720c3d04c15982ec9ba4176e` |
| Serialized profile | `dfdf5ed06b0331777e495f3f37fede656be99da58f494f223251bc4c83b60128` |
| Node v22.22.2 binary, Darwin arm64 | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |

## Limits that remain even when every assertion passes

- A native child created after JS checks but before rmdir causes actual ENOTEMPTY,
  preserving bytes. No lock or JS timer supplies that safety; native rmdir does.
  This deterministic interleaving is not an exhaustive stress test of every OS.
- Native writers may still create/delete/rename entries, replace ancestors or
  change permissions outside the queue. Stable trusted parents are an assumption.
  JS realpath/lstat checks cannot confine hostile parent-symlink swaps. A protected
  root descriptor plus descriptor-relative/no-follow operations or equivalent
  provider facility is needed for that stronger claim, not another path check.
- Actual target replacement after validation is demonstrated: the original empty
  directory is renamed away, a replacement is created, and rmdir removes the
  replacement. No target-inode compare-and-delete or ABA defense is claimed.
  Root inode checks similarly have a check/use gap; root replacement is not tested.
- Stable final symlinks are refused; there is no permission to follow aliases or
  infer namespace equivalence. Bind mounts and cross-provider mapping are untested.
- Preabort sends no request; observed disconnect before syscall prevents mutation.
  A disconnect after successful rmdir cannot roll it back. Abort during the
  uncancellable native syscall has an unknown outcome until separately observed.
- This fixture cannot safely bypass locks/ACLs of a separately running DAV server.
  Actual integration and independent acceptance remain unimplemented/unmeasured.

## Reproduce and inspect

From repository root, with Node >=22 and no installation/download:

```sh
node tests/fs/webdav/rmdir-atomic-extension/run.mjs local-replay
node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck tests/fs/webdav/rmdir-atomic-extension/proposal.ts
```

Use a new simple cohort name each time; existing evidence directories are never
reused. The runner freezes source/contract/package and all prior rmdir-real-service
evidence hashes, fixture inputs, exact Node binary hash and profile before service
effects. Baselines include observed dirty unrelated work; this is not a clean
all-repository gate. Summaries verify frozen inputs unchanged and finally cleanup:
listener closed, pending requests zero, owned native root removed, server children
zero. No production build or old adapter suite is rerun for a test-only proposal.
`CHECKPOINT.json` seals authored files and measured outputs; root assigns a different
verifier if pursuing this optional integration.
