# Benchmark Run: TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) (`ts-baseline-strict-budgets-mount-dev`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-04T03:30:55.570Z`
- **Git Commit**: `a37b2c1c86`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 12
- **Geometric Mean p50**: 2.137 ms
- **Total Suite Duration**: 271.64 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.49 | 7.88 | 5.18 | 3.45 | 7.97 | 193.2 | 10211 |
| pipelines | pipeline-6-stage-stream | 1.67 | 2.71 | 1.91 | 1.47 | 2.94 | 524.2 | 5087 |
| search | search-rg-find-monorepo | 13.12 | 13.95 | 12.55 | 10.19 | 14.13 | 79.7 | 18991 |
| text-processing | text-awk-sed-log-analytics | 0.66 | 1.77 | 0.93 | 0.57 | 2.03 | 1075.2 | 1478 |
| structured-data | structured-jq-yq-pipeline | 0.69 | 0.72 | 0.70 | 0.69 | 0.73 | 1426.9 | 773 |
| database | sqlite3-join-aggregation | 0.38 | 0.40 | 0.39 | 0.38 | 0.40 | 2589.9 | 449 |
| archives | archive-tar-gzip-sha256-roundtrip | 6.70 | 6.91 | 6.29 | 5.29 | 6.92 | 158.9 | 9398 |
| compression | compression-zstd-xz-stream | 11.30 | 15.32 | 12.14 | 10.07 | 16.16 | 82.4 | 27850 |
| vfs | vfs-tree-clone-chmod-stat | 8.97 | 12.22 | 9.56 | 7.70 | 12.87 | 104.6 | 15221 |
| math-utils | math-awk-bc-numfmt-reduction | 0.92 | 1.72 | 1.10 | 0.86 | 1.91 | 907.3 | 2294 |
| chaos | chaos-adversarial-find-xargs0 | 3.28 | 3.53 | 3.25 | 2.89 | 3.56 | 307.9 | 4901 |
| lifecycle | shell-cold-start-and-exec | 0.33 | 0.37 | 0.33 | 0.30 | 0.37 | 3015.7 | 476 |
