# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-04T03:30:55.161Z`
- **Git Commit**: `a37b2c1c86`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 12
- **Geometric Mean p50**: 4.227 ms
- **Total Suite Duration**: 841.084 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 4.35 | 8.44 | 5.36 | 4.09 | 9.34 | 186.6 | 14329 |
| pipelines | pipeline-6-stage-stream | 2.52 | 4.00 | 2.73 | 1.89 | 4.32 | 365.6 | 6567 |
| search | search-rg-find-monorepo | 45.11 | 46.18 | 44.56 | 42.90 | 46.40 | 22.4 | 65496 |
| text-processing | text-awk-sed-log-analytics | 0.78 | 0.92 | 0.82 | 0.76 | 0.93 | 1217.9 | 1750 |
| structured-data | structured-jq-yq-pipeline | 1.03 | 1.86 | 1.20 | 0.92 | 2.07 | 835.2 | 1469 |
| database | sqlite3-join-aggregation | 0.41 | 0.46 | 0.42 | 0.39 | 0.47 | 2387.0 | 417 |
| archives | archive-tar-gzip-sha256-roundtrip | 25.80 | 33.28 | 27.92 | 23.82 | 33.84 | 35.8 | 35466 |
| compression | compression-zstd-xz-stream | 14.57 | 16.55 | 14.13 | 10.93 | 17.03 | 70.8 | 31819 |
| vfs | vfs-tree-clone-chmod-stat | 60.54 | 65.01 | 60.58 | 55.44 | 65.47 | 16.5 | 67692 |
| math-utils | math-awk-bc-numfmt-reduction | 1.20 | 2.93 | 1.58 | 0.98 | 3.34 | 634.4 | 3556 |
| chaos | chaos-adversarial-find-xargs0 | 8.41 | 9.55 | 8.10 | 6.80 | 9.84 | 123.5 | 12805 |
| lifecycle | shell-cold-start-and-exec | 0.88 | 1.02 | 0.83 | 0.64 | 1.05 | 1210.0 | 818 |
