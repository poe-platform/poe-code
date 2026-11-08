# Author public-export build checkpoint

Root export commit `3c45ca2e8b2f9c832ab2bfa79ba4aa5140b80c03` supplies
`createS3HttpTransport` and its public types through `virtual-bash` and
`virtual-bash/fs/s3/http`. The existing `virtual-bash/fs/s3` barrel still supplies
`S3FileSystem` / `S3FileSystemOptions`; the consumer now imports accordingly.
No production API, manifest, export map, or service fixture was changed here.

## Fresh isolated evidence

Command, run on Node v22.22.2 at 2026-08-27T04:14:27.511Z:

```sh
node tests/fs/s3/http/author/build-public-consumer.mjs public-exports-3c45ca2
```

`public-build-public-exports-3c45ca2.json` records the exact commands, raw outputs,
input hashes, real package manifest, and emitted-file hashes. All three checks
exit 0: actual package build, strict NodeNext public-consumer compile, and emitted
consumer import. The import executes a reference-equality assertion between the
built root and HTTP-subpath factory exports. There are no casts, private provider
markers, export-map patches, or network calls in this build/import check.

The captured worktree includes concurrent unrelated changes, not a claim of a
pristine full-repository gate. Recorded HEAD at completion is
`849dbf18b1e865c7d12927c11f0e20ba0555c540`; no captured input changed during the
build. Shared `dist` was untouched. This is product-build and scoped-consumer
type evidence, not a global source-and-tests typecheck or fresh unit/service run.

SHA-256:

- Consumer: `190253ffc034bfea5a7af208cce2dc91bd0b6fb2be993fdb8623b9e5cbf4b1dd`
- New build record: `b3bc1430a4836b8ef99bb725b357a610f36ca4a4bdb37e0768ff053112ed26cb`
- Unchanged HTTP transport: `452cf4192a887ecf3ec03d10471e57ebf0432dae6e58bf1150cfa54d884686ad`
- Unchanged request implementation: `33e2232404d05c08db2ccce200b6ca1d10af36f6a72f197e196fe1fa3f5ba618`
- Original `public-build-first.json`: `d818f93d2e5f666b51e6c2bdaad88a169840807a1dda6f50c49def3fd9472996`

The original TS2724/TS2305 failure is preserved byte-identically. Earlier author
and independent service cohorts are unchanged; this import correction neither
replays nor replaces them.

## Service-worker handoff

Compiled module, available in the ignored isolated build tree:

`tests/fs/s3/http/author/.isolated/public-exports-3c45ca2/example-dist/public-consumer.mjs`

Export: `runPublicS3Example(options): Promise<PublicS3ExampleResult>`. Its complete
public input is `{ endpoint, region, credentials: { accessKeyId, secretAccessKey,
sessionToken? }, bucket, prefix, verifiedConditionalPut: true, allowInsecureHttp?,
listUrlEncoding?, signal? }`. Use the service worker's existing bucket and a fresh
canonical prefix. The example owns its truthful configured-view resolver; no
external SDK bridge or backing-comparison callback is required. See
`PUBLIC-CONSUMER.md` for host namespace obligations and the nine workflow checks.

The pinned profile remains native conditional PUT true, native COPY/DELETE false,
with `enableCopy:false` and effective guarded-fallback `conditionalCopy:true`.
Move is explicitly refused with ENOTSUP and byte/name preservation, not advertised
as supported. No service was launched or public consumer service execution claimed
by this checkpoint; the independent service owner can now run its public runner.
