# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-06T08:03:18.878Z`
- **Git Commit**: `eefb24200b`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 3.455 ms
- **Total Suite Duration**: 992.134 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.25 | 5.08 | 3.87 | 3.17 | 5.22 | 258.2 | 10159 |
| pipelines | pipeline-6-stage-stream | 4.43 | 5.71 | 4.61 | 3.86 | 6.01 | 216.8 | 12041 |
| search | search-rg-find-monorepo | 4.96 | 5.66 | 5.04 | 4.67 | 5.84 | 198.4 | 7846 |
| text-processing | text-awk-sed-log-analytics | 0.69 | 0.70 | 0.68 | 0.65 | 0.71 | 1468.5 | 2046 |
| structured-data | structured-jq-yq-pipeline | 1.47 | 2.44 | 1.73 | 1.44 | 2.64 | 577.8 | 2486 |
| database | sqlite3-join-aggregation | 0.59 | 0.60 | 0.58 | 0.57 | 0.60 | 1708.9 | 519 |
| archives | archive-tar-gzip-sha256-roundtrip | 6.12 | 7.02 | 6.27 | 5.67 | 7.12 | 159.5 | 11018 |
| compression | compression-zstd-xz-stream | 12.76 | 21.27 | 14.72 | 10.08 | 22.42 | 67.9 | 21005 |
| vfs | vfs-tree-clone-chmod-stat | 7.06 | 8.64 | 7.54 | 6.60 | 8.73 | 132.6 | 15389 |
| math-utils | math-awk-bc-numfmt-reduction | 0.93 | 1.20 | 0.98 | 0.78 | 1.22 | 1024.6 | 2396 |
| chaos | chaos-adversarial-find-xargs0 | 2.61 | 2.68 | 2.60 | 2.52 | 2.68 | 384.2 | 3605 |
| lifecycle | shell-cold-start-and-exec | 0.55 | 1.55 | 0.79 | 0.50 | 1.78 | 1264.4 | 1351 |
| diff-patch | diff-patch-diff3-merge | 4.69 | 5.68 | 4.79 | 3.96 | 5.79 | 208.6 | 7908 |
| csv-analytics | csvkit-xan-data-science | 3.52 | 4.51 | 3.66 | 3.14 | 4.75 | 273.0 | 9857 |
| web-scraping | htmlq-xmllint-web-scraping | 4.25 | 4.59 | 4.21 | 3.73 | 4.64 | 237.6 | 7312 |
| session-state | session-state-json-roundtrip | 1.16 | 1.49 | 1.22 | 1.03 | 1.56 | 822.1 | 1897 |
| document-media | document-mermaid-svg-pipeline | 1.36 | 1.45 | 1.38 | 1.34 | 1.46 | 724.3 | 1266 |
| agent-workflow | agent-refactor-release-pipeline | 21.42 | 23.91 | 21.87 | 20.38 | 24.48 | 45.7 | 35190 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.48 | 2.82 | 2.55 | 2.40 | 2.90 | 392.5 | 4545 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.45 | 2.95 | 2.60 | 2.33 | 2.98 | 384.0 | 2667 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 35.49 | 37.04 | 35.55 | 34.01 | 37.18 | 28.1 | 43294 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 4.82 | 5.74 | 4.92 | 4.34 | 5.89 | 203.2 | 11135 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.01 | 4.00 | 3.21 | 2.87 | 4.25 | 311.5 | 7684 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.00 | 3.80 | 3.19 | 2.71 | 3.86 | 313.6 | 10108 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 54.58 | 63.55 | 57.27 | 53.30 | 64.59 | 17.5 | 96641 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.62 | 2.68 | 2.57 | 2.31 | 2.68 | 388.6 | 5434 |
