# S3 HTTP root integration review — August27,2026 UTC

## Verified source and scope

Isolated committed source: `42bffab57cbaccbf08648527fc88d85e21a2ee4a`.
Capture: `2026-08-27T03:57:34.318Z`. No dirty source, shared dist, service
operations, private credentials, private poe-code access or competing suites.
Root package/exports and all product/test source remain unchanged by this leaf.
Machine-readable commands/results and per-file SHA256 values are in
`2026-08-27-s3-http-root-audit.json`.

Checks performed:

- Isolated `npm run build`: exit0; HTTP JS and declarations emitted.
- Built root and `virtual-bash/fs/s3` imports: existing APIs load, neither
  exports `createS3HttpTransport`.
- Direct internal built HTTP module: factory exists, but this is not a public
  consumer path. `virtual-bash/fs/s3/http` rejects with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, as the current manifest declares no such entry.
- `npm pack --dry-run --ignore-scripts --json`: exit0;545 entries including24
  HTTP JS/declaration/map files. Packed internal files alone are not public API.
- Runtime/optional/peer dependency maps are empty. The aggregate still excludes
  curl and SafeJS unless explicitly installed;56 names do not establish parity.

No factory operation was called and no endpoint was contacted. This is build/
export inspection, not SigV4, credential lifetime or provider conformance testing.

## Observed internal handoff, not published usage

`src/fs/s3/http/index.ts` currently exports:

- `createS3HttpTransport(options: S3HttpTransportOptions): S3Transport`
- Types `S3HttpCredentials`, `S3HttpCredentialProvider`, `S3HttpRequestFactory`,
  `S3HttpTransportOptions`.

Required options currently are endpoint, region and explicit credentials or an
async credential provider receiving `{ signal }`. The author also exposes
addressing/list-encoding options, injected clock/request, insecure-HTTP opt-in,
byte/XML/time limits, enableCopy and verified conditional-operation settings.
These names are inspected source, not permission to publish an unreviewed usage
recipe or infer provider capabilities. Source options/docs remain Poincare-owned.

The already-public `createS3Transport` is the adapter for a caller-supplied
minimal client. It is not the HTTP factory and should not be presented as one.

## Bounded wiring needed after owner handoff

1. Confirm the listed author API and accepted source revision with Poincare.
   The additive existing-contract design does not need another design block.
2. Root owner can expose the HTTP entry through `src/index.ts` and add a
   `./fs/s3/http` export mapping to `./dist/fs/s3/http/index.js` with its
   corresponding `.d.ts`. If the existing `./fs/s3` path should also expose it,
   coordinate that index change with Poincare rather than editing his subtree.
3. No files/include expansion or runtime dependency is needed: the current
   TypeScript build and `files: ["dist"]` already emit/package the module.
4. Verify both ESM and TypeScript public imports against a fresh built/packed
   package, not a direct internal module. Exercise actual service operations
   through that public consumer, retaining explicit host authority and the
   measured guard/encoding settings. Do not use private Mock APIs as setup.
5. Only after that proof, add runnable README usage and accurately scoped
   service support. Do not imply universal AWS/S3 compatibility, streaming PUT,
   atomic rename or native conditional operations that the provider does not honor.

No export edit is made in this review; unfinished API wiring is not guessed.

## Service evidence arriving during this review

Commit `14b872cd3e038d5e16c4809b7078aee83a8cb5e1` records independent actual
MinIO evidence against the same42bffab source:18/18 transport/workflow and14/14
bounded-copy checks. The repeated native guard cohort remains13/17, with four
unsupported destination-COPY/DELETE guards visible. The flow fixture adds the
explicit measured form-list encoding setting; it is not unchanged all-input proof.
Historical15/18 and17/18 remain separate. These results were inspected, not rerun.
See `tests/fs/s3/http/interop/evidence/final-acceptance/REPORT.md`.

The service harness still uses the built internal HTTP entry until root wiring.
Therefore its actual-service proof does not close public-package usability.
The factory source and root export files did not differ between42bffab and the
observed14b872c descendant. Other service/provider and package-review work remains
outside this documentation audit; the historical9920 full-suite snapshot is
not a current gate.

## Hash anchors

- Root src/index.ts: `76a17e2be09c743f8522a5f45868c1da84a80f107a2aae7e72b2e564bfff88b1`
- package.json: `216554f6115e7254b471b1e3b91319e516a80682b59a0b7fe6d8df16b2cb164b`
- S3 index.ts: `731b0141a614ec0be82885c8f608ea9c07bbe4fc96cdc01a04f90bb77f93bf49`
- HTTP index.ts: `bd414ce2de1aeb4becff1375ba994ee5bea6ca46600234807515c28385130dd4`
- HTTP path/hash manifest including README: `56dc4ac4fab3978aaaa9606b088bb3a0c0ccfde910e25f711f2e51131d42ff7f`

The last digest hashes UTF8 JSON of the audit's HTTP source-hash entries sorted
by path. Individual file hashes and exact source revision remain authoritative.
