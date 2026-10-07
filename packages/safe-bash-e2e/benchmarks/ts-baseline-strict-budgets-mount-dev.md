# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-06T16:42:46.246Z`
- **Git Commit**: `ec7d1ab7e5`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 4.618 ms
- **Total Suite Duration**: 1315.1 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.73 | 5.57 | 4.42 | 3.53 | 5.59 | 226.3 | 11774 |
| pipelines | pipeline-6-stage-stream | 6.06 | 6.93 | 5.81 | 4.46 | 7.03 | 172.0 | 16712 |
| search | search-rg-find-monorepo | 6.70 | 7.88 | 6.47 | 5.22 | 8.09 | 154.5 | 10222 |
| text-processing | text-awk-sed-log-analytics | 0.83 | 0.99 | 0.84 | 0.71 | 1.03 | 1187.1 | 2104 |
| structured-data | structured-jq-yq-pipeline | 1.78 | 3.04 | 2.09 | 1.61 | 3.31 | 479.3 | 2790 |
| database | sqlite3-join-aggregation | 0.75 | 0.87 | 0.78 | 0.73 | 0.89 | 1277.0 | 725 |
| archives | archive-tar-gzip-sha256-roundtrip | 7.77 | 7.95 | 7.28 | 6.22 | 7.97 | 137.3 | 12545 |
| compression | compression-zstd-xz-stream | 13.99 | 23.16 | 16.00 | 12.64 | 25.11 | 62.5 | 25705 |
| vfs | vfs-tree-clone-chmod-stat | 8.22 | 8.47 | 7.90 | 6.98 | 8.49 | 126.6 | 16023 |
| math-utils | math-awk-bc-numfmt-reduction | 0.86 | 1.02 | 0.92 | 0.83 | 1.02 | 1092.4 | 3383 |
| chaos | chaos-adversarial-find-xargs0 | 3.00 | 3.13 | 2.99 | 2.76 | 3.13 | 334.8 | 4173 |
| lifecycle | shell-cold-start-and-exec | 0.62 | 1.99 | 0.95 | 0.54 | 2.31 | 1056.1 | 1771 |
| diff-patch | diff-patch-diff3-merge | 4.25 | 6.13 | 4.92 | 4.20 | 6.26 | 203.4 | 8255 |
| csv-analytics | csvkit-xan-data-science | 3.84 | 6.14 | 4.35 | 3.32 | 6.63 | 230.1 | 11528 |
| web-scraping | htmlq-xmllint-web-scraping | 4.97 | 5.51 | 4.90 | 4.32 | 5.61 | 204.1 | 8390 |
| session-state | session-state-json-roundtrip | 1.36 | 1.98 | 1.50 | 1.23 | 2.13 | 668.4 | 2573 |
| document-media | document-mermaid-svg-pipeline | 1.96 | 2.04 | 1.91 | 1.66 | 2.04 | 522.4 | 2951 |
| agent-workflow | agent-refactor-release-pipeline | 45.42 | 50.43 | 42.90 | 34.28 | 50.76 | 23.3 | 61382 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 6.86 | 7.86 | 6.01 | 2.84 | 7.95 | 166.3 | 8725 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 7.54 | 9.48 | 7.87 | 6.88 | 9.83 | 127.1 | 6140 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 42.95 | 44.38 | 42.82 | 41.27 | 44.71 | 23.4 | 56052 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.02 | 6.93 | 6.16 | 5.35 | 6.98 | 162.5 | 13407 |
| document-media | media-office-ffmpeg-soffice-pipeline | 4.43 | 8.06 | 5.15 | 3.54 | 8.79 | 194.3 | 10994 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 5.51 | 6.57 | 5.34 | 3.20 | 6.65 | 187.1 | 11735 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 67.51 | 78.27 | 68.87 | 62.29 | 80.60 | 14.5 | 118329 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 3.58 | 5.01 | 3.90 | 2.96 | 5.07 | 256.6 | 6539 |
