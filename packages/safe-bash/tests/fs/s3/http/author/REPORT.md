# S3 HTTP author checkpoint — August 27, 2026

This is an author implementation checkpoint, not independent service acceptance.
Only new HTTP source, unit tests and author evidence are owned here. Existing S3
source, shared contracts, package exports and independent interop fixtures remain
outside this patch. Product runtime dependencies remain zero.

## Captured checks

`node tests/fs/s3/http/author/validate.mjs checkpoint` records exact commands,
timestamps, raw stdout/stderr and source/fixture hashes in `checkpoint.json`.
It passed **66/66** author tests and strict scoped TypeScript compilation. There
were zero failures, skipped, cancelled or TODO tests. All captured input hashes
were stable during this run. Snapshot HEAD was
`f7000b05b15fa34371226b35cf537d3f73bbf004` plus the recorded new HTTP subtree.
This is not a global typecheck, an isolated built-package test, or a claim that
the concurrently edited whole repository is clean.

Coverage includes four literal AWS published SigV4 vectors, real TCP raw-path
dot segments/repeated slashes/UTF-8, signed/transmitted headers, session tokens,
async credentials, bounded PUT snapshotting, six operation serialization, binary
streamed GET/ranges, bounded XML/DTD rejection, embedded HTTP-200 COPY errors,
provider-error translation, redirect refusal, preheader/body cancellation,
unread-body/iterator-return cleanup, late errors, absolute timeouts and backpressure.
Bounded COPY regressions cover existing/missing targets, source predicate failure,
destination overwrite/creation races, cancellation, denial, limits, metadata
COPY/REPLACE, self-copy and actual Shell cp with disabled native COPY. Rename and
exclusive-copy limitations remain explicit; conditional COPY/DELETE stay false.

`first.json` preserves the initial **54/54** author-only run. It lacked ordinary
COPY fallback and service-specific LIST form decoding, so it did not establish
service compatibility. `fallback-and-encoding.json` preserves the next **65/65**
run. These cohorts overlap; their counts must not be summed as unique coverage.
An intermediate fallback test import pointed to a nonexistent standard-command
module; correcting the test import to the existing index fixed that harness error.

## Source hashes at checkpoint

```
bd414ce2de1aeb4becff1375ba994ee5bea6ca46600234807515c28385130dd4  index.ts
ba4667a138460dd6b9ca9111ecae8753c50d365b9aea8270ee354d1a59781107  request.ts
094b2e6fce2657757bf168ae694213f874e644d81cc9ead75faa1120f0910b3b  signature.ts
ce19e4a347d50d84fb87b993c862717fc57fed183b584bc4b0ca04bcecb3a728  transport.ts
b8ee451a00d17355919024c542dd5c7cbd027d74c7d2f5686f37fd6c0a5ab39e  types.ts
8d1a20c393b193ba9b9d3e06e4348d191a2f950d0b63a99a5d1bd57eefe350a8  xml.ts
```

All source paths above are under `src/fs/s3/http/`. The captured checkpoint JSON
SHA-256 is `709630564a9ab6118525d67b582c6b0b4d7781857a77cdef016e1d3406f2406a`.

## Independent findings retained, not reclassified as passes

The independent service owner measured pinned MinIO
`RELEASE.2025-09-07T16-13-09Z`, not the latest release. Their original **13/17**
guard observations show unsupported destination COPY and conditional DELETE.
Neither capability may be enabled for that measured provider profile. Their
expanded original flow cohort was **15/18**: LIST spelling and ordinary same-view
cp existing/missing were real failures; expected operations must remain unchanged.
Those raw results belong to `tests/fs/s3/http/interop/`, not this author checkpoint.

The exact independent LIST response encoded actual `pages/space +%` as
`pages/space+%2B%25`, yielding the original wrong result `pages/space++%` under
percent-only decoding. The approved explicit `listUrlEncoding:"form"` provider
profile fixes this interpretation without guessing provider identity, changing
unencoded keys or decoding opaque tokens. Default percent decoding remains.

The original claim that disabling COPY automatically selected an existing ordinary
filesystem fallback was incorrect. Inspection and the reviewer's actual Shell
probe showed that fallback existed only inside rename, which the measured provider
cannot safely use without conditional DELETE. The new HTTP-owned bounded COPY
fallback preserves source/destination conditions and uses only verified conditional
PUT for publication; no legacy adapter edits or capability promotion were made.

**Required next gate:** independent replay of the unchanged 18 service-flow
assertions with the justified explicit form-encoding profile against these source
hashes. Until that evidence exists, this source checkpoint is not final service
acceptance. Keep the old 15/18 flows, 13/17 guards and early harness errors visible.

## Remaining limits

See `src/fs/s3/http/README.md` for the exact API, host obligations, resource limits,
protocol references and unsupported operations. No streaming upload, multipart,
automatic credential/region discovery, redirects or public backing-identity
registry is added. HTTP connectivity does not prove backing-resource disjointness.
Bounded GET/conditional-PUT is not atomic server-side COPY; ETags are not incarnation
identity or an ABA defense. Cancellation cannot undo provider-committed mutations.

Replays use a fresh evidence label; the validation runner refuses to overwrite
existing captures. No historical S3 permission/comparison evidence was changed.
