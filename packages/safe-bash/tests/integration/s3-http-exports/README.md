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

From the repository root, with development dependencies installed and the
selected commit's normal build completed:

```sh
npm run build
node packages/safe-bash/tests/integration/s3-http-exports/verify.mjs HEAD /tmp/s3-http-exports.json
npm test
```

Without a revision argument/environment override, the runner tests the current
committed `HEAD`, **not uncommitted product changes**. The admitted input hashes
and exact product revision are recorded. The
verification runner requires Node >=22.15 for synchronous module-resolution
hooks; captured evidence uses Node22.22.2. This tooling requirement does not
change the library's existing Node>=22 engine declaration.

### Required-peer profiles

The integrated package's explicit `checkout-root` manifest profile automatically
selects the existing built root peer when no artifact argument is supplied.
The ordinary `exports.test.ts` wrapper, package `npm test`/`test:unit`, and root
`npm test` execute this profile without a peer-artifact environment variable.
The root package, Bash package, and workspace lock must match the selected commit.
The development root version is recorded honestly; it does not satisfy or certify
the published `poe-code >=13.0.0` peer range. That required peer remains unchanged
in the packed Bash manifest.

The built inputs are the public `poe-code/safe-fs` declaration entry
`packages/safe-fs/dist/index.d.ts` and its admitted declaration closure, plus
`packages/safe-js/dist/safe-fs.js` and its parsed shared runtime closure. The
existing binder captures their exact bytes/hashes and root metadata, then stages
that same finite closure into the isolated build and consumer. There is no
default tarball path: the report identifies `checkout-root`, with null tarball
hash and registry integrity. Missing outputs fail rather than build, skip, fetch,
or fall back to product source or a registry13 installation.

Use the maintained **root `npm run build`** to produce these outputs, including
its final `scripts/bundle.mjs` shared SafeJS build. A Bash-only compiler build or
`build:workspaces -- --workspace=virtual-bash` does not create the canonical shared
runtime bundle. Release CI already runs the root build before testing; any CI
job that only builds workspaces needs this root-build prerequisite as well.
The test authenticates captured outputs, not their derivation from every source
file; a fresh matching normal build remains a prerequisite.

An explicit artifact remains available for a separately prepared matching root
archive or the standalone published-peer profile:

```sh
node packages/safe-bash/tests/integration/s3-http-exports/verify.mjs HEAD /tmp/s3-committed.json /absolute/path/matching-poe-code.tgz
S3_HTTP_EXPORTS_PEER_ARTIFACT=/absolute/path/matching-poe-code.tgz node --import tsx --test packages/safe-bash/tests/integration/s3-http-exports/exports.test.ts
```

The archive contains `package/package.json` byte-identical to the selected peer
metadata and every bound built declaration/runtime member under `package/`.
For the integrated checkout it selects `packed-root`, not a published release.
For the standalone registry profile its version must match the exact development
pin and lockfile; its complete SHA512 SRI must match the registry integrity before
decompression. An explicit invalid artifact never falls back to checkout outputs.
`S3_HTTP_EXPORTS_REVISION` selects the committed revision in the existing test
wrapper. `S3_HTTP_EXPORTS_PEER_ARTIFACT` supplies that wrapper's explicit artifact;
the direct runner uses its fourth argument. Neither overrides the version, SRI or
required-peer policy. Neither variable provides credentials or enables network.
Every supported profile retains its real `sourceCommit` and strict
runtime/declaration authentication.
Historical zero-peer commits retain their original profile and private
declaration assertions without requiring an artifact. A missing or mismatched
artifact in a profile requiring one fails; no source fallback or blanket
dependency admission is added. `WORKTREE` is not a supported revision selector.
No live source or Git metadata is written.

The shell tarball is installed offline with peer resolution deferred. The exact
authenticated canonical closure is copied as a regular, nonsymlink peer package
in the consumer. This bounded FS-route check does not install or qualify
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
or the authenticated required canonical peer in a committed profile, not request signing,
streaming, service authorization, provider parity or complete filesystem workflows.
It neither replaces nor reruns Poincare's actual-service complete consumer/example.

The separate pinned-service evidence at `14b872c` against source `42bffab` retains
native conditional-operation guards **13/17**, including four unsupported guards.
Its 18/18 workflows and 14/14 bounded-copy cases use an explicitly changed
list-encoding configuration; they are not unchanged all-input or arbitrary-provider
proof. Full behavioral acceptance remains separate. The older unexported-state
audit in `docs/integration/2026-08-27-S3_HTTP_EXPORT_REVIEW.md` remains historical.
