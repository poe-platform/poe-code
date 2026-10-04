# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-04T05:44:01.723Z`
- **Git Commit**: `81dc544aad`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 18
- **Geometric Mean p50**: 4.519 ms
- **Total Suite Duration**: 5017.041 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.44 | 4.18 | 3.51 | 3.03 | 4.35 | 285.2 | 9830 |
| pipelines | pipeline-6-stage-stream | 2.14 | 3.14 | 2.17 | 1.58 | 3.38 | 460.4 | 7123 |
| search | search-rg-find-monorepo | 39.64 | 40.88 | 39.79 | 38.62 | 41.10 | 25.1 | 55694 |
| text-processing | text-awk-sed-log-analytics | 0.72 | 0.83 | 0.76 | 0.69 | 0.83 | 1324.9 | 810 |
| structured-data | structured-jq-yq-pipeline | 0.87 | 0.96 | 0.89 | 0.86 | 0.99 | 1125.9 | 934 |
| database | sqlite3-join-aggregation | 0.36 | 1.11 | 0.55 | 0.34 | 1.29 | 1832.7 | 836 |
| archives | archive-tar-gzip-sha256-roundtrip | 23.58 | 24.62 | 23.91 | 23.47 | 24.71 | 41.8 | 30781 |
| compression | compression-zstd-xz-stream | 15.25 | 20.45 | 16.01 | 12.60 | 21.46 | 62.5 | 34069 |
| vfs | vfs-tree-clone-chmod-stat | 59.89 | 2755.22 | 733.77 | 59.12 | 3428.59 | 1.4 | 72034 |
| math-utils | math-awk-bc-numfmt-reduction | 1.36 | 3.31 | 1.79 | 1.13 | 3.80 | 558.1 | 3487 |
| chaos | chaos-adversarial-find-xargs0 | 12.43 | 15.36 | 11.56 | 7.92 | 16.07 | 86.5 | 14482 |
| lifecycle | shell-cold-start-and-exec | 0.66 | 0.84 | 0.70 | 0.64 | 0.88 | 1419.5 | 824 |
| diff-patch | diff-patch-diff3-merge | 13.98 | 14.89 | 13.71 | 11.81 | 14.90 | 72.9 | 18177 |
| csv-analytics | csvkit-xan-data-science | 3.88 | 4.08 | 3.86 | 3.62 | 4.11 | 258.9 | 8516 |
| web-scraping | htmlq-xmllint-web-scraping | 1.79 | 1.92 | 1.79 | 1.62 | 1.92 | 558.9 | 2032 |
| session-state | session-state-json-roundtrip | 1.18 | 2.63 | 1.54 | 1.06 | 2.92 | 649.5 | 2541 |
| document-media | document-mermaid-svg-pipeline | 2.30 | 3.28 | 2.49 | 2.07 | 3.52 | 401.9 | 3980 |
| agent-workflow | agent-refactor-release-pipeline | 150.37 | 160.93 | 144.60 | 125.60 | 161.16 | 6.9 | 151959 |
