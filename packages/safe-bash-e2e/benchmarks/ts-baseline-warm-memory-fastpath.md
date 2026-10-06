# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-06T04:14:28.551Z`
- **Git Commit**: `ff78f654ea`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 4.094 ms
- **Total Suite Duration**: 1002.872 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.59 | 5.96 | 5.47 | 4.82 | 6.04 | 182.7 | 9301 |
| pipelines | pipeline-6-stage-stream | 6.14 | 7.27 | 6.55 | 6.09 | 7.31 | 152.5 | 15462 |
| search | search-rg-find-monorepo | 3.93 | 4.39 | 3.94 | 3.60 | 4.47 | 254.0 | 5799 |
| text-processing | text-awk-sed-log-analytics | 1.03 | 1.89 | 1.22 | 0.96 | 2.09 | 816.9 | 2054 |
| structured-data | structured-jq-yq-pipeline | 2.08 | 2.62 | 2.23 | 1.95 | 2.66 | 448.6 | 2522 |
| database | sqlite3-join-aggregation | 1.26 | 1.64 | 1.19 | 0.85 | 1.73 | 838.1 | 1156 |
| archives | archive-tar-gzip-sha256-roundtrip | 7.33 | 7.96 | 6.92 | 5.46 | 8.00 | 144.6 | 16951 |
| compression | compression-zstd-xz-stream | 14.72 | 17.72 | 14.94 | 12.23 | 18.20 | 67.0 | 31667 |
| vfs | vfs-tree-clone-chmod-stat | 3.72 | 4.10 | 3.81 | 3.56 | 4.10 | 262.1 | 6362 |
| math-utils | math-awk-bc-numfmt-reduction | 1.19 | 1.40 | 1.25 | 1.16 | 1.43 | 803.0 | 1540 |
| chaos | chaos-adversarial-find-xargs0 | 1.82 | 2.62 | 1.99 | 1.64 | 2.78 | 503.3 | 2724 |
| lifecycle | shell-cold-start-and-exec | 1.69 | 1.84 | 1.69 | 1.44 | 1.85 | 593.2 | 2048 |
| diff-patch | diff-patch-diff3-merge | 6.03 | 6.93 | 6.15 | 5.52 | 7.06 | 162.5 | 9165 |
| csv-analytics | csvkit-xan-data-science | 4.75 | 5.37 | 4.71 | 3.95 | 5.38 | 212.1 | 7922 |
| web-scraping | htmlq-xmllint-web-scraping | 5.35 | 6.26 | 5.44 | 4.60 | 6.35 | 184.0 | 11636 |
| session-state | session-state-json-roundtrip | 1.79 | 3.27 | 2.12 | 1.55 | 3.63 | 471.9 | 2121 |
| document-media | document-mermaid-svg-pipeline | 1.76 | 3.04 | 1.97 | 1.34 | 3.29 | 507.4 | 2528 |
| agent-workflow | agent-refactor-release-pipeline | 14.70 | 15.64 | 15.00 | 14.54 | 15.69 | 66.6 | 28019 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.55 | 2.59 | 2.53 | 2.40 | 2.60 | 395.7 | 3836 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.40 | 2.64 | 2.35 | 2.00 | 2.66 | 425.2 | 5741 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 35.13 | 35.56 | 35.03 | 33.80 | 35.57 | 28.6 | 49865 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.63 | 7.28 | 6.68 | 5.95 | 7.33 | 149.8 | 11204 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.14 | 4.59 | 3.63 | 2.83 | 4.64 | 275.5 | 4059 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.51 | 4.62 | 3.71 | 3.13 | 4.89 | 269.4 | 5008 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 54.97 | 63.53 | 57.45 | 53.85 | 64.61 | 17.4 | 118202 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.52 | 3.02 | 2.62 | 2.32 | 3.12 | 382.5 | 4010 |
