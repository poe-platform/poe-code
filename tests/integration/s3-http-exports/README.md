# S3 HTTP public-export integration

This is an independent mechanical package check, not an S3 service suite.
It tests `createS3HttpTransport` and all four public types from both
`virtual-bash` and `virtual-bash/fs/s3/http`:

- `S3HttpCredentials`
- `S3HttpCredentialProvider`
- `S3HttpRequestFactory`
- `S3HttpTransportOptions`

The factory returns the existing public `S3Transport`; the existing
`virtual-bash/fs/s3` entrypoint is unchanged. No service operation is invoked.
Both static and asynchronous credential configurations are constructed with
synthetic values and a request trap; neither requests nor credential-provider
calls occur during construction.

## Reproduce

From the repository root, with cached development dependencies already installed:

```sh
node tests/integration/s3-http-exports/verify.mjs 3c45ca2 /tmp/s3-http-exports.json
S3_HTTP_EXPORTS_REVISION=3c45ca2 node --import tsx --test tests/integration/s3-http-exports/exports.test.ts
```

Without a revision argument/environment override, the runner tests the current
committed `HEAD`, **not uncommitted product changes**. The fixture/harness hashes,
harness HEAD/status and exact product revision are recorded separately. The
verification runner requires Node >=22.15 for synchronous module-resolution
hooks; captured evidence uses Node22.22.2. This tooling requirement does not
change the library's existing Node>=22 engine declaration.

### Required-peer profiles

To qualify the uncommitted canonical-FS migration instead of historical HEAD:

```sh
node tests/integration/s3-http-exports/verify.mjs WORKTREE /tmp/s3-worktree.json /absolute/path/poe-code-13.0.0.tgz
node tests/integration/s3-http-exports/verify.mjs HEAD /tmp/s3-committed.json /absolute/path/poe-code-13.0.0.tgz
S3_HTTP_EXPORTS_PEER_TARBALL=/absolute/path/poe-code-13.0.0.tgz node --import tsx --test tests/integration/s3-http-exports/exports.test.ts
```

The fourth argument is an already downloaded, actual published peer tarball. Its
version must match the exact development pin and lockfile; its complete SHA512
SRI must match the registry integrity in that lockfile and the required,
nonoptional peer range must admit it. The example uses the migration's 13.0.0
pin; selecting another release requires an independently prepared matching
manifest, lockfile and cached tooling, not a version override or guessed release.
`S3_HTTP_EXPORTS_REVISION` selects the committed revision in the existing test
wrapper. `S3_HTTP_EXPORTS_PEER_TARBALL` supplies the explicit artifact when the
fourth runner argument is absent; it does not override the version, SRI or
required-peer policy. Neither variable provides credentials or enables network.
A committed source manifest with a required peer selects
`authenticated-peer-committed-revision`, retains its real `sourceCommit`, and
receives the same strict artifact/runtime/declaration authentication as WORKTREE.
Historical zero-peer commits retain their original profile and private
declaration assertions without requiring an artifact. A missing or mismatched
artifact fails; no source fallback or blanket dependency admission is added.

WORKTREE enumerates actual Git tracked/untracked nonignored product inputs and
tracked deletions using NUL-separated records. It captures bounded regular-file
bytes into a separate build directory and rechecks their hashes and census at
completion. The report identifies `source-pinned-WORKTREE`, sets `sourceCommit`
to null, and records actual harness HEAD separately; it does not invent a commit
or certify untracked/historical tests as current consumers. No live source or
Git metadata is written.

The shell tarball is installed offline with peer resolution deferred. The exact
SRI-authenticated canonical tarball is unpacked as a regular, nonsymlink peer
package in the consumer. This bounded FS-route check does not install or qualify
the peer's unrelated CLI dependency tree or general npm dependency solving.
The cached TypeScript and semver tooling are harness prerequisites, not product
dependencies. Canonical runtime/declaration files and metadata must match both
the authenticated artifact and the tooling peer used by the clean build.

The plain-Node guard admits only captured public entrypoints and exact parsed
import edges to authenticated JavaScript bytes, including the required peer's
transitive FS runtime closure. It does not admit arbitrary node_modules files or
private package routes. Root/subpath transport factories and shell/canonical
FsError and MemoryFileSystem constructors must share identity. Byte tampering of
the peer runtime or metadata is rejected; private and outside-source imports
remain negative controls. The strict consumer additionally admits only the
peer's public transitive declaration closure, including its explicitly mapped
Node `#safe-fs-platform` policy when present. A declaration byte-tamper control
must fail. No runtime module may be loaded from a declaration/source fallback.

The committed profiles archive only committed product/build inputs into a fresh temporary
directory, uses cached development tooling for a clean build, then packs and
installs the actual tarball offline into a second directory. It does not link
the product into the consumer or run package lifecycle scripts. The child
environment omits ambient Node loaders, credentials and user npm configuration.
No dependencies are fetched; missing cached tooling fails rather than skips.
Only the runner's temporary directories are removed.

Plain Node imports both public entrypoints from installed `dist` files. A
realpath-based resolution guard rejects modules outside the consumer, source
TypeScript and external runtime dependencies. A deliberate repository-source
import is rejected before evaluation; a private package-source subpath also
fails. Every installed packed file is compared with its clean build input.

The strict NodeNext consumer imports all four types from both entrypoints,
checks bidirectional compatibility and the existing `S3Transport` return type,
and uses `skipLibCheck:false`. TypeScript's complete file list must contain only
the consumer, installed declarations, copied Node development types and compiler
standard libraries. Product source fallback is an error. Three invalid consumer
controls must produce exactly TS2322, TS2345 and TS2741; their compiler exit2 is
expected negative-control evidence, not a failed positive consumer.

## Acceptance boundary

Root export source is `3c45ca2`. This check establishes import/declaration/package
usability and zero runtime/optional/peer dependencies in the historical profile,
or the authenticated required canonical peer in WORKTREE, not request signing,
streaming, service authorization, provider parity or complete filesystem workflows.
It neither replaces nor reruns Poincare's actual-service complete consumer/example.

The separate pinned-service evidence at `14b872c` against source `42bffab` retains
native conditional-operation guards **13/17**, including four unsupported guards.
Its 18/18 workflows and 14/14 bounded-copy cases use an explicitly changed
list-encoding configuration; they are not unchanged all-input or arbitrary-provider
proof. Full behavioral acceptance remains separate. The older unexported-state
audit in `docs/integration/2026-08-27-S3_HTTP_EXPORT_REVIEW.md` remains historical.
