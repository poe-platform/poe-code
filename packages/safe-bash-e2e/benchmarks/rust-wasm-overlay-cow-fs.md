# Benchmark Run: Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write) (`rust-wasm-overlay-cow-fs`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-06T04:14:33.236Z`
- **Git Commit**: `ff78f654ea`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.112 ms
- **Total Suite Duration**: 35.169 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 0.16 | 0.17 | 0.16 | 0.16 | 0.17 | 6169.7 | 869 |
| pipelines | pipeline-6-stage-stream | 2.16 | 2.26 | 2.18 | 2.11 | 2.27 | 458.1 | 8571 |
| search | search-rg-find-monorepo | 0.56 | 0.58 | 0.57 | 0.56 | 0.58 | 1768.3 | 564 |
| text-processing | text-awk-sed-log-analytics | 0.23 | 0.24 | 0.23 | 0.23 | 0.24 | 4261.2 | 234 |
| structured-data | structured-jq-yq-pipeline | 0.10 | 0.10 | 0.10 | 0.10 | 0.11 | 9833.7 | 292 |
| database | sqlite3-join-aggregation | 0.02 | 0.02 | 0.02 | 0.01 | 0.02 | 62144.2 | 16 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.23 | 0.24 | 0.23 | 0.21 | 0.24 | 4437.0 | 423 |
| compression | compression-zstd-xz-stream | 0.05 | 0.06 | 0.06 | 0.05 | 0.07 | 18015.4 | 78 |
| vfs | vfs-tree-clone-chmod-stat | 0.39 | 0.39 | 0.39 | 0.37 | 0.39 | 2594.8 | 763 |
| math-utils | math-awk-bc-numfmt-reduction | 0.76 | 0.76 | 0.75 | 0.72 | 0.76 | 1339.5 | 1816 |
| chaos | chaos-adversarial-find-xargs0 | 0.07 | 0.08 | 0.07 | 0.07 | 0.08 | 13847.2 | 72 |
| lifecycle | shell-cold-start-and-exec | 0.01 | 0.01 | 0.01 | 0.01 | 0.01 | 73528.3 | 14 |
| diff-patch | diff-patch-diff3-merge | 0.09 | 0.09 | 0.09 | 0.08 | 0.09 | 11497.5 | 87 |
| csv-analytics | csvkit-xan-data-science | 0.07 | 0.07 | 0.07 | 0.06 | 0.07 | 15386.5 | 65 |
| web-scraping | htmlq-xmllint-web-scraping | 0.03 | 0.03 | 0.03 | 0.03 | 0.04 | 33140.2 | 30 |
| session-state | session-state-json-roundtrip | 0.04 | 0.05 | 0.04 | 0.04 | 0.05 | 22692.7 | 44 |
| document-media | document-mermaid-svg-pipeline | 0.02 | 0.03 | 0.02 | 0.02 | 0.03 | 40886.4 | 25 |
| agent-workflow | agent-refactor-release-pipeline | 1.09 | 1.10 | 1.08 | 1.03 | 1.10 | 927.0 | 1319 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.07 | 0.07 | 0.07 | 0.07 | 0.07 | 13786.8 | 73 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.06 | 0.06 | 0.06 | 0.06 | 0.07 | 17167.4 | 57 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.41 | 0.42 | 0.41 | 0.41 | 0.42 | 2410.2 | 646 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 | 16939.6 | 60 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.08 | 0.08 | 0.08 | 0.08 | 0.08 | 12392.9 | 130 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.11 | 0.12 | 0.11 | 0.11 | 0.12 | 8881.0 | 246 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.09 | 0.09 | 0.09 | 0.08 | 0.09 | 11454.8 | 87 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.06 | 0.06 | 0.06 | 0.06 | 0.06 | 17298.6 | 58 |
