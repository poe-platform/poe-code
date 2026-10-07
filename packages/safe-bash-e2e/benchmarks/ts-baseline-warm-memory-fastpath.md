# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-06T16:42:40.030Z`
- **Git Commit**: `ec7d1ab7e5`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 4.53 ms
- **Total Suite Duration**: 1144.718 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 6.50 | 6.93 | 6.18 | 5.21 | 6.93 | 161.9 | 10563 |
| pipelines | pipeline-6-stage-stream | 7.39 | 8.34 | 7.37 | 6.42 | 8.43 | 135.8 | 17035 |
| search | search-rg-find-monorepo | 4.41 | 5.19 | 4.38 | 3.77 | 5.33 | 228.1 | 6613 |
| text-processing | text-awk-sed-log-analytics | 1.19 | 1.25 | 1.10 | 0.89 | 1.26 | 905.8 | 1649 |
| structured-data | structured-jq-yq-pipeline | 4.05 | 7.80 | 4.72 | 2.78 | 8.56 | 212.0 | 13794 |
| database | sqlite3-join-aggregation | 1.40 | 1.74 | 1.35 | 1.01 | 1.83 | 740.4 | 1326 |
| archives | archive-tar-gzip-sha256-roundtrip | 8.03 | 10.27 | 8.04 | 5.65 | 10.78 | 124.3 | 20186 |
| compression | compression-zstd-xz-stream | 15.32 | 20.46 | 16.24 | 12.09 | 21.05 | 61.6 | 35973 |
| vfs | vfs-tree-clone-chmod-stat | 4.18 | 4.35 | 4.06 | 3.69 | 4.39 | 246.5 | 7017 |
| math-utils | math-awk-bc-numfmt-reduction | 1.25 | 1.41 | 1.28 | 1.18 | 1.44 | 779.8 | 1553 |
| chaos | chaos-adversarial-find-xargs0 | 1.69 | 2.79 | 2.01 | 1.64 | 2.98 | 498.3 | 3020 |
| lifecycle | shell-cold-start-and-exec | 1.66 | 1.88 | 1.70 | 1.54 | 1.91 | 590.1 | 2100 |
| diff-patch | diff-patch-diff3-merge | 5.90 | 7.17 | 5.95 | 4.63 | 7.46 | 168.1 | 9492 |
| csv-analytics | csvkit-xan-data-science | 4.56 | 5.52 | 4.70 | 3.71 | 5.53 | 213.0 | 8516 |
| web-scraping | htmlq-xmllint-web-scraping | 5.45 | 7.50 | 5.86 | 4.50 | 7.78 | 170.6 | 11532 |
| session-state | session-state-json-roundtrip | 1.90 | 3.29 | 2.18 | 1.51 | 3.61 | 459.3 | 2197 |
| document-media | document-mermaid-svg-pipeline | 1.79 | 3.06 | 2.02 | 1.39 | 3.30 | 495.4 | 2647 |
| agent-workflow | agent-refactor-release-pipeline | 14.59 | 17.64 | 15.27 | 14.23 | 18.32 | 65.5 | 30296 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.54 | 2.57 | 2.50 | 2.39 | 2.58 | 399.5 | 3844 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.55 | 10.48 | 4.44 | 2.02 | 12.37 | 225.3 | 8554 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 37.14 | 43.53 | 38.51 | 36.37 | 45.08 | 26.0 | 70134 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 8.26 | 9.52 | 8.39 | 7.22 | 9.61 | 119.1 | 13066 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.87 | 5.47 | 4.30 | 3.70 | 5.74 | 232.8 | 4114 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 4.65 | 5.82 | 4.83 | 4.03 | 6.08 | 207.1 | 5823 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 65.90 | 78.90 | 68.37 | 62.85 | 81.90 | 14.6 | 138576 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.60 | 4.73 | 3.22 | 2.43 | 5.01 | 310.3 | 4277 |
