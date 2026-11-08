# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-06T16:42:44.148Z`
- **Git Commit**: `ec7d1ab7e5`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 7.756 ms
- **Total Suite Duration**: 2721.707 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.98 | 5.47 | 4.50 | 3.75 | 5.51 | 222.1 | 13492 |
| pipelines | pipeline-6-stage-stream | 7.04 | 8.62 | 6.72 | 4.64 | 8.74 | 148.8 | 19092 |
| search | search-rg-find-monorepo | 28.71 | 29.97 | 28.57 | 27.12 | 30.12 | 35.0 | 38246 |
| text-processing | text-awk-sed-log-analytics | 1.13 | 1.53 | 1.19 | 0.99 | 1.62 | 843.4 | 2114 |
| structured-data | structured-jq-yq-pipeline | 2.40 | 2.48 | 2.37 | 2.23 | 2.50 | 422.4 | 2776 |
| database | sqlite3-join-aggregation | 0.81 | 2.09 | 1.11 | 0.74 | 2.40 | 899.9 | 1941 |
| archives | archive-tar-gzip-sha256-roundtrip | 32.70 | 33.93 | 32.92 | 31.91 | 33.99 | 30.4 | 43065 |
| compression | compression-zstd-xz-stream | 13.82 | 24.57 | 16.60 | 12.32 | 26.49 | 60.2 | 36343 |
| vfs | vfs-tree-clone-chmod-stat | 57.54 | 82.87 | 63.71 | 57.02 | 89.20 | 15.7 | 75569 |
| math-utils | math-awk-bc-numfmt-reduction | 1.20 | 2.09 | 1.34 | 0.93 | 2.29 | 744.5 | 4051 |
| chaos | chaos-adversarial-find-xargs0 | 9.36 | 10.15 | 9.26 | 8.43 | 10.32 | 108.0 | 12544 |
| lifecycle | shell-cold-start-and-exec | 0.96 | 1.17 | 1.01 | 0.91 | 1.21 | 990.7 | 1986 |
| diff-patch | diff-patch-diff3-merge | 24.66 | 26.71 | 24.90 | 23.60 | 26.99 | 40.2 | 32806 |
| csv-analytics | csvkit-xan-data-science | 5.08 | 5.77 | 5.09 | 4.37 | 5.89 | 196.6 | 9615 |
| web-scraping | htmlq-xmllint-web-scraping | 6.99 | 9.03 | 7.13 | 5.69 | 9.49 | 140.2 | 15851 |
| session-state | session-state-json-roundtrip | 1.13 | 2.01 | 1.36 | 1.07 | 2.18 | 733.3 | 1555 |
| document-media | document-mermaid-svg-pipeline | 4.78 | 6.39 | 5.24 | 4.39 | 6.57 | 190.8 | 6177 |
| agent-workflow | agent-refactor-release-pipeline | 130.36 | 269.77 | 164.40 | 126.80 | 304.02 | 6.1 | 151379 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 9.10 | 12.61 | 9.79 | 7.99 | 13.32 | 102.1 | 10785 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 15.61 | 23.57 | 17.61 | 14.28 | 24.97 | 56.8 | 18176 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 90.74 | 91.88 | 90.82 | 89.92 | 92.02 | 11.0 | 92058 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 8.64 | 12.40 | 8.94 | 6.63 | 13.24 | 111.9 | 19093 |
| document-media | media-office-ffmpeg-soffice-pipeline | 9.83 | 11.10 | 10.02 | 8.86 | 11.18 | 99.8 | 20286 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.79 | 7.43 | 6.79 | 6.16 | 7.46 | 147.3 | 7661 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 20.15 | 21.66 | 19.84 | 18.37 | 22.02 | 50.4 | 23761 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.94 | 3.68 | 3.10 | 2.60 | 3.70 | 322.2 | 6246 |
