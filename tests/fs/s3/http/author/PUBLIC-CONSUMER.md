# Complete public-package S3 HTTP example

`public-consumer.mts` exports the fully typed
`runPublicS3Example(options): Promise<PublicS3ExampleResult>`. It imports only Node's
assertions and actual public `virtual-bash`, `virtual-bash/fs/s3`, and
`virtual-bash/fs/s3/http` exports. Importing the compiled consumer asserts that
the root and HTTP subpath expose the identical factory function. There
are no private mock observations, SDK bridges, private authority helpers, undefined
callbacks, casts around missing exports, or installed runtime dependencies.

## Explicit input and service ownership

```
{
  endpoint: string,
  region: string,
  credentials: { accessKeyId: string, secretAccessKey: string, sessionToken?: string },
  bucket: string,
  prefix: string,
  verifiedConditionalPut: true,
  allowInsecureHttp?: boolean,
  listUrlEncoding?: "percent" | "form",
  signal?: AbortSignal
}
```

The bucket must already exist; the six-operation transport does not provision
buckets. Supply a fresh, caller-owned, nonempty relative prefix without a trailing
slash. The function refuses a nonempty prefix before creating directories/files.
No existing user object outside this prefix is touched. The example intentionally
leaves its objects for inspection; its service owner cleans only that isolated
namespace afterward. No ambient environment credentials or home-directory lookup.

For the independently measured pinned MinIO profile, use explicit synthetic
credentials, `allowInsecureHttp:true` on loopback and `listUrlEncoding:"form"`.
The caller's `verifiedConditionalPut:true` records independently measured PUT
enforcement, not an inferred capability or a namespace trust flag. The example
sets native COPY/DELETE attestations false and uses the guarded bounded COPY
implementation. The original native provider guard observations remain 13/17.

## Actual backing resolver, not an identity shortcut

This example is for **one verified proper S3 object namespace**: the supplied
service implements independent bucket/key entries, not a remapping/cache gateway
that aliases different keys or another filesystem. This is a host-known service
binding, not something proved by an endpoint string, credentials or ETag. If the
service has different storage semantics, this resolver is not appropriate; the
host must implement its actual mapping or return unknown.

The code creates all registered S3 views itself using that one transport/bucket.
Its private WeakMap is only a lookup from an actual filesystem view to immutable
configured bucket/prefix routing facts. It is not a per-client identity token,
global authority registry, or generic method for registering arbitrary providers.
The callback reads both followed entries through fresh public `stat` calls,
propagates metadata errors, checks cancellation before/between/after queries, and
compares canonical **actual object keys** only for registered regular-file views
in this one declared namespace. No content GET or mutation occurs in the callback.

The overlapping view maps `primary:/work/source` and `overlap:/source` to the same
key, so same-key aliases are protected. Different keys in this verified independent
namespace are distinct. Unregistered S3 instances—even using the same transport—
and foreign providers remain unknown. Endpoint equality, bucket labels alone
across unknown providers, filesystem classes, credentials and ETags do not prove
disjointness. Host routing must remain faithful; remappers must supply different
truthful authority. Fresh observations are not a lease, ABA guard or transaction.

## Operations and exact assertions

The exported function executes nine named checks:

1. Create directories and an exclusive binary source, refusing a second exclusive
   creation while preserving bytes.
2. Create/read/list a UTF-8 filename containing spaces, literal plus and percent.
3. Actual mounted Shell cp to both missing and existing targets.
4. Overwrite/read source and verify the earlier copy retains its snapshot bytes.
5. Compare/copy distinct entries across registered prefix views.
6. Identify an overlapping-key alias and reject copy without source corruption.
7. Keep unregistered/cross-provider relationships unknown and refuse an unsafe
   existing-target copy while preserving both source and destination.
8. Propagate fresh missing-entry errors and explicit caller cancellation.
9. Demonstrate the real move limit at both filesystem and Shell boundaries:
   typed ENOTSUP/nonzero status, with exact source/target bytes and names intact.

The returned `move.supported:false` is **not** successful move acceptance. This
MinIO release does not enforce conditional DELETE. A positive guarded move needs
another independently verified provider/profile with that capability; no unsafe
copy-then-unconditional-delete workaround is implemented. Atomic rename stays false.

## Strict isolated build and invocation

From the repository root:

```sh
node tests/fs/s3/http/author/build-public-consumer.mjs accepted
```

The runner copies current source and the real package manifest/TypeScript configs
byte-for-byte into the owned ignored `.isolated/accepted` directory. It builds the
actual package, strictly compiles the `.mts` consumer against the unchanged public
export map, then imports the emitted `.mjs` without touching shared `dist`.
It records commands, outputs, source/package/fixture hashes and built hashes in
`public-build-accepted.json`. Use a new label for each replay; artifacts are never
overwritten. No automatic network/service startup occurs in this build step.

Once the build succeeds and a caller-owned test service/bucket is provisioned:

```js
import { runPublicS3Example } from "./tests/fs/s3/http/author/.isolated/accepted/example-dist/public-consumer.mjs";

const result = await runPublicS3Example({
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: "synthetic-example-access",
    secretAccessKey: "synthetic-example-secret-only",
  },
  bucket: "safe-bash-example",
  prefix: "owned-example-run-20260827",
  verifiedConditionalPut: true,
  allowInsecureHttp: true,
  listUrlEncoding: "form",
});
console.log(JSON.stringify(result, null, 2));
```

These are explicit synthetic configuration values, not a running server or usable
real credentials. Service verification owns provisioning and invokes the exported
function with its actual isolated endpoint/bucket/prefix. Service tests must execute
the compiled package consumer, not substitute a source/private-import fixture.

## Initial wiring evidence

`public-build-first.json` preserves the real initial result: package build exits0,
strict consumer compilation exits1 because the actual S3 barrel lacks
`createS3HttpTransport` (TS2724) and `S3HttpCredentials` (TS2305). No export map was
patched. Root/Curie's subsequent `3c45ca2` exposes HTTP APIs from the package root
and new `virtual-bash/fs/s3/http` subpath, not the existing S3 barrel. This first
failed build is preserved unchanged; the consumer now uses those actual exports.
See `PUBLIC-EXPORTS.md` for the separate fresh build result. Actual-service
execution of this compiled public consumer remains a separate verification step.
