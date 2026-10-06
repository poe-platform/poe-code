# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-06T04:14:33.100Z`
- **Git Commit**: `ff78f654ea`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 3.368 ms
- **Total Suite Duration**: 963.54 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.55 | 5.03 | 3.98 | 3.34 | 5.17 | 251.0 | 10597 |
| pipelines | pipeline-6-stage-stream | 4.36 | 5.90 | 4.75 | 3.71 | 5.98 | 210.4 | 11851 |
| search | search-rg-find-monorepo | 4.62 | 5.30 | 4.84 | 4.45 | 5.31 | 206.4 | 8071 |
| text-processing | text-awk-sed-log-analytics | 0.70 | 0.71 | 0.69 | 0.66 | 0.71 | 1438.5 | 1638 |
| structured-data | structured-jq-yq-pipeline | 1.60 | 2.48 | 1.77 | 1.40 | 2.69 | 566.4 | 2511 |
| database | sqlite3-join-aggregation | 0.59 | 0.63 | 0.60 | 0.56 | 0.63 | 1667.2 | 531 |
| archives | archive-tar-gzip-sha256-roundtrip | 5.51 | 6.72 | 5.93 | 5.39 | 6.75 | 168.7 | 10556 |
| compression | compression-zstd-xz-stream | 12.04 | 20.58 | 13.97 | 9.68 | 21.64 | 71.6 | 20755 |
| vfs | vfs-tree-clone-chmod-stat | 7.04 | 7.64 | 6.92 | 6.15 | 7.78 | 144.4 | 13558 |
| math-utils | math-awk-bc-numfmt-reduction | 0.78 | 0.85 | 0.79 | 0.76 | 0.86 | 1259.3 | 3408 |
| chaos | chaos-adversarial-find-xargs0 | 2.51 | 2.66 | 2.54 | 2.48 | 2.68 | 392.9 | 3549 |
| lifecycle | shell-cold-start-and-exec | 0.54 | 0.55 | 0.53 | 0.50 | 0.55 | 1890.6 | 600 |
| diff-patch | diff-patch-diff3-merge | 3.98 | 5.31 | 4.42 | 3.81 | 5.38 | 226.2 | 7434 |
| csv-analytics | csvkit-xan-data-science | 3.41 | 4.81 | 3.68 | 3.17 | 5.14 | 271.7 | 8323 |
| web-scraping | htmlq-xmllint-web-scraping | 4.27 | 4.58 | 4.20 | 3.76 | 4.60 | 238.0 | 7129 |
| session-state | session-state-json-roundtrip | 1.13 | 1.46 | 1.18 | 1.03 | 1.53 | 844.5 | 1721 |
| document-media | document-mermaid-svg-pipeline | 1.37 | 1.49 | 1.41 | 1.36 | 1.49 | 708.0 | 1297 |
| agent-workflow | agent-refactor-release-pipeline | 19.40 | 20.57 | 19.50 | 18.29 | 20.77 | 51.3 | 36103 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.38 | 2.45 | 2.40 | 2.37 | 2.46 | 417.1 | 3174 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.11 | 2.28 | 2.15 | 2.08 | 2.31 | 465.6 | 2584 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 36.09 | 37.01 | 36.15 | 35.29 | 37.02 | 27.7 | 43713 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 5.35 | 6.10 | 5.24 | 4.55 | 6.28 | 190.8 | 12215 |
| document-media | media-office-ffmpeg-soffice-pipeline | 2.98 | 4.20 | 3.29 | 2.95 | 4.48 | 304.0 | 8180 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.08 | 3.98 | 3.22 | 2.73 | 4.19 | 310.5 | 8217 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 56.48 | 58.66 | 56.10 | 52.41 | 58.81 | 17.8 | 95742 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.48 | 2.56 | 2.44 | 2.19 | 2.57 | 410.1 | 4873 |
