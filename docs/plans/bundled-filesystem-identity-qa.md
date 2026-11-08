# Bundled filesystem identity QA

Unit graph tests cover consumer alias/external resolution. Execute real native esbuild output and constructor/authority identity separately.

1. Bundle three safe-fs producer entries with ESM splitting and Node 18 targeting: the public entry, memory entry, and readonly entry. Keep generated files in memory.
2. Build a consumer re-export through `resolveConsumerGraph`, using workspace `@poe-code/safe-fs` and public specifier `poe-code/safe-fs`. Also build a deliberately duplicated consumer through the raw source alias.
3. Transform generated outputs to CommonJS and load them with one in-memory module cache. Resolve the public specifier to the producer's public entry; resolve relative chunks through their generated paths. Do not write fixture files to disk.
4. Verify consumer FsError, producer memory MemoryFileSystem, and producer readonly ReadOnlyFileSystem are identical to public constructors. Verify the deliberately duplicated FsError differs and its instance is not a public FsError.
5. Write distinct files to a public memory filesystem and consumer mock-S3 filesystem. Their entry comparison must be distinct, including through the consumer readonly wrapper. An independently duplicated S3 instance must compare as unknown. A missing memory file must reject with the consumer FsError.
6. Inspect consumer metafile inputs: none may include safe-fs source files. This ensures the producer owns the shared authority registry.
7. Keep execution evidence under `out`, inspect it, then remove only that temporary evidence.
