# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-04T03:30:53.941Z`
- **Git Commit**: `a37b2c1c86`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 12
- **Geometric Mean p50**: 2.871 ms
- **Total Suite Duration**: 291.222 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.08 | 5.97 | 5.36 | 4.98 | 6.04 | 186.5 | 7913 |
| pipelines | pipeline-6-stage-stream | 3.77 | 5.52 | 4.29 | 3.63 | 5.77 | 233.2 | 9937 |
| search | search-rg-find-monorepo | 10.20 | 10.68 | 10.14 | 9.08 | 10.71 | 98.6 | 24804 |
| text-processing | text-awk-sed-log-analytics | 0.73 | 1.03 | 0.82 | 0.65 | 1.04 | 1226.1 | 1668 |
| structured-data | structured-jq-yq-pipeline | 0.92 | 1.80 | 1.12 | 0.83 | 1.99 | 890.4 | 2245 |
| database | sqlite3-join-aggregation | 0.86 | 1.66 | 0.99 | 0.54 | 1.80 | 1008.3 | 2021 |
| archives | archive-tar-gzip-sha256-roundtrip | 12.54 | 15.65 | 12.10 | 7.61 | 15.87 | 82.6 | 24710 |
| compression | compression-zstd-xz-stream | 13.32 | 15.78 | 13.46 | 11.49 | 16.26 | 74.3 | 29031 |
| vfs | vfs-tree-clone-chmod-stat | 5.06 | 5.48 | 5.11 | 4.55 | 5.51 | 195.9 | 7329 |
| math-utils | math-awk-bc-numfmt-reduction | 1.28 | 2.20 | 1.51 | 1.14 | 2.37 | 660.2 | 3834 |
| chaos | chaos-adversarial-find-xargs0 | 2.34 | 2.46 | 2.29 | 1.95 | 2.49 | 436.7 | 4201 |
| lifecycle | shell-cold-start-and-exec | 1.10 | 1.16 | 1.05 | 0.91 | 1.16 | 951.6 | 1739 |
