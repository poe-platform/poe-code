# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-06T04:14:31.681Z`
- **Git Commit**: `ff78f654ea`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 6.717 ms
- **Total Suite Duration**: 2193.691 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.70 | 4.54 | 3.95 | 3.46 | 4.56 | 252.9 | 9961 |
| pipelines | pipeline-6-stage-stream | 4.87 | 5.39 | 4.85 | 4.22 | 5.49 | 206.2 | 15883 |
| search | search-rg-find-monorepo | 26.45 | 26.92 | 26.26 | 25.36 | 27.01 | 38.1 | 36032 |
| text-processing | text-awk-sed-log-analytics | 1.09 | 1.48 | 1.18 | 1.03 | 1.55 | 845.9 | 2270 |
| structured-data | structured-jq-yq-pipeline | 2.24 | 2.33 | 2.24 | 2.10 | 2.34 | 445.7 | 2593 |
| database | sqlite3-join-aggregation | 0.79 | 1.74 | 1.00 | 0.69 | 1.98 | 999.3 | 1785 |
| archives | archive-tar-gzip-sha256-roundtrip | 30.70 | 31.55 | 30.78 | 29.59 | 31.59 | 32.5 | 41160 |
| compression | compression-zstd-xz-stream | 13.18 | 24.74 | 16.32 | 11.56 | 26.62 | 61.3 | 33968 |
| vfs | vfs-tree-clone-chmod-stat | 50.49 | 54.05 | 51.79 | 50.05 | 54.07 | 19.3 | 61786 |
| math-utils | math-awk-bc-numfmt-reduction | 0.84 | 1.46 | 1.01 | 0.83 | 1.60 | 993.2 | 2230 |
| chaos | chaos-adversarial-find-xargs0 | 8.73 | 8.94 | 8.49 | 7.78 | 8.97 | 117.8 | 11356 |
| lifecycle | shell-cold-start-and-exec | 0.94 | 1.01 | 0.95 | 0.91 | 1.02 | 1046.9 | 1504 |
| diff-patch | diff-patch-diff3-merge | 21.65 | 21.78 | 21.49 | 20.70 | 21.81 | 46.5 | 28076 |
| csv-analytics | csvkit-xan-data-science | 4.01 | 4.71 | 4.21 | 3.73 | 4.73 | 237.7 | 7843 |
| web-scraping | htmlq-xmllint-web-scraping | 6.04 | 6.85 | 6.03 | 5.17 | 7.02 | 165.9 | 13356 |
| session-state | session-state-json-roundtrip | 1.09 | 1.68 | 1.25 | 1.03 | 1.78 | 797.4 | 1417 |
| document-media | document-mermaid-svg-pipeline | 4.00 | 5.22 | 4.42 | 3.94 | 5.30 | 226.2 | 5310 |
| agent-workflow | agent-refactor-release-pipeline | 116.93 | 120.61 | 117.82 | 116.21 | 121.30 | 8.5 | 132430 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 8.24 | 8.75 | 8.07 | 7.36 | 8.86 | 123.9 | 9062 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 13.26 | 13.74 | 13.25 | 12.79 | 13.81 | 75.5 | 14151 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 74.59 | 74.88 | 74.56 | 74.24 | 74.90 | 13.4 | 77513 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 5.86 | 6.97 | 6.19 | 5.76 | 7.11 | 161.6 | 15823 |
| document-media | media-office-ffmpeg-soffice-pipeline | 8.94 | 9.18 | 8.49 | 7.60 | 9.22 | 117.8 | 18674 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.15 | 6.57 | 5.99 | 5.38 | 6.61 | 167.0 | 6668 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 15.92 | 16.19 | 15.89 | 15.54 | 16.25 | 62.9 | 20762 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.23 | 2.48 | 2.26 | 1.97 | 2.49 | 443.3 | 6220 |
