# Benchmark Run: Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath) (`rust-wasm-warm-memory-fastpath`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-06T04:14:33.183Z`
- **Git Commit**: `ff78f654ea`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.114 ms
- **Total Suite Duration**: 35.93 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.22 | 0.24 | 0.22 | 0.21 | 0.25 | 4496.7 | 473 |
| pipelines | pipeline-6-stage-stream | 2.39 | 2.71 | 2.46 | 2.26 | 2.76 | 406.3 | 7071 |
| search | search-rg-find-monorepo | 0.59 | 0.64 | 0.59 | 0.53 | 0.64 | 1690.2 | 2357 |
| text-processing | text-awk-sed-log-analytics | 0.26 | 0.28 | 0.27 | 0.26 | 0.29 | 3774.8 | 653 |
| structured-data | structured-jq-yq-pipeline | 0.12 | 0.14 | 0.13 | 0.12 | 0.14 | 7825.7 | 214 |
| database | sqlite3-join-aggregation | 0.02 | 0.02 | 0.02 | 0.01 | 0.02 | 61162.1 | 312 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.19 | 0.33 | 0.24 | 0.17 | 0.33 | 4213.6 | 753 |
| compression | compression-zstd-xz-stream | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 14700.5 | 588 |
| vfs | vfs-tree-clone-chmod-stat | 0.26 | 0.27 | 0.26 | 0.25 | 0.27 | 3822.8 | 731 |
| math-utils | math-awk-bc-numfmt-reduction | 0.74 | 0.76 | 0.75 | 0.74 | 0.76 | 1339.3 | 3490 |
| chaos | chaos-adversarial-find-xargs0 | 0.06 | 0.07 | 0.06 | 0.06 | 0.07 | 15676.0 | 131 |
| lifecycle | shell-cold-start-and-exec | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 | 75188.0 | 150 |
| diff-patch | diff-patch-diff3-merge | 0.09 | 0.10 | 0.09 | 0.08 | 0.10 | 11384.1 | 192 |
| csv-analytics | csvkit-xan-data-science | 0.07 | 0.09 | 0.07 | 0.07 | 0.09 | 13323.0 | 75 |
| web-scraping | htmlq-xmllint-web-scraping | 0.03 | 0.03 | 0.03 | 0.03 | 0.03 | 32751.0 | 265 |
| session-state | session-state-json-roundtrip | 0.05 | 0.05 | 0.05 | 0.04 | 0.05 | 20137.6 | 277 |
| document-media | document-mermaid-svg-pipeline | 0.03 | 0.03 | 0.03 | 0.02 | 0.03 | 38822.3 | 174 |
| agent-workflow | agent-refactor-release-pipeline | 0.96 | 1.01 | 0.96 | 0.91 | 1.02 | 1042.0 | 3901 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 14520.9 | 134 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.06 | 0.06 | 0.06 | 0.05 | 0.06 | 18124.2 | 112 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.34 | 0.35 | 0.34 | 0.33 | 0.35 | 2932.0 | 1350 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 | 17636.6 | 57 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.08 | 0.09 | 0.08 | 0.08 | 0.09 | 11983.3 | 84 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.12 | 0.12 | 0.12 | 0.12 | 0.12 | 8279.9 | 596 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.09 | 0.09 | 0.09 | 0.09 | 0.09 | 10864.7 | 491 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.07 | 0.07 | 0.06 | 0.06 | 0.07 | 15538.0 | 320 |
