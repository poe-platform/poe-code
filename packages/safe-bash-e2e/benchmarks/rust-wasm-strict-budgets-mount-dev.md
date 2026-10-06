# Benchmark Run: Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev) (`rust-wasm-strict-budgets-mount-dev`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-06T08:03:19.120Z`
- **Git Commit**: `eefb24200b`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.169 ms
- **Total Suite Duration**: 43.709 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.54 | 0.58 | 0.55 | 0.53 | 0.58 | 1827.2 | 1465 |
| pipelines | pipeline-6-stage-stream | 2.24 | 2.40 | 2.26 | 2.18 | 2.44 | 441.9 | 2381 |
| search | search-rg-find-monorepo | 0.78 | 0.79 | 0.78 | 0.76 | 0.79 | 1287.7 | 776 |
| text-processing | text-awk-sed-log-analytics | 0.36 | 0.37 | 0.36 | 0.35 | 0.38 | 2757.3 | 471 |
| structured-data | structured-jq-yq-pipeline | 0.12 | 0.13 | 0.12 | 0.12 | 0.13 | 8266.2 | 120 |
| database | sqlite3-join-aggregation | 0.02 | 0.03 | 0.02 | 0.02 | 0.03 | 41695.9 | 24 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.19 | 0.19 | 0.19 | 0.19 | 0.19 | 5256.9 | 424 |
| compression | compression-zstd-xz-stream | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 14184.4 | 71 |
| vfs | vfs-tree-clone-chmod-stat | 0.32 | 0.32 | 0.32 | 0.31 | 0.32 | 3179.0 | 475 |
| math-utils | math-awk-bc-numfmt-reduction | 0.80 | 0.83 | 0.80 | 0.78 | 0.83 | 1246.1 | 803 |
| chaos | chaos-adversarial-find-xargs0 | 0.11 | 0.12 | 0.12 | 0.11 | 0.12 | 8643.7 | 193 |
| lifecycle | shell-cold-start-and-exec | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 14378.1 | 43 |
| diff-patch | diff-patch-diff3-merge | 0.13 | 0.14 | 0.13 | 0.13 | 0.14 | 7586.8 | 132 |
| csv-analytics | csvkit-xan-data-science | 0.09 | 0.09 | 0.09 | 0.08 | 0.09 | 11648.3 | 86 |
| web-scraping | htmlq-xmllint-web-scraping | 0.05 | 0.05 | 0.05 | 0.04 | 0.05 | 21743.1 | 46 |
| session-state | session-state-json-roundtrip | 0.09 | 0.09 | 0.09 | 0.08 | 0.09 | 11547.3 | 86 |
| document-media | document-mermaid-svg-pipeline | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 | 24174.2 | 42 |
| agent-workflow | agent-refactor-release-pipeline | 1.45 | 1.52 | 1.42 | 1.31 | 1.54 | 703.3 | 1417 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.11 | 0.12 | 0.11 | 0.10 | 0.12 | 9119.9 | 110 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.10 | 0.10 | 0.10 | 0.09 | 0.11 | 10364.5 | 96 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.40 | 0.40 | 0.39 | 0.39 | 0.40 | 2534.9 | 395 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.07 | 0.08 | 0.07 | 0.07 | 0.08 | 13834.4 | 73 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.15 | 0.23 | 0.17 | 0.13 | 0.24 | 5813.9 | 162 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 | 6641.9 | 151 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.14 | 0.15 | 0.14 | 0.14 | 0.15 | 6880.3 | 145 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.13 | 0.14 | 0.13 | 0.12 | 0.14 | 7688.9 | 433 |
