# Strict WebDAV atomic-empty extension: author checkpoint

Source commit: `d1174e2db9f4a4c92403842dee6fb3d4ff57ec96`.
Root authorized the optional strict capability. This is author qualification of
the configured profile, **not independent acceptance or stock-provider support**.
Root must assign a different source/real-service verifier after this checkpoint.

Production changes are limited to `src/fs/webdav/{webdav.ts,index.ts,README.md}`.
No contracts, root barrels, manifests, dependencies or other filesystems changed.
The existing root `export * from "./fs/webdav/index.js"` already forwards the new
named types; Faraday needs no additional root edit. The original aggregate 78/79
matrix and all original/independent evidence remain unchanged and were not rerun.

## Implemented API

Optional `WebDavFileSystemOptions.atomicEmptyDirectory` has these public types:

- `WebDavAtomicEmptyDirectoryBinding`: canonical `namespaceUrl` and the
  `removeEmptyDirectory(request)` asynchronous callback.
- `WebDavAtomicEmptyDirectoryRequest`: `operation: "atomic-empty-rmdir/v1"`,
  `namespaceUrl`, canonical namespace-relative `path`, optional `signal`.
- `WebDavAtomicEmptyDirectoryResult`: matching operation/namespace/path and
  `outcome: "removed"`.

The constructor rejects a missing callback or namespace unequal to the canonical
base URL before network I/O. It captures both values. Configured rmdir checks
normalized path, virtual root, cancellation and observed directory type first,
then calls the host with frozen facts. It does not perform a prior empty listing
or recursive DELETE. The host operation enforces final emptiness and authorization.
Native errno-shaped failures become typed errors retaining the caller's path.

An exact matching receipt is required. A receipt mismatch is EIO; it cannot undo
an already completed operation. Callback waits race caller cancellation and the
adapter timeout, observe late rejection, and never retry. A cooperative host must
propagate the signal and own its lock/transport cleanup. An uncooperative host may
continue work after the caller receives an error. No rollback, target-inode CAS,
absence-after-error, or cryptographic proof against malicious host JS is promised.

Omission keeps empty rmdir ENOTSUP. `snapshotRmdir` stays absent and `atomicRename`
stays false. No COPY/MOVE grant, token, scope or validator check is weakened.

## Real provider integration, not the earlier generic prototype

`server.py` runs **WsgiDAV 4.3.5 and cheroot 11.1.2** under HTTPS in a task-owned
Python venv, with actual `WsgiDAVApp`, `HTTPAuthenticator`, `FilesystemProvider`
and the provider's actual `LockManager`. `/dav/` maps to the extension's native
subtree. `/stock/` maps to a different native subtree with an unmodified
`FilesystemProvider`; it is not a second URL alias to the same bytes.

The development extension subclasses the real provider/resource classes. It
admits the exact opt-in header only for the configured namespace, authenticated
`fixture` principal, canonical path and DELETE method. A valid second authenticated
principal is denied by the extension's explicit access policy. The actual Basic
auth middleware rejects bad credentials before the provider hook runs.

The existing request handler still performs HTTP/DAV conditions and its standard
parent lock check. Its early `res.handle_delete()` call precedes
`res.get_descendants(...)`. The extension checks target **and descendant** locks
using `provider.lock_manager.check_write_permission`, real parsed request tokens,
the real resource URL and authenticated principal, then calls `os.rmdir`.
It returns handled=True only after native success and exact-resource property/
lock cleanup. It never calls `FolderResource.delete` (which is recursive),
`shutil.rmtree`, a child delete loop or a metadata-only success marker.

All `/dav/` provider handler iterations share one RLock, including normal LOCK,
UNLOCK and other DAV writes. This prevents this deployment's provider requests
from changing its lock/namespace state during the check/native-call interval.
It is not distributed serialization. Native host writers bypass that lock;
their late children are protected by native rmdir's final emptiness check.

For the extension request, `get_descendants` deliberately fails and logs if the
standard handler reaches recursive visitation. Both measured runs record **zero**
such visits. This instrumentation checks call order; it does not supply empty-only
success or alter the real lock manager. The only late-child hook pauses before
native rmdir so a separate Node consumer can create the child through native I/O.

## Primary-source basis

Inspected official pinned sources and installed-wheel modules, not latest-docs
assumptions:

- `https://github.com/mar10/wsgidav/blob/v4.3.5/wsgidav/request_server.py`:
  `do_DELETE` evaluates conditions, checks the parent, invokes `handle_delete`,
  and only on an unhandled result enumerates descendants.
- `https://github.com/mar10/wsgidav/blob/v4.3.5/wsgidav/dav_provider.py`:
  documented early `handle_delete` and `custom_request_handler` extension hooks.
- `https://github.com/mar10/wsgidav/blob/v4.3.5/wsgidav/fs_dav_provider.py`:
  ordinary folder deletion is recursive; the extension must not delegate to it.
- `https://github.com/mar10/wsgidav/blob/v4.3.5/wsgidav/lock_man/lock_manager.py`:
  actual URL/principal/token/depth lock checks, not a synthetic policy table.
- `https://github.com/mar10/wsgidav/blob/v4.3.5/wsgidav/http_authenticator.py`:
  real authentication middleware before provider execution.
- RFC4918 §9.6.1 and RFC2518 §8.6.2 require collection DELETE's infinite-depth
  behavior; Depth:0 is not a portable empty-only primitive. This opt-in extension
  adds a checked empty-only condition; a successful empty deletion has no members
  to traverse. Nonempty deletion fails instead of deleting members.

`provider-source-order.json` hashes the five installed modules and asserts increasing
character offsets of the four handler stages. `primary-metadata.json` verifies
official PyPI 4.3.5/11.1.2 metadata against pinned wheel URLs/digests.
`dependencies.json` contains the complete eleven-artifact dependency lock, not
just top-level package versions. No runtime product dependency was added.

## Actual effects and separate denominators

| Cohort | Positive pass/fail | Guard pass/fail | Refusal observed/failed |
| --- | --- | --- | --- |
| `provider-second` | 4/0 | 12/0 | 2/0 |
| `provider-final`, unchanged fixture inputs | 4/0 | 12/0 | 2/0 |

Each cohort also runs the complete standalone public example successfully,
separately from the eighteen-row denominator. No provider row failed in either
executed service cohort. `provider-first` stopped at strict example compilation
before downloads/server start; its implicit-any error and inputs remain preserved.

Positive cases cover public empty removal, UTF8/percent/space names, an actual
Shell pipeline plus mounted cleanup, and raw native empty deletion authorized by
a genuine inherited lock token. Guards cover:

- Existing and externally inserted late child: DELETE409/native ENOTEMPTY and exact
  surviving binary bytes `00ff80410d0a`, not just accepted request headers.
- Bad credentials401; authenticated but ungranted principal403; wrong namespace409;
  wrong operation/path400. No native mutation follows these failures.
- Public preabort, root, missing, file; raw final symlink409/ENOTDIR with link and
  target bytes preserved; read-only wrapper and mount-root propagation.
- Real target lock423 from the provider's added target check; parent lock423 and
  wrong token412 before the early hook; descendant lock423 before native rmdir.
  Real lockdiscovery remains active on protected resources. All four raw LOCK
  acquisitions per run have observed UNLOCK204 cleanup; no locks are retained.

The two refusals are true stock default ENOTSUP and a configured callback aimed at
an unregistered stock extension. The callback's OPTIONS probe detects the absent
capability and refuses **before DELETE**, preserving the stock collection.

WsgiDAV still emits a bare, non-RFC-codedURL `Lock-Token` response header. Those
unchanged headers are retained in raw evidence. Raw lock-manager controls obtain
the actual URI from `DAV:locktoken/DAV:href` and construct the specified If/UNLOCK
request syntax; they do **not** alter response headers or feed malformed grants
through the product parser. The public binding does not acquire locks and refuses
locked resources. Default COPY/MOVE's existing strict rejection remains unchanged.
No repair of WsgiDAV transfer interoperability is claimed.

`audit.json` asserts installed-source ordering plus actual native events, denied
target/descendant calls, the parent guard's absence of hook entry, exact child bytes,
zero descendant visits, retained-lock count, closure and cleanup.

Source validation is separate: new33 changed from 5 pass/28 fail before implementation
to 33/0. Current old WebDAV568, legacy LOCK23, direct authority23, timestamp5,
recognized-scope28 and required alias49 all pass unchanged. Strict scoped types
and complete-source build pass. The historical 564 denominator was not silently
reused for the now-568 suite. See `SOURCE.md` and preserved harness corrections.

## Fully typed packed consumer

`example.mts` is executable host code importing **actual** root `virtual-bash` and
`virtual-bash/fs/webdav` exports. It implements the callback completely: fixed
HTTPS namespace, explicit credentials, capability negotiation, encoded path/header,
DELETE, receipt decoding/validation, typed error mapping and body cancellation.
`https.mts` is the unchanged earlier typed Node HTTPS transport, using per-request
CA trust, manual redirects, no global TLS/dispatcher changes, streamed Response,
abort and upload backpressure. No callback placeholder or private resource/mock
helper is present in the consumer.

The runner archives the exact source commit, builds it, packs it, extracts it into
an independent consumer's `node_modules/virtual-bash`, creates a distinct consumer
package.json, and strictly compiles the three `.mts` consumer files. It supplies
literal configuration containing the actual loopback port, CA, namespace, explicit
synthetic Authorization and owned native/control roots. Runtime root/subpath URLs
resolve into extracted `dist`; `runtime-closure.json` hashes **157 actually loaded
package modules** captured by the loader. No source fallback is used.

The retained literal config is evidence of a now-cleaned temporary deployment, not
a reusable live service. Reproduction creates fresh paths/ports and runs both the
matrix and standalone example automatically:

```sh
node tests/fs/webdav/atomic-extension/run.mjs local-provider-replay d1174e2db9f4a4c92403842dee6fb3d4ff57ec96
node tests/fs/webdav/atomic-extension/audit.mjs local-provider-replay
```

Use a fresh cohort label. Requires installed Node22, TypeScript development tools,
`/opt/homebrew/bin/python3` compatible with the pinned CPython3.14/macOS-arm64
wheels, tar and OpenSSL. It creates an isolated venv and downloads 1,769,458 bytes
of pinned wheels per executed service run from official PyPI only. No user pip
config/cache/private indexes, ambient credentials or existing service are used.
The proof was measured on Darwin arm64, Python3.14.7, Node22.22.2, not another OS.

## Frozen hashes

| Input | SHA256 |
| --- | --- |
| Source archive | `e705552cb347ccb7b7e11a4c582591126e75ecd1b0f51d2397efc51843bc114a` |
| Product WebDAV implementation | `e66a66e2745852c6bd12be12a18c855df069152cf6b8089d2ecee8880c62de94` |
| WebDAV public barrel | `d359fa8a89c30fa7fa06b256c524b4bc1022b3217763051961e579c5fcfd7764` |
| Packed package, both service runs | `78461169565ceb3da674d881bf983b7a50832cd57fb7ff1bbaf68db43c46b937` |
| Dev provider extension | `9e9c9d660857e715aba1cd312eb1d30082742602027508eb9b4dd3530de03c9b` |
| Complete dependency artifact lock | `e80ca4a6c021a346ee88dfe6098f7b87d1fddae72fe470292e24931fd24752a9` |
| Actual provider profile, both runs | `a4ce82f78f08f78b04d8dbc6c891120b5fd854e25858d9a93a0ee5b622949c4d` |
| Typed host callback/example | `0a477635fa96ed8a68c200b279ed1f78889296fc9cea1ed414df722416d6ec04` |

Per-cohort inputs, package/export map, exact dependency versions, binary/module
hashes, wire statuses, native witnesses and compiler commands are retained.
`CHECKPOINT.json` seals this author subtree and verifies preserved earlier rmdir
evidence. Unrelated moving worktree state is disclosed, not claimed globally clean.

## Remaining boundaries and cleanup

- The trusted host must register this actual backing namespace and authorize the
  same operation. Echoed receipt strings are routing checks, not protection from a
  malicious callback or dishonest server. An OPTIONS probe is not a lease against
  server reconfiguration between probe and DELETE.
- Stable trusted ancestor directories are an explicit deployment assumption.
  JS/Python lstat/root identity checks have pathname check/use gaps. Hostile native
  ancestor renames, symlink swaps, ABA and target-inode conditional deletion need
  descriptor-relative/provider-specific stronger machinery and are not supported
  guarantees. No declared URL aliases or multiple provider processes share this root.
- Native children may arrive after inspection; final os.rmdir rejects nonempty and
  preserves them. Native writers may still rename/replace paths or change access
  outside the provider RLock. This is not a distributed transaction or inode CAS.
- Static final symlinks are refused by the raw extension; ordinary provider metadata
  follows WsgiDAV's configured no-symlink policy. No general symlink API is added.
- In-flight/late callback cancellation and uncertain receipt outcomes are source
  regressions, not new real-provider abort-after-syscall claims. Cancellation cannot
  undo completed native effects. Lost replies require reconciliation, not retries.
- The earlier locked-recursive-DELETE native-child-loss evidence and generic
  prototype limitations remain immutable; neither algorithm became a fallback.

Both Python children exit0 through their stop/finally path; all requested real
locks are released. The parent finally removes only its own entire service
workspace: venv, downloads, npm cache/config, HOME, roots, certificate private key,
consumer and build. No live server or temporary native tree remains. Certificates
retained in evidence are public; credentials are synthetic fixture literals only.
Root now has a bounded implemented source checkpoint and a real-provider replay
to hand to a different verifier, not a claim of universal provider acceptance.
