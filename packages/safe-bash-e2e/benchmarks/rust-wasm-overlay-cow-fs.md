# Benchmark Run: Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write) (`rust-wasm-overlay-cow-fs`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-06T08:03:19.055Z`
- **Git Commit**: `eefb24200b`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.183 ms
- **Total Suite Duration**: 49.093 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.58 | 0.67 | 0.59 | 0.54 | 0.69 | 1694.7 | 2978 |
| pipelines | pipeline-6-stage-stream | 2.35 | 3.16 | 2.51 | 2.17 | 3.35 | 398.3 | 4462 |
| search | search-rg-find-monorepo | 0.99 | 1.16 | 1.04 | 0.95 | 1.17 | 960.9 | 1024 |
| text-processing | text-awk-sed-log-analytics | 0.38 | 0.39 | 0.38 | 0.37 | 0.39 | 2623.9 | 650 |
| structured-data | structured-jq-yq-pipeline | 0.13 | 0.13 | 0.13 | 0.12 | 0.13 | 7907.2 | 714 |
| database | sqlite3-join-aggregation | 0.02 | 0.02 | 0.02 | 0.02 | 0.02 | 43368.9 | 23 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.25 | 0.26 | 0.25 | 0.24 | 0.26 | 3962.5 | 252 |
| compression | compression-zstd-xz-stream | 0.08 | 0.09 | 0.08 | 0.07 | 0.09 | 12496.1 | 603 |
| vfs | vfs-tree-clone-chmod-stat | 0.43 | 0.48 | 0.44 | 0.42 | 0.49 | 2270.8 | 867 |
| math-utils | math-awk-bc-numfmt-reduction | 0.82 | 0.85 | 0.82 | 0.80 | 0.86 | 1213.9 | 1180 |
| chaos | chaos-adversarial-find-xargs0 | 0.12 | 0.13 | 0.12 | 0.12 | 0.13 | 8201.2 | 122 |
| lifecycle | shell-cold-start-and-exec | 0.07 | 0.07 | 0.07 | 0.06 | 0.07 | 14856.9 | 90 |
| diff-patch | diff-patch-diff3-merge | 0.14 | 0.14 | 0.14 | 0.13 | 0.14 | 7380.5 | 136 |
| csv-analytics | csvkit-xan-data-science | 0.09 | 0.10 | 0.09 | 0.09 | 0.10 | 10604.5 | 93 |
| web-scraping | htmlq-xmllint-web-scraping | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 21216.6 | 202 |
| session-state | session-state-json-roundtrip | 0.09 | 0.09 | 0.09 | 0.09 | 0.09 | 11322.9 | 282 |
| document-media | document-mermaid-svg-pipeline | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 | 24125.3 | 42 |
| agent-workflow | agent-refactor-release-pipeline | 1.56 | 1.60 | 1.53 | 1.45 | 1.61 | 652.2 | 2054 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.11 | 0.12 | 0.11 | 0.11 | 0.12 | 8945.9 | 112 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.10 | 0.10 | 0.10 | 0.10 | 0.10 | 10228.4 | 98 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.47 | 0.53 | 0.48 | 0.47 | 0.54 | 2073.5 | 693 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.08 | 0.08 | 0.08 | 0.07 | 0.08 | 12676.9 | 79 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.14 | 0.14 | 0.14 | 0.13 | 0.14 | 7366.5 | 216 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.20 | 0.23 | 0.20 | 0.17 | 0.24 | 4985.5 | 887 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.16 | 0.19 | 0.17 | 0.16 | 0.19 | 5894.8 | 446 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.14 | 0.17 | 0.14 | 0.13 | 0.17 | 6937.2 | 288 |
