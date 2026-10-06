# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-06T08:03:14.228Z`
- **Git Commit**: `eefb24200b`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 4.534 ms
- **Total Suite Duration**: 1082.279 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 6.08 | 6.44 | 6.02 | 5.46 | 6.45 | 166.0 | 10205 |
| pipelines | pipeline-6-stage-stream | 7.46 | 8.18 | 7.53 | 6.83 | 8.26 | 132.9 | 16669 |
| search | search-rg-find-monorepo | 5.17 | 5.75 | 5.13 | 4.59 | 5.87 | 194.9 | 7421 |
| text-processing | text-awk-sed-log-analytics | 1.18 | 1.59 | 1.27 | 1.14 | 1.69 | 786.8 | 1876 |
| structured-data | structured-jq-yq-pipeline | 2.51 | 3.54 | 2.77 | 2.29 | 3.69 | 361.3 | 3134 |
| database | sqlite3-join-aggregation | 1.51 | 2.08 | 1.53 | 1.16 | 2.20 | 651.5 | 1493 |
| archives | archive-tar-gzip-sha256-roundtrip | 7.30 | 13.16 | 8.68 | 6.39 | 14.27 | 115.2 | 19548 |
| compression | compression-zstd-xz-stream | 16.55 | 22.36 | 17.73 | 14.12 | 23.32 | 56.4 | 38879 |
| vfs | vfs-tree-clone-chmod-stat | 4.65 | 5.01 | 4.77 | 4.55 | 5.02 | 209.8 | 7421 |
| math-utils | math-awk-bc-numfmt-reduction | 1.59 | 1.90 | 1.65 | 1.50 | 1.96 | 605.1 | 1927 |
| chaos | chaos-adversarial-find-xargs0 | 2.18 | 3.51 | 2.49 | 1.95 | 3.74 | 401.9 | 3433 |
| lifecycle | shell-cold-start-and-exec | 1.93 | 2.15 | 1.93 | 1.69 | 2.18 | 517.1 | 2329 |
| diff-patch | diff-patch-diff3-merge | 6.38 | 8.43 | 6.72 | 5.51 | 8.84 | 148.9 | 9872 |
| csv-analytics | csvkit-xan-data-science | 5.26 | 6.22 | 5.37 | 4.45 | 6.34 | 186.1 | 9061 |
| web-scraping | htmlq-xmllint-web-scraping | 5.19 | 6.60 | 5.65 | 4.95 | 6.62 | 176.9 | 11323 |
| session-state | session-state-json-roundtrip | 2.32 | 3.63 | 2.46 | 1.57 | 3.93 | 406.6 | 2428 |
| document-media | document-mermaid-svg-pipeline | 2.00 | 3.33 | 2.18 | 1.44 | 3.60 | 458.0 | 2788 |
| agent-workflow | agent-refactor-release-pipeline | 15.04 | 16.73 | 15.49 | 14.68 | 16.95 | 64.5 | 28328 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.69 | 2.81 | 2.70 | 2.60 | 2.83 | 370.9 | 4004 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.19 | 2.58 | 2.31 | 2.06 | 2.58 | 433.3 | 5619 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 34.24 | 45.97 | 36.98 | 33.13 | 48.81 | 27.0 | 68142 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.96 | 7.42 | 6.88 | 6.17 | 7.44 | 145.4 | 11838 |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.24 | 4.50 | 3.66 | 2.89 | 4.51 | 273.3 | 4182 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.56 | 4.61 | 3.73 | 3.18 | 4.83 | 268.0 | 5154 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 56.78 | 64.53 | 58.10 | 52.27 | 65.78 | 17.2 | 120347 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.65 | 3.03 | 2.72 | 2.40 | 3.06 | 367.8 | 4000 |
