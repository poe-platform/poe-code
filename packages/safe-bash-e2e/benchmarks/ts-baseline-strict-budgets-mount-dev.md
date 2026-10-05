# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-04T07:53:45.616Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 2.679 ms
- **Total Suite Duration**: 854.48 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.07 | 6.33 | 3.95 | 2.94 | 6.96 | 253.2 | 14040 |
| pipelines | pipeline-6-stage-stream | 1.66 | 2.65 | 1.90 | 1.54 | 2.87 | 526.0 | 8098 |
| search | search-rg-find-monorepo | 13.73 | 15.47 | 13.55 | 11.33 | 15.53 | 73.8 | 20651 |
| text-processing | text-awk-sed-log-analytics | 0.48 | 2.85 | 1.07 | 0.46 | 3.43 | 934.2 | 1110 |
| structured-data | structured-jq-yq-pipeline | 0.62 | 0.66 | 0.63 | 0.60 | 0.67 | 1593.0 | 809 |
| database | sqlite3-join-aggregation | 0.30 | 0.51 | 0.35 | 0.29 | 0.56 | 2831.3 | 794 |
| archives | archive-tar-gzip-sha256-roundtrip | 5.77 | 5.87 | 5.51 | 4.83 | 5.89 | 181.4 | 7953 |
| compression | compression-zstd-xz-stream | 11.94 | 16.56 | 12.70 | 10.61 | 17.67 | 78.7 | 29273 |
| vfs | vfs-tree-clone-chmod-stat | 10.21 | 11.39 | 9.71 | 7.59 | 11.53 | 103.0 | 15809 |
| math-utils | math-awk-bc-numfmt-reduction | 1.01 | 3.56 | 1.72 | 0.77 | 3.93 | 582.3 | 3803 |
| chaos | chaos-adversarial-find-xargs0 | 3.62 | 4.86 | 3.72 | 2.82 | 5.04 | 269.0 | 5995 |
| lifecycle | shell-cold-start-and-exec | 0.28 | 0.30 | 0.28 | 0.26 | 0.31 | 3580.4 | 279 |
| diff-patch | diff-patch-diff3-merge | 2.58 | 4.73 | 3.11 | 2.46 | 5.25 | 321.8 | 4697 |
| csv-analytics | csvkit-xan-data-science | 4.02 | 8.17 | 4.85 | 3.26 | 9.15 | 206.3 | 9104 |
| web-scraping | htmlq-xmllint-web-scraping | 1.03 | 1.52 | 1.16 | 0.94 | 1.58 | 859.9 | 1526 |
| session-state | session-state-json-roundtrip | 1.00 | 2.88 | 1.47 | 0.96 | 3.33 | 679.6 | 2275 |
| document-media | document-mermaid-svg-pipeline | 1.12 | 1.92 | 1.31 | 1.08 | 2.10 | 760.5 | 4217 |
| agent-workflow | agent-refactor-release-pipeline | 21.66 | 32.89 | 24.35 | 19.55 | 34.77 | 41.1 | 31523 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.32 | 3.79 | 2.65 | 2.09 | 4.15 | 377.7 | 4778 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.84 | 3.98 | 2.32 | 1.66 | 4.51 | 431.4 | 3088 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 49.36 | 60.68 | 49.11 | 36.59 | 61.90 | 20.4 | 90930 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 2.75 | 5.26 | 3.56 | 2.71 | 5.55 | 280.6 | 11910 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.71 | 16.78 | 6.68 | 2.67 | 19.96 | 149.6 | 12119 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 1.48 | 1.70 | 1.54 | 1.46 | 1.74 | 647.5 | 3636 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 7.80 | 8.86 | 7.79 | 6.43 | 8.86 | 128.4 | 14742 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 4.56 | 9.01 | 5.91 | 3.92 | 9.41 | 169.4 | 10882 |
