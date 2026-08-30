# Independent YQ build — Part A complete

August 28, 2026. **One scoped compiler attempt passed; no product or consumer run.**

Pre-execution commit: `94573dca`. BUILD-PRESEAL.json SHA-256:
`0577678fbc1a6f3cb73e615213c378645f0e7f706f620e9c7be1fbed95c8f469`.
The accepted composition/runtime reviews and old packet were authenticated before
work. No old receipt, failed aggregate, source file, framework or package changed.

## Evidence

- Exact 271-file selected source tree, separate from the retained full 273-file
  archive. Its 217 TypeScript sources emitted exactly 868 compiler outputs.
- Node v22.22.2, TypeScript 5.9.3, Node types and undici-types were hash-pinned and
  copied as regular files outside source/output trees. Complete tool maps, modes,
  command/environment/umask and source projection are sealed in INPUTS.json.
- Compiler PID 86780 exited **0**, naturally reaped/group absent, in **4812.600917 ms**.
  stdout/stderr are both zero bytes. No timeout, signal, overflow, retry or rerun.
  COMPILER-PROCESS.json and raw captures were written before success assertions.
- **434 raw JavaScript/declaration files match byte-for-byte.** The other 434 files
  are 217 source maps and 217 declaration maps. Raw maps remain preserved and differ
  in their out-of-tree source path. After only the previously sealed `sources[0]`
  relocation, **all 434 maps match byte-for-byte**, including all other fields and
  compiler JSON serialization. OUTPUT-COMPARISONS.json records each raw/expected/
  relocated hash and selected source identity; no other mismatch was normalized.
- Full package map equality is **846 baseline entries + 24 additions = 870**, with
  exact baseline README/package metadata and directory/file modes retained.

## Independent package

The independently compiled/explicitly relocated package is at:
`/private/tmp/yq-independent-build-35da1854-PJ4uYL/independent-package`.

The single USTAR/gzip serialization produced:
`/private/tmp/yq-independent-build-35da1854-PJ4uYL/evidence/virtual-bash-0.0.0.tgz`

Its 782,141 bytes match SHA-256
`2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d`.
The uncompressed 4,999,168-byte USTAR matches SHA-256
`a0e8e4bde1cd9981d5e47d5018dc67cb25b0d3ba7fe5363396a942192d1c9c8b`.
Both derive from new compiler outputs, not copied author-emitted files. Only
README/package metadata come from the authenticated source, as presealed.

Raw compiler output is separately retained at:
`/private/tmp/yq-independent-build-35da1854-PJ4uYL/raw-output`.
The new source and tools remain in sibling `source/` and `tools/` directories.
Every original/moved source/package tree, the full 273-file archive, five raw
artifact files, copied source, original/copied tools and old packet were checked
before/after for complete membership, bytes and modes, including additions.
These snapshots are not transactions or change-and-restore protection. No historical
move was rerun, and this part does not claim new moved-product execution.

## New proof and remaining boundary

INDEPENDENT-BUILD-RECEIPT.json has classification
`INDEPENDENT_SCOPED_BUILD_WITH_EXPLICIT_SOURCE_MAP_RELOCATION` and raw SHA-256
`ae74c3f95061d481aec2dab99260214eb22babf5b1d2682b37928a9cc8dd62d6`.
The old packet remains BOUND_AUTHOR_BUILD; its evidence is not rewritten. New
FULL-RECEIPT.json preserves the consumers' exact schema and points to this new
build proof. Root-trusted receipt status is deliberately not self-granted.

Selected-source file-map SHA-256:
`e01d63d8e782cba59597da7c970cbd364a35582e4956ab04759064c756df1284`.
Full package-map SHA-256:
`4ce4908953986584ae50f61976796d9ee7c1259e7c0d009afa4b675225496088`.

Root must explicitly route the additive independent build proof: integration-v2
still pins the old author receipt and AUTHOR_ARTIFACT_BINDING_ONLY role. This is
an unchanged integration boundary, not a source/build failure. No API was patched
and no actual positive compound runtime binding was executed by this worker.

Consumer type tests, semantic vectors, author 26+19 tests, loaded-code, moved,
lifecycle and CARRY review are **not run here**. Product imports/execution, npm,
native YAML, private imports and new dependencies are zero. The scoped build uses
the unchanged skipLibCheck:true profile; it is not a declaration-consumer pass,
global typecheck green or public YQ integration. Public exports remain absent.
The original 409 refusal, supplemental wildcard-audit failure, and all independent
review postprocessor failures are preserved without rescoring or source-bug claims.

EXPECTED-HASHES.json, HANDOFF-BINDINGS.json and FINAL-SEAL.json provide the additive
root route. Authenticate the verifier from the committed seal before invoking:

```text
node tests/commands/yq-independent-20260828/candidate-35da1854-build-v1/verify-seal.mjs INDEPENDENT_FINAL_SEAL_SHA256
```

Readiness is published at `/tmp/yq-build-independent-ready.txt`. This worker stops
naturally after Part A; the separately owned actual review continues elsewhere.
