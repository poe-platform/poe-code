# Benchmark Run: TypeScript safe-bash (OverlayFileSystem Copy-on-Write) (`ts-baseline-overlay-cow-fs`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `overlay-cow-fs`
- **Timestamp**: `2026-10-06T08:03:17.423Z`
- **Git Commit**: `eefb24200b`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 26
- **Geometric Mean p50**: 6.929 ms
- **Total Suite Duration**: 2243.88 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.75 | 4.63 | 3.97 | 3.47 | 4.68 | 251.7 | 10263 |
| pipelines | pipeline-6-stage-stream | 4.86 | 5.36 | 4.85 | 4.49 | 5.48 | 206.3 | 17050 |
| search | search-rg-find-monorepo | 26.58 | 27.47 | 26.32 | 24.98 | 27.48 | 38.0 | 35227 |
| text-processing | text-awk-sed-log-analytics | 1.06 | 1.43 | 1.16 | 1.02 | 1.50 | 865.5 | 2335 |
| structured-data | structured-jq-yq-pipeline | 2.32 | 2.45 | 2.33 | 2.19 | 2.45 | 429.8 | 2341 |
| database | sqlite3-join-aggregation | 0.77 | 1.86 | 1.00 | 0.67 | 2.13 | 996.8 | 1787 |
| archives | archive-tar-gzip-sha256-roundtrip | 30.70 | 31.10 | 30.54 | 29.53 | 31.18 | 32.7 | 40656 |
| compression | compression-zstd-xz-stream | 12.41 | 21.43 | 14.86 | 10.72 | 22.65 | 67.3 | 31930 |
| vfs | vfs-tree-clone-chmod-stat | 50.99 | 52.78 | 51.07 | 49.49 | 52.97 | 19.6 | 61343 |
| math-utils | math-awk-bc-numfmt-reduction | 0.92 | 1.49 | 1.06 | 0.88 | 1.62 | 945.3 | 3247 |
| chaos | chaos-adversarial-find-xargs0 | 8.68 | 8.90 | 8.36 | 7.57 | 8.91 | 119.6 | 10945 |
| lifecycle | shell-cold-start-and-exec | 0.91 | 1.07 | 0.95 | 0.89 | 1.10 | 1047.7 | 1743 |
| diff-patch | diff-patch-diff3-merge | 20.87 | 21.82 | 20.84 | 20.16 | 22.04 | 48.0 | 27313 |
| csv-analytics | csvkit-xan-data-science | 4.05 | 4.80 | 4.27 | 3.85 | 4.86 | 234.0 | 7792 |
| web-scraping | htmlq-xmllint-web-scraping | 6.16 | 7.14 | 6.20 | 5.33 | 7.38 | 161.2 | 14272 |
| session-state | session-state-json-roundtrip | 1.02 | 1.50 | 1.15 | 0.99 | 1.58 | 869.8 | 1310 |
| document-media | document-mermaid-svg-pipeline | 4.81 | 5.54 | 4.76 | 4.04 | 5.67 | 210.0 | 5636 |
| agent-workflow | agent-refactor-release-pipeline | 114.71 | 116.22 | 114.75 | 112.35 | 116.31 | 8.7 | 128693 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 7.65 | 8.98 | 7.92 | 7.32 | 9.23 | 126.2 | 8996 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 13.70 | 13.82 | 13.56 | 13.21 | 13.85 | 73.8 | 14521 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 84.85 | 91.88 | 85.11 | 77.18 | 92.49 | 11.8 | 83962 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.73 | 7.77 | 6.93 | 6.45 | 8.01 | 144.3 | 16837 |
| document-media | media-office-ffmpeg-soffice-pipeline | 10.40 | 10.78 | 10.07 | 8.90 | 10.82 | 99.3 | 20425 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.97 | 7.39 | 6.78 | 5.94 | 7.49 | 147.4 | 7401 |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 17.57 | 18.36 | 17.49 | 16.53 | 18.50 | 57.2 | 22158 |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.47 | 2.89 | 2.46 | 2.03 | 2.99 | 405.9 | 6913 |
