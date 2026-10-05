# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-04T07:53:41.108Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 3.261 ms
- **Total Suite Duration**: 793.194 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.70 | 7.07 | 5.77 | 4.69 | 7.22 | 173.4 | 9439 |
| pipelines | pipeline-6-stage-stream | 2.79 | 3.25 | 2.81 | 2.38 | 3.32 | 355.7 | 7548 |
| search | search-rg-find-monorepo | 10.23 | 10.99 | 9.65 | 7.51 | 11.15 | 103.7 | 23689 |
| text-processing | text-awk-sed-log-analytics | 0.77 | 2.77 | 1.25 | 0.64 | 3.24 | 798.5 | 1559 |
| structured-data | structured-jq-yq-pipeline | 0.81 | 1.30 | 0.94 | 0.76 | 1.39 | 1058.4 | 2088 |
| database | sqlite3-join-aggregation | 0.75 | 1.42 | 0.85 | 0.50 | 1.57 | 1181.5 | 1759 |
| archives | archive-tar-gzip-sha256-roundtrip | 9.80 | 15.54 | 10.81 | 7.31 | 16.48 | 92.5 | 25496 |
| compression | compression-zstd-xz-stream | 12.79 | 14.71 | 12.97 | 11.13 | 14.73 | 77.1 | 29573 |
| vfs | vfs-tree-clone-chmod-stat | 5.74 | 7.05 | 5.99 | 4.95 | 7.14 | 167.0 | 7924 |
| math-utils | math-awk-bc-numfmt-reduction | 1.14 | 2.82 | 1.69 | 1.09 | 3.00 | 592.3 | 4255 |
| chaos | chaos-adversarial-find-xargs0 | 2.21 | 3.15 | 2.51 | 2.03 | 3.19 | 397.7 | 3735 |
| lifecycle | shell-cold-start-and-exec | 1.33 | 1.45 | 1.30 | 1.08 | 1.45 | 766.7 | 1936 |
| diff-patch | diff-patch-diff3-merge | 4.44 | 6.29 | 4.39 | 2.48 | 6.34 | 227.7 | 5953 |
| csv-analytics | csvkit-xan-data-science | 4.07 | 4.86 | 4.19 | 3.70 | 4.97 | 238.8 | 7802 |
| web-scraping | htmlq-xmllint-web-scraping | 1.26 | 3.39 | 1.83 | 1.09 | 3.78 | 544.8 | 2700 |
| session-state | session-state-json-roundtrip | 2.44 | 3.68 | 2.63 | 1.51 | 3.70 | 379.5 | 5097 |
| document-media | document-mermaid-svg-pipeline | 1.10 | 2.58 | 1.52 | 0.90 | 2.80 | 656.3 | 1705 |
| agent-workflow | agent-refactor-release-pipeline | 17.71 | 19.56 | 16.86 | 13.23 | 19.86 | 59.3 | 30075 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.71 | 4.25 | 3.10 | 2.38 | 4.41 | 322.3 | 4950 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.61 | 1.85 | 1.64 | 1.48 | 1.90 | 610.3 | 2271 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 44.58 | 51.59 | 44.25 | 37.17 | 52.09 | 22.6 | 82954 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 3.19 | 4.40 | 3.35 | 2.63 | 4.70 | 298.6 | 8765 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.30 | 6.85 | 3.93 | 2.38 | 7.69 | 254.2 | 7474 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 1.78 | 2.00 | 1.77 | 1.59 | 2.04 | 563.7 | 7504 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 7.95 | 12.69 | 8.76 | 5.39 | 13.38 | 114.2 | 16395 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 3.87 | 4.25 | 3.85 | 3.28 | 4.32 | 259.5 | 7151 |
