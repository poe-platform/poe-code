# Benchmark Run: Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write) (`rust-wasm-overlay-cow-fs`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-06T16:42:46.531Z`
- **Git Commit**: `ec7d1ab7e5`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.24 ms
- **Total Suite Duration**: 75.503 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.85 | 1.28 | 0.92 | 0.59 | 1.29 | 1090.1 | 5396 |
| pipelines | pipeline-6-stage-stream | 4.21 | 6.49 | 4.27 | 2.55 | 6.82 | 234.4 | 19861 |
| search | search-rg-find-monorepo | 2.56 | 3.26 | 2.53 | 1.60 | 3.42 | 394.8 | 11869 |
| text-processing | text-awk-sed-log-analytics | 0.41 | 0.41 | 0.41 | 0.41 | 0.41 | 2435.7 | 2199 |
| structured-data | structured-jq-yq-pipeline | 0.15 | 0.16 | 0.16 | 0.15 | 0.16 | 6416.4 | 667 |
| database | sqlite3-join-aggregation | 0.07 | 0.08 | 0.07 | 0.07 | 0.08 | 13914.7 | 205 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.38 | 0.39 | 0.39 | 0.38 | 0.39 | 2588.9 | 1931 |
| compression | compression-zstd-xz-stream | 0.08 | 0.08 | 0.08 | 0.08 | 0.08 | 12142.1 | 395 |
| vfs | vfs-tree-clone-chmod-stat | 0.53 | 0.54 | 0.53 | 0.52 | 0.54 | 1892.4 | 1905 |
| math-utils | math-awk-bc-numfmt-reduction | 0.90 | 1.06 | 0.94 | 0.88 | 1.10 | 1069.0 | 3260 |
| chaos | chaos-adversarial-find-xargs0 | 0.13 | 0.14 | 0.13 | 0.13 | 0.14 | 7492.5 | 704 |
| lifecycle | shell-cold-start-and-exec | 0.08 | 0.08 | 0.08 | 0.07 | 0.08 | 12780.9 | 483 |
| diff-patch | diff-patch-diff3-merge | 0.16 | 0.16 | 0.16 | 0.16 | 0.16 | 6241.2 | 768 |
| csv-analytics | csvkit-xan-data-science | 0.10 | 0.11 | 0.11 | 0.10 | 0.11 | 9464.5 | 274 |
| web-scraping | htmlq-xmllint-web-scraping | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 13882.5 | 587 |
| session-state | session-state-json-roundtrip | 0.09 | 0.10 | 0.10 | 0.09 | 0.10 | 10365.3 | 326 |
| document-media | document-mermaid-svg-pipeline | 0.05 | 0.05 | 0.05 | 0.05 | 0.05 | 20185.0 | 125 |
| agent-workflow | agent-refactor-release-pipeline | 2.20 | 2.51 | 2.27 | 2.13 | 2.56 | 440.2 | 5733 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.16 | 0.17 | 0.15 | 0.13 | 0.17 | 6582.9 | 255 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.10 | 0.11 | 0.10 | 0.10 | 0.11 | 9690.7 | 141 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.68 | 0.97 | 0.78 | 0.63 | 0.98 | 1283.2 | 1572 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.09 | 0.10 | 0.09 | 0.09 | 0.10 | 10586.7 | 149 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.15 | 0.16 | 0.15 | 0.14 | 0.16 | 6523.5 | 212 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.20 | 0.20 | 0.20 | 0.18 | 0.20 | 5132.8 | 413 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.23 | 0.23 | 0.23 | 0.22 | 0.23 | 4367.1 | 662 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.14 | 0.14 | 0.14 | 0.14 | 0.14 | 7130.5 | 307 |
