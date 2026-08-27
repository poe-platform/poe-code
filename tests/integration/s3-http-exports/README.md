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

The runner archives only committed product/build inputs into a fresh temporary
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
usability and zero runtime/optional/peer dependencies, not request signing,
streaming, service authorization, provider parity or complete filesystem workflows.
It neither replaces nor reruns Poincare's actual-service complete consumer/example.

The separate pinned-service evidence at `14b872c` against source `42bffab` retains
native conditional-operation guards **13/17**, including four unsupported guards.
Its 18/18 workflows and 14/14 bounded-copy cases use an explicitly changed
list-encoding configuration; they are not unchanged all-input or arbitrary-provider
proof. Full behavioral acceptance remains separate. The older unexported-state
audit in `docs/integration/2026-08-27-S3_HTTP_EXPORT_REVIEW.md` remains historical.
