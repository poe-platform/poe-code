# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-04T06:37:59.322Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 20
- **Geometric Mean p50**: 4.194 ms
- **Total Suite Duration**: 1819.224 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.28 | 4.64 | 3.62 | 3.14 | 4.89 | 276.5 | 8624 |
| pipelines | pipeline-6-stage-stream | 2.04 | 2.18 | 2.00 | 1.78 | 2.20 | 499.3 | 5590 |
| search | search-rg-find-monorepo | 40.96 | 42.55 | 41.29 | 40.39 | 42.75 | 24.2 | 50207 |
| text-processing | text-awk-sed-log-analytics | 0.69 | 0.80 | 0.71 | 0.67 | 0.83 | 1414.0 | 701 |
| structured-data | structured-jq-yq-pipeline | 0.90 | 2.07 | 1.16 | 0.86 | 2.42 | 860.0 | 1447 |
| database | sqlite3-join-aggregation | 0.36 | 0.53 | 0.40 | 0.35 | 0.57 | 2517.5 | 388 |
| archives | archive-tar-gzip-sha256-roundtrip | 23.36 | 25.46 | 23.81 | 22.78 | 25.70 | 42.0 | 29515 |
| compression | compression-zstd-xz-stream | 12.72 | 17.20 | 13.14 | 9.95 | 18.23 | 76.1 | 33388 |
| vfs | vfs-tree-clone-chmod-stat | 56.01 | 56.46 | 56.00 | 55.46 | 56.56 | 17.9 | 63252 |
| math-utils | math-awk-bc-numfmt-reduction | 0.87 | 0.99 | 0.90 | 0.84 | 1.01 | 1113.8 | 1352 |
| chaos | chaos-adversarial-find-xargs0 | 6.99 | 7.83 | 7.14 | 6.62 | 7.86 | 140.0 | 9115 |
| lifecycle | shell-cold-start-and-exec | 0.69 | 0.72 | 0.69 | 0.66 | 0.73 | 1448.3 | 762 |
| diff-patch | diff-patch-diff3-merge | 13.08 | 13.33 | 12.94 | 12.20 | 13.34 | 77.3 | 16260 |
| csv-analytics | csvkit-xan-data-science | 3.71 | 4.71 | 3.88 | 3.36 | 4.95 | 257.5 | 6791 |
| web-scraping | htmlq-xmllint-web-scraping | 1.67 | 2.51 | 1.86 | 1.59 | 2.73 | 538.3 | 3297 |
| session-state | session-state-json-roundtrip | 1.00 | 1.11 | 1.02 | 0.96 | 1.13 | 984.7 | 1076 |
| document-media | document-mermaid-svg-pipeline | 2.30 | 3.08 | 2.43 | 2.10 | 3.30 | 410.8 | 3464 |
| agent-workflow | agent-refactor-release-pipeline | 118.94 | 120.65 | 118.93 | 117.39 | 120.97 | 8.4 | 135701 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 4.99 | 6.47 | 5.09 | 4.05 | 6.80 | 196.3 | 7684 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 5.99 | 7.23 | 6.19 | 5.16 | 7.29 | 161.6 | 8794 |
