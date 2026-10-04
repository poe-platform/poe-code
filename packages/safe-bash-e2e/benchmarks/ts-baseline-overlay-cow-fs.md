# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-04T07:19:11.559Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 24
- **Geometric Mean p50**: 4.367 ms
- **Total Suite Duration**: 1867.435 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.52 | 4.43 | 3.67 | 3.18 | 4.59 | 272.3 | 7753 |
| pipelines | pipeline-6-stage-stream | 1.74 | 1.92 | 1.75 | 1.46 | 1.93 | 572.6 | 5590 |
| search | search-rg-find-monorepo | 37.02 | 38.59 | 36.91 | 35.00 | 38.97 | 27.1 | 47123 |
| text-processing | text-awk-sed-log-analytics | 0.68 | 0.75 | 0.69 | 0.66 | 0.76 | 1442.3 | 848 |
| structured-data | structured-jq-yq-pipeline | 0.79 | 0.87 | 0.81 | 0.77 | 0.88 | 1236.0 | 924 |
| database | sqlite3-join-aggregation | 0.34 | 0.93 | 0.48 | 0.32 | 1.08 | 2065.3 | 834 |
| archives | archive-tar-gzip-sha256-roundtrip | 21.14 | 21.41 | 20.77 | 19.87 | 21.42 | 48.1 | 24879 |
| compression | compression-zstd-xz-stream | 12.33 | 13.79 | 12.04 | 9.46 | 13.93 | 83.0 | 28445 |
| vfs | vfs-tree-clone-chmod-stat | 51.21 | 53.56 | 51.70 | 50.77 | 54.10 | 19.3 | 59727 |
| math-utils | math-awk-bc-numfmt-reduction | 0.94 | 1.44 | 1.03 | 0.82 | 1.56 | 974.9 | 1598 |
| chaos | chaos-adversarial-find-xargs0 | 6.11 | 6.99 | 6.36 | 5.73 | 7.02 | 157.3 | 9239 |
| lifecycle | shell-cold-start-and-exec | 0.69 | 0.93 | 0.75 | 0.66 | 0.97 | 1337.9 | 782 |
| diff-patch | diff-patch-diff3-merge | 12.92 | 13.58 | 12.87 | 12.06 | 13.68 | 77.7 | 16003 |
| csv-analytics | csvkit-xan-data-science | 4.17 | 5.15 | 4.34 | 3.86 | 5.36 | 230.4 | 7072 |
| web-scraping | htmlq-xmllint-web-scraping | 1.67 | 1.89 | 1.72 | 1.61 | 1.93 | 582.8 | 1960 |
| session-state | session-state-json-roundtrip | 1.27 | 2.65 | 1.59 | 1.10 | 2.97 | 628.1 | 1970 |
| document-media | document-mermaid-svg-pipeline | 2.89 | 3.68 | 3.06 | 2.76 | 3.87 | 326.8 | 4437 |
| agent-workflow | agent-refactor-release-pipeline | 117.02 | 121.51 | 117.24 | 113.44 | 122.22 | 8.5 | 130402 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 4.00 | 5.20 | 4.31 | 3.89 | 5.43 | 232.2 | 5839 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 5.23 | 6.96 | 5.84 | 5.11 | 7.03 | 171.4 | 7013 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 75.69 | 78.08 | 75.72 | 72.23 | 78.20 | 13.2 | 117145 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 1.33 | 1.83 | 1.45 | 1.27 | 1.94 | 691.3 | 1606 |
| document-media | media-office-ffmpeg-soffice-pipeline | 6.20 | 7.28 | 6.10 | 4.96 | 7.54 | 164.0 | 11838 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 2.08 | 3.08 | 2.30 | 1.94 | 3.32 | 434.7 | 7046 |
