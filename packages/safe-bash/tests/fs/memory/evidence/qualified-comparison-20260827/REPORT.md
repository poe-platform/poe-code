# Qualified Memory comparison checkpoint — August 27, 2026

This is a bounded source checkpoint, not closure of the original remote positive
acceptance gate. The seven unqualified manual-provider failures remain required
reds. No original fixture, independent review test, or prior immutable artifact
was edited. S3/WebDAV/core source changes belong to their separate owners.

## Source and dependencies

`sealed-manifest.json` records HEAD `7bce86ade313ed53ffc740087db236256d5c0a00`,
the committed source tree, every current TypeScript source hash, selected fixture
hashes, and exact result denominators. The validation includes current core
`0bee8e7`, corrected S3 `37edad8`, and corrected WebDAV `a0e598b` plus its explicit
comparison-authority followup `7bce86a` in its ancestry.
The only candidate production edit is `src/fs/memory/index.ts`, SHA256
`d1b0a082ece95555f740419b276d5565757fe3c3c3ba1555b927e9640dbcc62d`.
Final validation used an isolated committed snapshot plus the four exact owned
candidate files listed in the manifest. Every archived source/test hash was
verified unchanged afterward. Remote source was clean and committed at sealing.
The earlier moving-tree start/end captures are historical only: a subsequent
WebDAV change invalidated that live-tree capture, so the complete cohorts were
rerun in isolation. That followup committed before snapshot setup and is included
in the sealed revision, not silently omitted or mixed with the earlier results.

The earlier S3 client-only binding `3cf57d3` and constructor-time WebDAV binding
are not sufficient dependencies: their owners reproduced adapter override
corruption and superseded them. The current corrected descriptors check original
module-time adapter operations as well as the complete closed provider mapping.
The independent unchanged implementation cohort, including the destructive
WebDAV subclass holdout, passes 47/47 on these corrected sources.

## Implementation

Memory registers a private terminal authority through the existing helper API.
Only constructor-owned roots, original backing-operation references, and fresh
filesystem/path/root-bound observations qualify. The authority recognizes only
the corrected internal `getOwnedS3Entry` / `getOwnedWebDavEntry` closed-store
descriptors. It does not infer disjointness from protocols, class names, URLs,
client objects, ETags, metadata response provenance alone, or invented tokens.
No public registry, shared contract change, remote source edit, or root export
was added. Descriptor modules have type-only remote adapter imports; this does
not introduce a runtime adapter/index import cycle.

Unmodified inherited operations remain eligible. An explicit comparison override
present at construction is not silently shadowed by default registration. Memory
withholds `identityScope` if its backing root/operations no longer match: otherwise
an inherited complete tuple would bypass every callback. All source acquisition
and destination mutation remain after the existing comparison guard. Unknown
manual providers remain unknown; missing-target exclusive creation is retained.
This is point-in-time evidence, not a lease, ABA/pathname-race defense, transaction,
provider authentication, or arbitrary-host-monkeypatch protection.

## Preserved failure and initial results

`memory-before.ts.txt`, `override-tests.ts.txt`, `before-manifest.json`, and
`overrides-before.tap` preserve the exact pre-fix source, probe, source hashes,
and raw observations. Nine override controls initially passed 6/9. Three actual
Memory-to-Memory subclass/instance/preconstruction-prototype cases acquired a
false distinct result through complete tuples, invoked one destructive operation,
changed source bytes from `[0,255,128,13,10,65]` to `[17,18,19]`, and then failed EIO.
The six qualified remote controls already rejected safely through the callback.
The unchanged nine expectations now require ENOTSUP, zero content effects, and
exact source/target bytes and namespace, and all nine pass.

`initial-focused106.tap` preserves the earlier 106/106 author checkpoint. It did
not include the newly found tuple-bypass controls or establish safe remote adapter
binding. Its exact contemporaneous complete fixture snapshot was not captured;
do not treat it as the sealed result. The initial single cancellation-test failure
expected the caller's exact reason at mount's initial remote-resolution boundary;
that boundary returns typed ECANCELED. The test now requires ECANCELED plus exact
global operand paths and preservation, and a separate comparison-boundary test
requires the exact ENOENT-shaped caller reason. No cancellation expectation in
the frozen guards was changed.

Two author-helper fixture adjustments preserve their exact existing assertions:
the known-tuple oracle registers its throwing authority on a transparent view,
not the now-enrolled Memory instance; content sentinels use proxy-local overrides,
not `defineProperty` that unintentionally patches the actual backing store.
The known-alias test still demands EINVAL and zero reads/writes, not ENOTSUP.

## Sealed results

| Cohort | Result | Raw artifact |
| --- | --- | --- |
| Original four plus required 49 guards | 53/53, included below | `focused118.tap` |
| Existing helper and identity-scope tests | 18/18 + 9/9, included below | `focused118.tap` |
| New Memory author cases | 38/38, included below | `focused118.tap` |
| Combined focused | 118/118 | `focused118.tap` |
| Complete five owned backend suites | 716/716 | `owned716.tap` |
| Shared conformance | 202/202 | `conformance202.tap` |
| Unchanged independent implementation review | 47/47 | `independent47.tap` |
| Existing six plus two new source mutants | 8/8 detected | `mutations8.json` |
| Scoped strict noEmit | exit 0, no output | `sealed-manifest.json` |
| Unchanged original compatibility | 36/43, exit 1 | `original43.tap` |

The **new author 38 are not the original required-positive 38**. They include
qualified copyFile/cp/mv both directions, metadata-only observations, inherited
implementations, readonly/overlay views, authentic-metadata/local-content attacks,
override preservation, cancellation, destination failure, and exclusive-create
race controls. Eight mutants include the original six unchanged semantic goals,
plus unconditional Memory identity publication and unqualified descriptor trust.
The harness copies dependencies into its isolated tree and checks live source
bytes afterward; it never mutates the real product source for these probes.

Original fixture SHA256 remains
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
Its original positive gate is now **31/38**, plus **5/5 controls**: seven failures
are S3 existing-target one-mount copy, separate-client copy and cross-mount mv,
both Memory/S3 existing-target directions, and both Memory/WebDAV directions.
Historical 28/38 and unsafe intermediate counts are not replaced or relabeled.
Root must explicitly decide any input-qualification delta to the frozen manual
clients. Supporting existing provider-owned factories in this new author cohort
does not close the original arbitrary/manual-provider gate.

## Reproduction

Run from the repository root with Node 22 and the installed development tools:

```sh
node --unhandled-rejections=strict --import tsx --test tests/fs/memory/comparison.test.ts tests/fs/mount/comparison.test.ts tests/fs/mount/identity-scope.test.ts tests/fs/mount/copy-identity.test.ts tests/fs/mount/copy-identity-guards.test.ts tests/fs/overlay/copy-identity.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/{memory,real,mount,readonly,overlay}/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/conformance/shared.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/mount/identity-authority-review/implementation/*.test.ts
node --unhandled-rejections=strict --import tsx --test tests/fs/mount/identity-compatibility-review/compatibility.test.ts
node --unhandled-rejections=strict --import tsx tests/fs/mount/mutation-identity.probe.ts
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/fs/{memory,real,mount,readonly,overlay}/*.ts tests/fs/{memory,real,mount,readonly,overlay}/*.ts
```

The original compatibility command intentionally exits nonzero while its seven
required proof gates remain unresolved. Raw TAP is retained verbatim, including
Node diagnostic whitespace. No full unrelated repository suite was run. Real
chmod differences, remote rename/rmdir limitations, and unrelated worker changes
remain outside this checkpoint.
