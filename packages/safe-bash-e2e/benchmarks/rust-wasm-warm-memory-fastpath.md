# Benchmark Run: Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath) (`rust-wasm-warm-memory-fastpath`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-06T16:42:46.421Z`
- **Git Commit**: `ec7d1ab7e5`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.241 ms
- **Total Suite Duration**: 66.829 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.74 | 0.75 | 0.74 | 0.72 | 0.75 | 1356.7 | 3266 |
| pipelines | pipeline-6-stage-stream | 2.68 | 3.16 | 2.80 | 2.62 | 3.25 | 357.3 | 9240 |
| search | search-rg-find-monorepo | 1.03 | 1.06 | 1.03 | 1.01 | 1.06 | 967.0 | 3687 |
| text-processing | text-awk-sed-log-analytics | 0.44 | 0.45 | 0.44 | 0.43 | 0.46 | 2267.8 | 1199 |
| structured-data | structured-jq-yq-pipeline | 0.18 | 0.21 | 0.19 | 0.18 | 0.22 | 5235.8 | 363 |
| database | sqlite3-join-aggregation | 0.08 | 0.24 | 0.12 | 0.08 | 0.27 | 8259.9 | 210 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.46 | 0.78 | 0.53 | 0.43 | 0.86 | 1896.4 | 1995 |
| compression | compression-zstd-xz-stream | 0.09 | 0.50 | 0.19 | 0.09 | 0.60 | 5149.8 | 937 |
| vfs | vfs-tree-clone-chmod-stat | 0.35 | 0.36 | 0.35 | 0.35 | 0.36 | 2828.4 | 1240 |
| math-utils | math-awk-bc-numfmt-reduction | 0.95 | 1.48 | 1.08 | 0.95 | 1.61 | 922.5 | 3608 |
| chaos | chaos-adversarial-find-xargs0 | 0.12 | 0.13 | 0.12 | 0.12 | 0.13 | 8233.8 | 425 |
| lifecycle | shell-cold-start-and-exec | 0.08 | 0.10 | 0.08 | 0.07 | 0.10 | 11980.8 | 573 |
| diff-patch | diff-patch-diff3-merge | 0.23 | 0.34 | 0.24 | 0.16 | 0.36 | 4241.5 | 796 |
| csv-analytics | csvkit-xan-data-science | 0.12 | 0.35 | 0.17 | 0.11 | 0.40 | 5729.8 | 624 |
| web-scraping | htmlq-xmllint-web-scraping | 0.07 | 0.21 | 0.11 | 0.07 | 0.24 | 9349.4 | 566 |
| session-state | session-state-json-roundtrip | 0.11 | 0.26 | 0.14 | 0.10 | 0.30 | 7003.2 | 377 |
| document-media | document-mermaid-svg-pipeline | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 20147.8 | 143 |
| agent-workflow | agent-refactor-release-pipeline | 2.94 | 4.64 | 3.02 | 1.75 | 4.85 | 330.9 | 14509 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.12 | 0.13 | 0.12 | 0.12 | 0.13 | 8103.7 | 679 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 9819.2 | 452 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.49 | 0.59 | 0.52 | 0.49 | 0.61 | 1928.4 | 2138 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.10 | 0.10 | 0.10 | 0.10 | 0.11 | 10030.1 | 325 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.17 | 0.56 | 0.31 | 0.16 | 0.58 | 3258.7 | 1317 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.47 | 0.57 | 0.41 | 0.22 | 0.57 | 2426.1 | 1302 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.23 | 0.24 | 0.24 | 0.23 | 0.24 | 4241.5 | 1272 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 | 6707.3 | 567 |
