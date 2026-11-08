# Benchmark Run: Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev) (`rust-wasm-strict-budgets-mount-dev`)

- **Backend**: `rust-safe-bash`
- **Optimization Tag**: `strict-budgets-mount-dev`
- **Timestamp**: `2026-10-06T16:42:46.752Z`
- **Git Commit**: `ec7d1ab7e5`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 0.322 ms
- **Total Suite Duration**: 130.233 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 2.13 | 14.03 | 4.97 | 0.59 | 16.44 | 201.1 | 3345 |
| pipelines | pipeline-6-stage-stream | 8.58 | 13.87 | 8.27 | 2.87 | 14.65 | 120.9 | 5708 |
| search | search-rg-find-monorepo | 1.26 | 1.67 | 1.32 | 1.05 | 1.71 | 758.3 | 2306 |
| text-processing | text-awk-sed-log-analytics | 0.49 | 0.76 | 0.56 | 0.40 | 0.77 | 1783.2 | 1097 |
| structured-data | structured-jq-yq-pipeline | 0.36 | 0.37 | 0.36 | 0.35 | 0.38 | 2786.0 | 695 |
| database | sqlite3-join-aggregation | 0.14 | 0.16 | 0.15 | 0.14 | 0.16 | 6664.4 | 142 |
| archives | archive-tar-gzip-sha256-roundtrip | 0.30 | 0.50 | 0.35 | 0.29 | 0.55 | 2834.2 | 568 |
| compression | compression-zstd-xz-stream | 0.07 | 0.08 | 0.07 | 0.07 | 0.08 | 13404.8 | 229 |
| vfs | vfs-tree-clone-chmod-stat | 0.41 | 1.11 | 0.64 | 0.39 | 1.19 | 1555.3 | 547 |
| math-utils | math-awk-bc-numfmt-reduction | 2.10 | 2.35 | 2.08 | 1.71 | 2.39 | 482.0 | 1912 |
| chaos | chaos-adversarial-find-xargs0 | 0.14 | 0.47 | 0.26 | 0.12 | 0.47 | 3808.8 | 191 |
| lifecycle | shell-cold-start-and-exec | 0.22 | 2.81 | 0.88 | 0.09 | 3.36 | 1131.1 | 885 |
| diff-patch | diff-patch-diff3-merge | 0.15 | 0.16 | 0.15 | 0.15 | 0.16 | 6580.8 | 339 |
| csv-analytics | csvkit-xan-data-science | 0.10 | 0.37 | 0.17 | 0.09 | 0.42 | 5808.9 | 116 |
| web-scraping | htmlq-xmllint-web-scraping | 0.10 | 0.14 | 0.11 | 0.08 | 0.14 | 9265.0 | 89 |
| session-state | session-state-json-roundtrip | 0.10 | 0.16 | 0.11 | 0.09 | 0.17 | 9140.8 | 100 |
| document-media | document-mermaid-svg-pipeline | 0.05 | 0.05 | 0.05 | 0.04 | 0.05 | 21509.2 | 47 |
| agent-workflow | agent-refactor-release-pipeline | 2.86 | 3.98 | 2.95 | 2.19 | 4.24 | 339.1 | 2607 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 0.27 | 0.41 | 0.28 | 0.12 | 0.43 | 3546.5 | 249 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 0.12 | 0.27 | 0.17 | 0.11 | 0.27 | 5853.1 | 145 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 0.53 | 0.80 | 0.58 | 0.49 | 0.86 | 1708.1 | 865 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 0.22 | 0.25 | 0.22 | 0.19 | 0.25 | 4638.9 | 487 |
| document-media | media-office-ffmpeg-soffice-pipeline | 0.33 | 0.44 | 0.31 | 0.18 | 0.47 | 3204.5 | 922 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 0.22 | 0.58 | 0.33 | 0.19 | 0.61 | 3013.8 | 1002 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 0.26 | 0.68 | 0.36 | 0.23 | 0.77 | 2756.4 | 863 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 0.36 | 0.49 | 0.33 | 0.17 | 0.50 | 3045.7 | 1105 |
