# Benchmark Run: Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath) (`rust-wasm-warm-memory-fastpath`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-06T08:03:18.982Z`
- **Git Commit**: `eefb24200b`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.19 ms
- **Total Suite Duration**: 50.942 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.72 | 0.75 | 0.72 | 0.71 | 0.76 | 1379.9 | 1908 |
| pipelines | pipeline-6-stage-stream | 2.82 | 3.44 | 3.00 | 2.68 | 3.46 | 332.8 | 14370 |
| search | search-rg-find-monorepo | 0.95 | 0.99 | 0.92 | 0.84 | 0.99 | 1082.7 | 3321 |
| text-processing | text-awk-sed-log-analytics | 0.40 | 0.42 | 0.40 | 0.40 | 0.42 | 2474.3 | 970 |
| structured-data | structured-jq-yq-pipeline | 0.15 | 0.17 | 0.15 | 0.14 | 0.17 | 6595.2 | 324 |
| database | sqlite3-join-aggregation | 0.03 | 0.03 | 0.03 | 0.02 | 0.03 | 40241.4 | 76 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.34 | 0.36 | 0.35 | 0.34 | 0.36 | 2890.3 | 1114 |
| compression | compression-zstd-xz-stream | 0.09 | 0.10 | 0.09 | 0.09 | 0.10 | 10826.4 | 93 |
| vfs | vfs-tree-clone-chmod-stat | 0.29 | 0.30 | 0.29 | 0.28 | 0.30 | 3460.6 | 759 |
| math-utils | math-awk-bc-numfmt-reduction | 0.86 | 0.90 | 0.86 | 0.83 | 0.90 | 1163.6 | 2733 |
| chaos | chaos-adversarial-find-xargs0 | 0.12 | 0.13 | 0.12 | 0.11 | 0.13 | 8279.3 | 384 |
| lifecycle | shell-cold-start-and-exec | 0.07 | 0.07 | 0.07 | 0.06 | 0.07 | 14796.6 | 189 |
| diff-patch | diff-patch-diff3-merge | 0.14 | 0.14 | 0.14 | 0.13 | 0.14 | 7316.6 | 408 |
| csv-analytics | csvkit-xan-data-science | 0.10 | 0.10 | 0.10 | 0.09 | 0.10 | 10394.1 | 273 |
| web-scraping | htmlq-xmllint-web-scraping | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 20380.4 | 161 |
| session-state | session-state-json-roundtrip | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 10136.8 | 846 |
| document-media | document-mermaid-svg-pipeline | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 | 22896.5 | 161 |
| agent-workflow | agent-refactor-release-pipeline | 1.37 | 1.44 | 1.37 | 1.31 | 1.45 | 732.2 | 7306 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.12 | 0.12 | 0.12 | 0.12 | 0.12 | 8408.1 | 636 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.10 | 0.10 | 0.10 | 0.10 | 0.11 | 9882.2 | 101 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.45 | 0.46 | 0.44 | 0.42 | 0.46 | 2269.8 | 4384 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.08 | 0.08 | 0.08 | 0.08 | 0.08 | 12566.8 | 166 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.14 | 0.15 | 0.14 | 0.14 | 0.15 | 7023.7 | 334 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.17 | 0.18 | 0.17 | 0.16 | 0.18 | 5837.7 | 718 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.16 | 0.16 | 0.16 | 0.15 | 0.16 | 6382.6 | 1546 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.17 | 0.21 | 0.18 | 0.17 | 0.22 | 5602.0 | 1537 |
