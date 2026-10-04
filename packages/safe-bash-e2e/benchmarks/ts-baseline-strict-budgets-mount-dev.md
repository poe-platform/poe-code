# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-04T07:19:12.443Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 24
- **Geometric Mean p50**: 2.211 ms
- **Total Suite Duration**: 581.827 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.08 | 4.86 | 3.70 | 2.77 | 4.88 | 270.2 | 10456 |
| pipelines | pipeline-6-stage-stream | 1.65 | 1.69 | 1.62 | 1.48 | 1.70 | 617.5 | 3076 |
| search | search-rg-find-monorepo | 9.37 | 10.05 | 9.33 | 8.50 | 10.17 | 107.1 | 16110 |
| text-processing | text-awk-sed-log-analytics | 0.48 | 0.53 | 0.49 | 0.48 | 0.54 | 2032.2 | 556 |
| structured-data | structured-jq-yq-pipeline | 0.64 | 0.65 | 0.64 | 0.60 | 0.65 | 1574.3 | 1157 |
| database | sqlite3-join-aggregation | 0.29 | 0.31 | 0.29 | 0.28 | 0.32 | 3402.6 | 689 |
| archives | archive-tar-gzip-sha256-roundtrip | 5.04 | 6.02 | 5.33 | 4.86 | 6.10 | 187.4 | 7301 |
| compression | compression-zstd-xz-stream | 10.24 | 14.78 | 11.22 | 9.54 | 15.83 | 89.1 | 27093 |
| vfs | vfs-tree-clone-chmod-stat | 7.03 | 7.48 | 6.87 | 5.97 | 7.53 | 145.7 | 9931 |
| math-utils | math-awk-bc-numfmt-reduction | 0.77 | 0.89 | 0.80 | 0.73 | 0.91 | 1251.0 | 855 |
| chaos | chaos-adversarial-find-xargs0 | 2.79 | 2.82 | 2.75 | 2.67 | 2.83 | 363.2 | 5423 |
| lifecycle | shell-cold-start-and-exec | 0.28 | 0.32 | 0.29 | 0.28 | 0.32 | 3399.0 | 634 |
| diff-patch | diff-patch-diff3-merge | 2.58 | 3.54 | 2.79 | 2.42 | 3.77 | 358.4 | 4352 |
| csv-analytics | csvkit-xan-data-science | 3.24 | 3.80 | 3.27 | 2.86 | 3.93 | 305.7 | 7200 |
| web-scraping | htmlq-xmllint-web-scraping | 0.96 | 1.01 | 0.96 | 0.92 | 1.02 | 1039.1 | 1218 |
| session-state | session-state-json-roundtrip | 1.03 | 1.06 | 1.03 | 0.98 | 1.06 | 975.1 | 1047 |
| document-media | document-mermaid-svg-pipeline | 1.04 | 2.43 | 1.40 | 1.03 | 2.76 | 716.2 | 3587 |
| agent-workflow | agent-refactor-release-pipeline | 17.14 | 17.75 | 16.95 | 15.50 | 17.85 | 59.0 | 24721 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.11 | 2.13 | 2.09 | 2.02 | 2.13 | 479.0 | 3018 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.67 | 1.87 | 1.72 | 1.65 | 1.91 | 580.6 | 2089 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 33.93 | 39.39 | 35.48 | 31.82 | 39.49 | 28.2 | 73987 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 1.97 | 2.06 | 1.97 | 1.89 | 2.08 | 507.1 | 6957 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.63 | 3.75 | 3.64 | 3.57 | 3.78 | 274.6 | 5263 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 1.56 | 2.30 | 1.73 | 1.45 | 2.46 | 579.2 | 5379 |
