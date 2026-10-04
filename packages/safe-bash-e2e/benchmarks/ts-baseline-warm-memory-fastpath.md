# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-04T05:43:56.008Z`
- **Git Commit**: `81dc544aad`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 18
- **Geometric Mean p50**: 2.503 ms
- **Total Suite Duration**: 356.368 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.04 | 5.56 | 4.88 | 4.31 | 5.68 | 204.9 | 7599 |
| pipelines | pipeline-6-stage-stream | 2.59 | 4.10 | 2.90 | 2.25 | 4.43 | 345.3 | 6477 |
| search | search-rg-find-monorepo | 8.25 | 9.18 | 8.26 | 7.18 | 9.27 | 121.0 | 21208 |
| text-processing | text-awk-sed-log-analytics | 0.62 | 0.92 | 0.69 | 0.57 | 0.97 | 1446.6 | 1375 |
| structured-data | structured-jq-yq-pipeline | 0.87 | 1.38 | 1.01 | 0.82 | 1.47 | 988.0 | 1985 |
| database | sqlite3-join-aggregation | 0.73 | 0.90 | 0.71 | 0.51 | 0.91 | 1407.3 | 1812 |
| archives | archive-tar-gzip-sha256-roundtrip | 7.48 | 7.91 | 6.96 | 5.87 | 8.00 | 143.8 | 19678 |
| compression | compression-zstd-xz-stream | 11.92 | 15.79 | 12.48 | 8.98 | 16.40 | 80.1 | 30079 |
| vfs | vfs-tree-clone-chmod-stat | 4.05 | 4.32 | 4.00 | 3.49 | 4.33 | 250.2 | 6424 |
| math-utils | math-awk-bc-numfmt-reduction | 1.19 | 1.90 | 1.33 | 1.00 | 2.04 | 750.8 | 3227 |
| chaos | chaos-adversarial-find-xargs0 | 1.51 | 1.94 | 1.60 | 1.43 | 2.03 | 625.5 | 2618 |
| lifecycle | shell-cold-start-and-exec | 1.15 | 1.23 | 1.13 | 1.01 | 1.23 | 884.3 | 1825 |
| diff-patch | diff-patch-diff3-merge | 3.69 | 4.00 | 3.52 | 2.89 | 4.06 | 284.1 | 4742 |
| csv-analytics | csvkit-xan-data-science | 3.89 | 4.62 | 3.93 | 3.37 | 4.80 | 254.4 | 7251 |
| web-scraping | htmlq-xmllint-web-scraping | 1.33 | 3.93 | 1.90 | 0.97 | 4.54 | 525.6 | 2960 |
| session-state | session-state-json-roundtrip | 1.83 | 3.35 | 2.06 | 1.33 | 3.66 | 485.6 | 4256 |
| document-media | document-mermaid-svg-pipeline | 1.10 | 2.60 | 1.51 | 0.91 | 2.85 | 662.9 | 1630 |
| agent-workflow | agent-refactor-release-pipeline | 12.07 | 13.77 | 12.40 | 11.63 | 14.17 | 80.6 | 25524 |
