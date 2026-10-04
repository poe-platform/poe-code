# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-04T05:44:02.481Z`
- **Git Commit**: `81dc544aad`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 18
- **Geometric Mean p50**: 2.35 ms
- **Total Suite Duration**: 518.389 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.31 | 6.55 | 4.30 | 3.03 | 6.95 | 232.4 | 12544 |
| pipelines | pipeline-6-stage-stream | 1.62 | 2.39 | 1.89 | 1.55 | 2.42 | 528.5 | 5288 |
| search | search-rg-find-monorepo | 10.75 | 12.77 | 11.05 | 9.69 | 13.02 | 90.5 | 19504 |
| text-processing | text-awk-sed-log-analytics | 0.52 | 0.58 | 0.53 | 0.49 | 0.59 | 1894.9 | 794 |
| structured-data | structured-jq-yq-pipeline | 0.65 | 0.70 | 0.66 | 0.64 | 0.71 | 1513.1 | 1079 |
| database | sqlite3-join-aggregation | 0.35 | 0.36 | 0.34 | 0.33 | 0.37 | 2896.2 | 342 |
| archives | archive-tar-gzip-sha256-roundtrip | 8.83 | 10.30 | 8.26 | 5.22 | 10.51 | 121.0 | 11364 |
| compression | compression-zstd-xz-stream | 21.84 | 35.38 | 23.28 | 11.36 | 35.65 | 43.0 | 29388 |
| vfs | vfs-tree-clone-chmod-stat | 12.96 | 19.11 | 13.09 | 7.18 | 20.50 | 76.4 | 24818 |
| math-utils | math-awk-bc-numfmt-reduction | 0.98 | 2.45 | 1.34 | 0.81 | 2.75 | 747.0 | 3539 |
| chaos | chaos-adversarial-find-xargs0 | 3.65 | 6.56 | 4.47 | 3.28 | 6.92 | 223.6 | 8607 |
| lifecycle | shell-cold-start-and-exec | 0.29 | 0.32 | 0.29 | 0.27 | 0.32 | 3414.8 | 290 |
| diff-patch | diff-patch-diff3-merge | 2.61 | 4.59 | 3.09 | 2.56 | 5.08 | 323.3 | 4021 |
| csv-analytics | csvkit-xan-data-science | 3.53 | 5.82 | 4.30 | 3.15 | 5.91 | 232.6 | 7769 |
| web-scraping | htmlq-xmllint-web-scraping | 0.97 | 1.01 | 0.97 | 0.93 | 1.01 | 1026.7 | 1269 |
| session-state | session-state-json-roundtrip | 1.13 | 3.77 | 1.77 | 1.05 | 4.41 | 564.0 | 2350 |
| document-media | document-mermaid-svg-pipeline | 1.24 | 2.68 | 1.59 | 1.10 | 2.96 | 629.1 | 3497 |
| agent-workflow | agent-refactor-release-pipeline | 21.77 | 26.27 | 22.44 | 18.67 | 26.32 | 44.6 | 32669 |
