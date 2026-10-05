# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-04T07:53:44.372Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 5.18 ms
- **Total Suite Duration**: 2280.288 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.73 | 7.74 | 4.88 | 3.08 | 8.26 | 205.0 | 11272 |
| pipelines | pipeline-6-stage-stream | 1.77 | 2.14 | 1.83 | 1.51 | 2.19 | 545.9 | 6026 |
| search | search-rg-find-monorepo | 42.95 | 46.36 | 43.56 | 41.21 | 46.82 | 23.0 | 56989 |
| text-processing | text-awk-sed-log-analytics | 0.86 | 2.83 | 1.37 | 0.75 | 3.22 | 729.5 | 2500 |
| structured-data | structured-jq-yq-pipeline | 0.93 | 1.39 | 1.05 | 0.90 | 1.48 | 953.2 | 1509 |
| database | sqlite3-join-aggregation | 0.39 | 1.79 | 0.73 | 0.36 | 2.14 | 1365.8 | 1461 |
| archives | archive-tar-gzip-sha256-roundtrip | 23.36 | 24.53 | 23.18 | 21.61 | 24.65 | 43.1 | 27647 |
| compression | compression-zstd-xz-stream | 15.50 | 20.89 | 16.34 | 12.98 | 21.83 | 61.2 | 34145 |
| vfs | vfs-tree-clone-chmod-stat | 56.72 | 60.13 | 57.80 | 56.33 | 60.40 | 17.3 | 64582 |
| math-utils | math-awk-bc-numfmt-reduction | 1.52 | 2.40 | 1.66 | 0.92 | 2.47 | 602.6 | 3275 |
| chaos | chaos-adversarial-find-xargs0 | 7.66 | 7.88 | 7.17 | 6.13 | 7.92 | 139.4 | 9569 |
| lifecycle | shell-cold-start-and-exec | 1.01 | 1.56 | 1.19 | 0.90 | 1.57 | 838.2 | 1655 |
| diff-patch | diff-patch-diff3-merge | 12.98 | 13.78 | 12.82 | 11.89 | 13.89 | 78.0 | 16209 |
| csv-analytics | csvkit-xan-data-science | 3.70 | 4.16 | 3.75 | 3.37 | 4.26 | 266.6 | 8148 |
| web-scraping | htmlq-xmllint-web-scraping | 1.60 | 1.75 | 1.64 | 1.56 | 1.78 | 610.7 | 1833 |
| session-state | session-state-json-roundtrip | 1.06 | 2.54 | 1.45 | 1.02 | 2.86 | 691.6 | 1842 |
| document-media | document-mermaid-svg-pipeline | 2.37 | 4.12 | 2.90 | 2.08 | 4.26 | 344.9 | 4312 |
| agent-workflow | agent-refactor-release-pipeline | 121.28 | 127.74 | 121.97 | 118.28 | 129.31 | 8.2 | 138637 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 4.14 | 5.66 | 4.54 | 4.11 | 5.98 | 220.3 | 4880 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 6.60 | 7.62 | 6.50 | 5.31 | 7.64 | 153.8 | 7717 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 104.12 | 131.65 | 110.81 | 103.12 | 138.27 | 9.0 | 216432 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 3.70 | 5.26 | 3.42 | 1.87 | 5.55 | 292.5 | 9775 |
| document-media | media-office-ffmpeg-soffice-pipeline | 7.59 | 8.92 | 7.54 | 5.87 | 9.24 | 132.7 | 13304 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 2.23 | 5.32 | 3.03 | 2.00 | 5.92 | 329.8 | 8575 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 11.40 | 13.51 | 11.39 | 9.60 | 14.04 | 87.8 | 19298 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 3.66 | 3.89 | 3.54 | 3.00 | 3.95 | 282.4 | 6896 |
