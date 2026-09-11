# Atomic filesystem operations over RPC

ZIP publication, ZIP extraction, and csplit use the same `FileSystem` contract
whether storage is local, in memory, or behind RPC. An RPC adapter can support
them without changing shell syntax. It must expose actual server-side atomic
operations; bounded read/write, exclusive creation, and atomic rename alone are
not sufficient.

This guide specifies the supported host integration path. It does not add a
network protocol, server implementation, credential store, or automatic fallback.
The reusable conformance suite below is opt-in and uses only the filesystem
fixtures supplied by its caller. Neither the suite nor this integration contract
reads environment variables.

## Required capabilities

| Workload | Affirmative capabilities and methods |
| --- | --- |
| `zip /bundle.zip /a` | `atomicFileStaging: true`, `createStagedFile`, `publishStagedFile`, `removeStagedFile` |
| ZIP extraction | Owned staging above, plus `atomicDirectoryMetadata: true` and `prepareDirectory` for directory creation/metadata restoration |
| `csplit /input 2` | `atomicFileMutation: true`, `writeFileConditional`, `removeFileConditional` |
| Archive listing or stdout member streaming | Bounded read capability; no atomic mutation capability is needed |

Ordinary path lookup, parent traversal, authorization, bounded I/O, and supported
metadata are still required. Declare `permissions`, `timestamps`, and `symlinks`
truthfully. These capabilities are not granted by advertising staging support.
Inspect both `fs.capabilities` and the selected path's `capabilitiesFor(path,
{ create, signal })`, when provided. Missing-target queries with `create: true`
must resolve the actual destination backend without creating an entry. Mounts
and wrappers must preserve or explicitly withhold the complete guarantee.

Without the guarantee, the existing ZIP and csplit failures are intentional and
safe. Do not catch them and retry using unchecked operations, disable ownership
checks, or substitute a different command language.

## RPC representation of observations

`FileStat` optionally carries `identityScope`, `dev`, `ino`, and a mutation
`revision` in addition to type, length, modes and timestamps. The atomic operations
require complete scoped identities for their checked entries and revisions for
checked files; a directory identity check does not require a file-style revision.
Unknown identity must not be fabricated to enable these capabilities. The TypeScript interfaces live
in [the filesystem contract](../src/contracts/filesystem.ts); the normative
semantics are in [the contract documentation](../src/contracts/filesystem.md).

- `identityScope` is an opaque JavaScript object or symbol, not a JSON string.
  Send an authenticated backing-namespace identifier over RPC, then intern it to
  a stable object/symbol through a shared identity authority for overlapping views
  whose snapshots can be compared in the same process. Different scopes promise
  disjoint identity universes: do not mint different scopes merely for different
  clients, credentials, roots or mounts over the same storage. Returning a fresh
  object on every stat call destroys identity. Separate processes may intern their
  own opaque references, but those references are not cross-process identifiers.
  Reusing one scope/identifier tuple for unrelated backing entries falsely grants
  identity.
- Preserve `dev`, `ino`, and `revision` exactly as nonnegative safe integers
  where the contract requires them. A backend with larger identifiers needs a
  collision-free mapping shared by overlapping comparable views, not lossy
  numeric coercion or hashing. A reconnect or session reset does not make existing
  storage disjoint and does not by itself justify rotating the scope. Preserve
  the identity authority/mapping, or withhold complete identity until it can be
  recovered; use a new scope only for a genuinely disjoint identity universe.
  Never recycle identifiers or revisions in a way that revalidates stale receipts.
- A file's revision changes for content writes and explicit metadata mutation,
  even if size and timestamps do not change. Timestamps alone are not versions.
  Reading and its incidental access-time update need not change the revision.
- Expected snapshots travel back as server-verifiable observations. They are
  not permission grants. Authenticate and authorize every operation and bind
  observations to the correct tenant, namespace, principal and mount.
- Byte arrays must retain exact bytes and ownership. Choose a binary frame or
  bounded base64 field; account for encoded and decoded sizes before allocating.
  Do not JSON-stringify a typed array and treat the resulting object as bytes.
- Return owned original commit snapshots. Never implement a receipt by reading
  the path after commit: another writer may already own that name.

The command compares snapshots, but the server must validate all conditions
again at the operation's single linearization point. An RPC adapter cannot make
separate remote `stat`, `write`, `rename`, or `delete` calls atomic by ordering
them carefully in JavaScript.

## Server-side operations

Use a transactional namespace, storage-native conditional operation, or a
server-owned critical section that covers every competing namespace mutation.
A lock used only by these new endpoints is insufficient if ordinary writes or
other clients bypass it. Distributed replicas need the same serialization and
durability guarantees, not process-local locking alone.

### Conditional files: csplit

`writeFileConditional(path, data, { parent, expected, append?, mode?, signal? })`
atomically checks the parent's identity/type and either destination absence
(`expected: null`) or the existing file's identity/type/revision. Replace or
append the entire supplied byte array, or change nothing. `mode` affects creation
only. Return the committed file snapshot from this transaction. An expected
existing file must not be recreated if it disappeared.

`removeFileConditional(path, { parent, expected, signal? })` checks the same
parent and exact expected file before removal. It is conditional deletion, not
`rm -f` and never recursive removal. Competing output and cleanup must not erase
another request's replacement. Parent checks use stable directory identity, not
a timestamp that changes when sibling outputs are created.

### Owned staging: ZIP and extracted files

1. `createStagedFile(directoryPath, name, content, { parent, mode?, atimeMs?,
   mtimeMs?, signal? })` validates the supplied parent and admits all content,
   metadata, quota and allocation requirements before atomically creating a
   private mode-0700 directory and an exclusive file (or supported symlink).
   `content` is `{ type: "file", data }` or `{ type: "symlink", target }`.
   Return the original parent, directory and file snapshots as one `FileStaging`.
2. `publishStagedFile(staging, destination, { parent, destination: expected,
   signal? })` atomically validates the original staging file/private directory,
   both parents, and expected destination snapshot or explicit absence before
   publication. Validate file revision, size, mode, link count, mtime and ctime
   as required by the contract. Parent/directory identity checks allow legitimate
   child mutations. Do not publish a replaced or edited staging file.
3. `removeStagedFile(staging, { signal? })` atomically removes only the unchanged
   original staged file, if present, and its empty original private directory.
   A missing staged file after publication is allowed. Replacements, symlinks,
   modified files and unexpected children survive a refusal. Never implement
   cleanup with recursive deletion or a later lookup that adopts a replacement.

The publication endpoint must not expose a partially written final file.
Private staging names are not proof of ownership: all receipts and conditions
still apply. Garbage collection of abandoned server sessions needs equivalent
ownership checks and a separately defined lifecycle.

### Directories: extraction

`prepareDirectory(path, { parent, expected, mode?, atimeMs?, mtimeMs?, signal? })`
checks the parent's identity. With `expected: null`, create exclusively and
return the original directory snapshot. With an existing directory snapshot,
check its identity before applying admitted metadata and returning the result.
Child creation does not invalidate directory identity. A replaced directory or
parent must survive refusal. Unsupported metadata must fail before mutation;
do not partly apply mode then fail on timestamps.

The extraction command retains its path traversal, symlink, input-archive
identity, decompression, CRC and output limits. Server operations independently
enforce namespace confinement and authorization; string prefix checks on the
client do not establish server-side confinement.

## Errors, cancellation and ambiguous responses

Changed checked identity/revision/absence conditions fail with `FsError` code `EAGAIN`.
An occupied staging-directory name instead refuses exclusive creation with
`EEXIST`; do not conflate this with a stale publication or cleanup receipt.
Unavailable guarantees fail with `ENOTSUP`. Preserve meaningful storage errors
such as `EACCES`, `ENOSPC`, and `EFBIG`; do not translate failures into success.
Transport error decoding must preserve the filesystem error code and safe
diagnostic, rather than exposing credentials or unrestricted server traces.

A pre-commit abort refuses the mutation. Cancellation after commit cannot undo
it and must not hide an available original receipt. For example, when staging
creation commits, its receipt must reach the caller even if its signal aborted
before the reply was delivered, so cleanup can be retained. Do not wrap the
whole RPC in a cancellation race that discards a successful late receipt.
Invocation-owned admitted work and cooperative cleanup must be drained; opaque
remote work cannot be forcibly stopped by aborting a local promise.

Lost replies are not evidence of rollback. Use authenticated request IDs and a
server-side outcome/receipt ledger, or an equivalent reconciliation protocol,
to recover the original committed result. Blindly replaying conditional appends
or recreating staging under a new request is unsafe. Deduplication must bind the
same operation, arguments and principal; do not replay a success for different
content. An unresolved outcome is not a successful operation or completed
cleanup. Document retention/expiry and server restart behavior for the chosen
protocol; SafeFS does not invent these distributed guarantees.

## Reusable conformance cases

The portable entry is `@poe-platform/safe-fs/testing/atomic`. It is not imported
by filesystem or shell core. It exports `createAtomicFileSystemConformance` and the associated
fixture, options and case types.

```ts
import { createAtomicFileSystemConformance } from "@poe-platform/safe-fs/testing/atomic";

const cases = createAtomicFileSystemConformance({
  createFixture: async () => {
    const fixture = await createIsolatedRpcTestNamespace();
    return {
      fs: fixture.adapter,
      peer: fixture.secondClient,
      root: fixture.emptyRoot,
      dispose: () => fixture.destroyOwnedTestNamespace(),
    };
  },
  includeSymlinks: false,
});
for (const entry of cases) test(entry.name, () => entry.run());
```

`createIsolatedRpcTestNamespace` and `test` in this example are supplied by your
integration and test runner, not SafeFS APIs. Test only an isolated disposable
namespace: cases deliberately write, rename, race and replace entries. Never
point them at a production directory.

| Configuration | Meaning |
| --- | --- |
| `createFixture` | Required factory, sync or async, returning a fresh filesystem fixture for each case |
| `includeSymlinks` | Optional boolean, default `false`; add symlink staging/replacement cases and require affirmative `symlinks`/`readlink` capabilities and methods on both clients |
| Fixture `fs` | Required adapter under test; all three atomic capability groups and their methods must be present, with affirmative flags globally and for the fixture root |
| Fixture `peer` | Optional independent client into the same namespace, default `fs`, for competing mutations |
| Fixture `root` | Required existing empty absolute directory owned by this test fixture |
| Fixture `dispose` | Required cleanup callback, sync or async, run after each acquired fixture, including failures |

Selected missing capabilities fail; they are not counted as passing cases or
silently skipped. The same admission applies to `peer` when supplied. The only
optional case profile is `includeSymlinks`: advertising another capability does
not automatically add tests for it. The base cases explicitly request and check
directory modes and private staging mode bits; there is no mode-free profile.
Reported mode bits alone do not prove server authorization or privacy. The suite
does not qualify timestamp mutation, quota enforcement or every advertised
optional operation.

The suite checks byte ownership/publication, conditional race
winners, stale revisions, parent/source/destination replacement, cleanup refusal,
directory modes, and rejection of already-aborted calls with the original abort
reason. These cases do not inject an abort at a remote commit boundary, lose a
reply, or prove late-receipt delivery, replay safety or failover durability.
Concurrent calls test the observed one-winner outcome; they do not force every
possible server interleaving. Peer observations and receipts are checked through
their originating client, not treated as a cross-client scope/receipt exchange
protocol. A pass therefore does not qualify identity interning across comparable
adapters or authorize distinct scopes for overlapping storage.

Use your runner's timeout and cancellation
handling for an unresponsive RPC transport. An in-memory or loopback pass is
not evidence that production storage implements a distributed transaction.

Before enabling capabilities in the Poe integration, also inject real server
pauses immediately before each operation's commit, mutate through another client,
then resume. Exercise same-size same-timestamp writes, quota refusal, disconnects
before/after commit, reply loss, retries, expired receipts, restart/failover,
cross-tenant tokens, and cancellation during acquisition/publication/cleanup.
Verify that ordinary ZIP creation/extraction and csplit work through that adapter,
including failed output cleanup, while unrelated replacement data survives.
