# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-04T06:37:56.806Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 20
- **Geometric Mean p50**: 2.54 ms
- **Total Suite Duration**: 477.457 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.38 | 6.15 | 5.29 | 4.18 | 6.18 | 188.9 | 8792 |
| pipelines | pipeline-6-stage-stream | 2.49 | 3.23 | 2.58 | 1.88 | 3.34 | 386.9 | 6941 |
| search | search-rg-find-monorepo | 8.20 | 11.60 | 9.19 | 7.74 | 11.68 | 108.8 | 22559 |
| text-processing | text-awk-sed-log-analytics | 0.67 | 1.08 | 0.77 | 0.58 | 1.15 | 1300.0 | 1785 |
| structured-data | structured-jq-yq-pipeline | 0.85 | 1.41 | 0.96 | 0.77 | 1.56 | 1040.5 | 1849 |
| database | sqlite3-join-aggregation | 0.63 | 0.87 | 0.64 | 0.40 | 0.88 | 1555.7 | 1207 |
| archives | archive-tar-gzip-sha256-roundtrip | 6.94 | 8.96 | 7.11 | 5.47 | 9.13 | 140.7 | 16638 |
| compression | compression-zstd-xz-stream | 10.96 | 14.01 | 11.59 | 9.68 | 14.44 | 86.3 | 24726 |
| vfs | vfs-tree-clone-chmod-stat | 5.23 | 5.74 | 5.25 | 4.87 | 5.83 | 190.3 | 9556 |
| math-utils | math-awk-bc-numfmt-reduction | 1.24 | 1.31 | 1.17 | 0.95 | 1.31 | 854.2 | 2733 |
| chaos | chaos-adversarial-find-xargs0 | 1.91 | 2.65 | 2.08 | 1.76 | 2.75 | 480.7 | 3925 |
| lifecycle | shell-cold-start-and-exec | 1.34 | 1.70 | 1.39 | 1.20 | 1.78 | 718.8 | 1374 |
| diff-patch | diff-patch-diff3-merge | 3.46 | 5.22 | 3.59 | 2.59 | 5.78 | 278.7 | 5605 |
| csv-analytics | csvkit-xan-data-science | 4.16 | 5.52 | 4.33 | 3.49 | 5.74 | 230.9 | 9029 |
| web-scraping | htmlq-xmllint-web-scraping | 1.34 | 2.73 | 1.60 | 0.99 | 3.06 | 625.0 | 2108 |
| session-state | session-state-json-roundtrip | 1.82 | 3.50 | 2.14 | 1.41 | 3.85 | 468.3 | 4077 |
| document-media | document-mermaid-svg-pipeline | 1.11 | 2.36 | 1.38 | 0.88 | 2.65 | 723.6 | 1466 |
| agent-workflow | agent-refactor-release-pipeline | 13.76 | 15.68 | 13.75 | 11.83 | 16.13 | 72.7 | 26812 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.52 | 2.78 | 2.53 | 2.31 | 2.83 | 394.8 | 4237 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.83 | 3.64 | 2.22 | 1.69 | 4.18 | 450.6 | 5351 |
