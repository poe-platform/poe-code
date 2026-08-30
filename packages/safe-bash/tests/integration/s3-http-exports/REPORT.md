# Public S3 HTTP export checkpoint — August 27, 2026 UTC

## Revisions and artifacts

- Product export commit: `3c45ca2e8b2f9c832ab2bfa79ba4aa5140b80c03`.
- Independent integration harness: `fe46a3c9b1e94744bc1e099f735df05f534117cf`.
- Committed-harness capture: `2026-08-27T04:13:59.652Z` through
  `2026-08-27T04:14:04.843Z`; owned harness status was clean.
- Raw commands, statuses, source/fixture hashes and resolution lists:
  [evidence-3c45ca2.json](evidence-3c45ca2.json).
- Source archive SHA256:
  `88561712e95a5231ba9eeb3b02d6b860f2f3976fb4ced63d194d778352f4cc2f`.
- Packed tarball SHA256:
  `dea8d1eaa0bd354b5491f77edd94705d4e1aa73e8d6bec278a1f52de66a5dcce`.
  The preceding author run produced the same tarball hash; raw committed-harness
  evidence is authoritative. The tarball is reproducible from the pinned revision,
  not retained as a second product distribution.
- Node `v22.22.2`, npm `10.9.7`, TypeScript `5.9.3`, Darwin arm64.

## Stable handoff

Both `virtual-bash` and `virtual-bash/fs/s3/http` now expose:

- `createS3HttpTransport(options: S3HttpTransportOptions): S3Transport`
- Types `S3HttpCredentials`, `S3HttpCredentialProvider`, `S3HttpRequestFactory`,
  `S3HttpTransportOptions`.

The required options are endpoint, region and explicit credentials/provider.
The existing `virtual-bash/fs/s3` entrypoint and all S3 source remain unchanged
by this integration. Poincare retains the transport, types and complete
actual-service public-consumer/example ownership. No dependency or lock change
was needed; the package remains named `virtual-bash`, private, version `0.0.0`.

## Mechanical results

- Clean archived-source build, actual npm pack and offline installation: pass.
  The 546-file package contains built HTTP JS/declarations, no product source,
  tests or node_modules; every installed packed file matches the clean snapshot.
- Root/subpath plain-Node imports: pass; both factories are the same function.
  Two constructions use static/async synthetic credentials and request traps;
  zero requests and zero provider callbacks occur. No transport method is called.
- All 135 dynamically resolved runtime files are installed product `dist` files.
  A deliberate external repository-source import and a private source subpath
  are rejected. No tsx loader, source symlink or runtime dependency fallback.
- Strict NodeNext positive consumer with `skipLibCheck:false`: pass. It checks
  all four types at both paths, bidirectional assignments, configuration fields
  and the existing public `S3Transport` return type. All 228 compiler inputs are
  consumer/package declarations or explicit development tooling, not product source.
- Three invalid consumer controls: expected exit2 with exactly TS2322, TS2345
  and TS2741. These expected failures are not positive-consumer failures.
- Runtime, optional and peer dependency maps remain empty; lock/manifest identity
  and development dependencies match. Cached Node types/compiler are test tooling.
- The node:test wrapper separately passes 1/1 with zero skips/TODOs against
  `3c45ca2`; its focused strict TypeScript check exits0. No global competing suite
  or service suite was run. The runner defaults to committed HEAD, not dirty source.

## What remains separate

This is mechanical integration, not independent behavioral acceptance or a
complete service workflow. It does not establish signing correctness, HTTP
streaming/cancellation, deployment authorization, provider parity or rename safety.
The existing service evidence `14b872c` against `42bffab` retains native guards
**13/17**, with four unsupported destination-COPY/conditional-DELETE cases.
Its 18/18 workflows and 14/14 bounded-copy cases disclose changed list-encoding
configuration; neither that evidence nor this export check proves unchanged
all-input or arbitrary-provider behavior. No guard is reclassified here.

Poincare's complete actual-service example must now use these public paths, not
an internal built-module import. Further independent behavioral review remains
separate. Earlier unexported-state audits and all historical failures remain intact;
this scoped result is not a current whole-suite, superiority or 72-hour completion claim.
