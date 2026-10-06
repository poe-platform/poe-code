# Benchmark Run: Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev) (`rust-wasm-strict-budgets-mount-dev`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-06T04:14:33.284Z`
- **Git Commit**: `ff78f654ea`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.108 ms
- **Total Suite Duration**: 32.329 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 | 6612.7 | 1518 |
| pipelines | pipeline-6-stage-stream | 2.14 | 2.18 | 2.12 | 2.03 | 2.19 | 472.6 | 2320 |
| search | search-rg-find-monorepo | 0.47 | 0.48 | 0.47 | 0.45 | 0.48 | 2129.9 | 470 |
| text-processing | text-awk-sed-log-analytics | 0.24 | 0.24 | 0.23 | 0.23 | 0.24 | 4256.8 | 448 |
| structured-data | structured-jq-yq-pipeline | 0.10 | 0.10 | 0.10 | 0.10 | 0.11 | 9924.7 | 100 |
| database | sqlite3-join-aggregation | 0.01 | 0.02 | 0.01 | 0.01 | 0.02 | 65501.6 | 16 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.17 | 0.17 | 0.16 | 0.16 | 0.17 | 6127.5 | 163 |
| compression | compression-zstd-xz-stream | 0.05 | 0.05 | 0.05 | 0.05 | 0.06 | 19379.9 | 52 |
| vfs | vfs-tree-clone-chmod-stat | 0.25 | 0.26 | 0.25 | 0.25 | 0.26 | 3940.6 | 1195 |
| math-utils | math-awk-bc-numfmt-reduction | 0.73 | 0.80 | 0.74 | 0.71 | 0.81 | 1344.0 | 740 |
| chaos | chaos-adversarial-find-xargs0 | 0.07 | 0.07 | 0.06 | 0.06 | 0.07 | 15505.8 | 65 |
| lifecycle | shell-cold-start-and-exec | 0.01 | 0.02 | 0.01 | 0.01 | 0.02 | 64691.4 | 16 |
| diff-patch | diff-patch-diff3-merge | 0.08 | 0.09 | 0.08 | 0.08 | 0.09 | 11867.1 | 85 |
| csv-analytics | csvkit-xan-data-science | 0.07 | 0.07 | 0.07 | 0.06 | 0.07 | 14648.4 | 68 |
| web-scraping | htmlq-xmllint-web-scraping | 0.04 | 0.04 | 0.04 | 0.03 | 0.04 | 27822.9 | 35 |
| session-state | session-state-json-roundtrip | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 19630.2 | 48 |
| document-media | document-mermaid-svg-pipeline | 0.03 | 0.04 | 0.03 | 0.03 | 0.04 | 30904.3 | 30 |
| agent-workflow | agent-refactor-release-pipeline | 0.96 | 1.00 | 0.97 | 0.94 | 1.01 | 1031.2 | 1169 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 14871.8 | 68 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.06 | 0.06 | 0.05 | 0.05 | 0.06 | 18515.6 | 54 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.33 | 0.34 | 0.34 | 0.33 | 0.34 | 2983.3 | 335 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 | 17150.2 | 58 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.08 | 0.09 | 0.08 | 0.08 | 0.09 | 12326.7 | 82 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.10 | 0.11 | 0.11 | 0.10 | 0.11 | 9462.9 | 106 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.09 | 0.09 | 0.09 | 0.08 | 0.09 | 11709.7 | 86 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 | 17561.9 | 58 |
