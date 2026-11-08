# Eleven consumer classifications, with current routes retained

2026-08-27. Author inventory/route source `5c2a3744`; extended smoke replay source
`522e8e27`. Different gate-infrastructure review pending. No whole gate ran.

## Each previously unknown input

All paths below are under `tests/commands/`. The exact input, source and package
hashes and historical evidence hashes are recorded individually in
`tests/plugins/qualified-current-release/inventory.json` at `5c2a3744`.

| Input | Classification and reason |
| --- | --- |
| `column-stress/current-contract-review/consumer.mts` | Frozen `3af3f628` internal-module/type sidecar; its unawaited type-only call is not current runtime acceptance. |
| `column-stress/handoff-20260827/packed-types.mts` | Frozen `38cb670a` author type capture with unused invocation function; preserve its historical HOLD. |
| `column-stress/padding-evolution/execution-20260827/packed-types.mts` | Frozen `a8096354` padding capture; identical text does not merge distinct source/package histories. |
| `grep-aliases-stress/verification/public-consumer.mts` | Frozen `04644bc2` internal installed-module type capture; maintain the actual public consumer separately. |
| `grep-aliases-stress/verification/holdouts.mts` | Frozen `04644bc2` capture/worker driver, not a reusable current canonical test. Preserve original failures and separate settlement-v2 acceptance. |
| `grep-aliases-stress/verification/coverage-supplement/pipeline-holdouts.mts` | Frozen supplement of that exact package, requiring explicit output/worker hooks; not default current execution. |
| `grep-aliases/consumer.mts` | Maintained current strict/runtime consumer. Only two imports change from repo-relative dist to root/public subpath; all body assertions remain byte-identical. |
| `network-zero-caps-review/consumer.mts` | Maintained current strict/runtime consumer, byte-unchanged, using injected offline transport and public root/subpath imports. |
| `network-zero-caps-review/mutations.d.mts` | Declaration imported by the existing holdout/helper route, not a standalone runtime test. |
| `network-zero-caps-review/offline.d.mts` | Same declaration role, individually hash-authenticated. |
| `network-zero-caps-review/runtime.d.mts` | Same declaration role, individually hash-authenticated. |

Six frozen inputs are preserved, not deleted, rewritten or called current
passes. Their evidence binds exact source/package identities. New maintained
`tests/plugins/qualified-current-release/current-column.mts` covers the useful
union of column options/types and awaits actual stdin/VFS/direct/plugin work.
The original alias consumer body is retained in `alias-consumer-original.mts.data`.

The previous179 classifications are deep-equal unchanged. Twelve entries (eleven
old inputs plus the new column consumer) give191:33 current,147 frozen evidence,
7 declarations,1 frozen oracle,3 exact negative types. Routing now configures
22 strict groups,19 runtime groups and3 negative groups. **Only the three new
strict/runtime groups were executed in this author task**, not that entire set.
Unknown inputs, missing current routes, missing/changed historical data/proofs
and a missing exact-negative route still reject. No blanket compiler exclusion.

## Actual author captures, including failed attempts

All84 raw files are losslessly encoded in `CAPTURES.json.gz.base64`; the manifest
binds each path/size/SHA and each attempt. Decode the gzip as a JSON map of paths
to base64 bytes. `verify-captures.mjs` reads/verifies without writing files.

| Attempt | Product and result | Classification |
| --- | --- | --- |
| 01 | Isolated `3dc0ac26`, zero completed groups,6 inventory controls | Harness path defect: `/var` symlink spelling was outside the actual canonical permission root. Fixed by canonicalizing the owned temp root, not widening permissions. |
| 02 | Same `3dc0ac26` package,2/3 groups,6 controls | Wrong product cohort for the new zero-cap consumer: source predates `bb7f5972`, so maxRedirects0 correctly rejects there. Consumer expectations were not changed. |
| 03 | Explicit committed `c355751f`,3/3 groups,11 controls | Build, packed/moved current consumers, strict same-package types, three TS2322 API negatives, missing public module and forbidden source-read controls pass. |
| 04 | Same `c355751f` and package,3/3 groups,11 controls | Adds actual73-name smoke,27 imports,6 workflows and strict root/subpath public fixture; all pass. |

Final product commit: `c355751f36ca3fdbab8f888eaab30203c1bcd343`.
Tarball SHA256: `53ab62a59574d79607692ab2d67a22f8825bf7a68b1aa17b59392c9d7cf7bf0a`.
Package.json SHA256: `691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535`.
These are distinct artifacts. The earlier3dc tarball remains `994dca3730…`.

Node24.11.1 is explicitly selected/hash-checked; npm's CLI file resides under the
Node22 installation but is executed by that selected Node24 binary. Runtime
permission/source-denial flags remain. Product files come from the committed
archive; only explicitly external consumer/harness inputs are supplied. Success
requires unchanged original product hashes and installed declaration bindings.
Execution temp trees are removed; raw capture outputs are retained here.

First attempts were author worktree harness captures, not separately sealed
exact harness commits. Their argv, raw diagnostics and product/package bindings
remain evidence; the published replay commit is not retroactively their SHA.
The c355 source includes other pending work: scoped consumers/build do not accept
all of it or select it as the next whole-gate candidate. No service/native
semantics, private engine tests or whole-source typecheck were run here.

```sh
node tests/integration/full-gate-20260827/consumer-inventory-73/verify-captures.mjs
node tests/integration/full-gate-20260827/consumer-inventory-73/run.mjs
```

The replay is explicit opt-in and uses the fixed c355 product, cached local dev
dependencies, pinned runtime and unique OS-temp evidence; it is not canonical
discovery and must not be represented as a current moving-HEAD gate.
