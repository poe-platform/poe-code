# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-04T06:38:00.012Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 20
- **Geometric Mean p50**: 2.098 ms
- **Total Suite Duration**: 503.823 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.24 | 5.25 | 3.62 | 2.80 | 5.72 | 276.4 | 8166 |
| pipelines | pipeline-6-stage-stream | 1.67 | 3.29 | 2.03 | 1.41 | 3.59 | 492.9 | 5098 |
| search | search-rg-find-monorepo | 10.49 | 12.89 | 10.61 | 8.41 | 13.19 | 94.3 | 18112 |
| text-processing | text-awk-sed-log-analytics | 0.49 | 0.55 | 0.50 | 0.45 | 0.56 | 2003.2 | 1105 |
| structured-data | structured-jq-yq-pipeline | 0.70 | 0.94 | 0.74 | 0.61 | 0.95 | 1343.6 | 767 |
| database | sqlite3-join-aggregation | 0.35 | 0.36 | 0.35 | 0.33 | 0.36 | 2868.2 | 837 |
| archives | archive-tar-gzip-sha256-roundtrip | 5.19 | 6.59 | 5.57 | 4.86 | 6.62 | 179.4 | 10570 |
| compression | compression-zstd-xz-stream | 12.09 | 15.40 | 12.96 | 11.43 | 15.52 | 77.2 | 29042 |
| vfs | vfs-tree-clone-chmod-stat | 7.88 | 8.74 | 7.94 | 7.21 | 8.87 | 125.9 | 13309 |
| math-utils | math-awk-bc-numfmt-reduction | 0.85 | 1.54 | 0.98 | 0.72 | 1.72 | 1016.2 | 2042 |
| chaos | chaos-adversarial-find-xargs0 | 4.65 | 6.80 | 4.84 | 3.15 | 7.08 | 206.4 | 9291 |
| lifecycle | shell-cold-start-and-exec | 0.31 | 0.39 | 0.32 | 0.28 | 0.41 | 3099.1 | 365 |
| diff-patch | diff-patch-diff3-merge | 2.62 | 4.10 | 2.92 | 2.49 | 4.58 | 342.2 | 6149 |
| csv-analytics | csvkit-xan-data-science | 3.27 | 4.26 | 3.46 | 3.05 | 4.47 | 289.3 | 6656 |
| web-scraping | htmlq-xmllint-web-scraping | 0.98 | 1.03 | 0.98 | 0.94 | 1.03 | 1015.2 | 1173 |
| session-state | session-state-json-roundtrip | 1.01 | 1.19 | 1.05 | 0.98 | 1.21 | 948.0 | 1442 |
| document-media | document-mermaid-svg-pipeline | 1.00 | 1.07 | 1.01 | 0.97 | 1.08 | 988.2 | 1008 |
| agent-workflow | agent-refactor-release-pipeline | 18.16 | 21.82 | 19.07 | 16.96 | 21.89 | 52.4 | 29221 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.33 | 3.71 | 2.72 | 2.20 | 3.79 | 367.9 | 3188 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.83 | 3.63 | 2.27 | 1.77 | 4.04 | 439.6 | 3009 |
