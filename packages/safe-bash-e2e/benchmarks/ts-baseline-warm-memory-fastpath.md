# Benchmark Run: TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) (`ts-baseline-warm-memory-fastpath`)

- **Backend**: `ts-safe-bash`
- **Optimization Tag**: `warm-memory-fastpath`
- **Timestamp**: `2026-10-04T07:19:08.845Z`
- **Git Commit**: `b6a4a8646f`
- **Platform**: `darwin/arm64` (10 cores, Node `v22.22.2`)
- **Total Scenarios**: 24
- **Geometric Mean p50**: 2.599 ms
- **Total Suite Duration**: 573.156 ms

| Category | Scenario | p50 (ms) | p95 (ms) | Mean (ms) | Min (ms) | Max (ms) | Ops/sec | CPU User (us) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 4.51 | 6.32 | 4.96 | 3.75 | 6.47 | 201.7 | 8217 |
| pipelines | pipeline-6-stage-stream | 2.55 | 2.82 | 2.55 | 2.27 | 2.89 | 392.4 | 6102 |
| search | search-rg-find-monorepo | 7.43 | 8.98 | 7.84 | 7.04 | 9.11 | 127.5 | 21224 |
| text-processing | text-awk-sed-log-analytics | 0.71 | 1.35 | 0.85 | 0.58 | 1.46 | 1171.2 | 1123 |
| structured-data | structured-jq-yq-pipeline | 0.79 | 1.22 | 0.89 | 0.74 | 1.30 | 1121.2 | 975 |
| database | sqlite3-join-aggregation | 0.71 | 0.82 | 0.65 | 0.44 | 0.83 | 1537.0 | 1171 |
| archives | archive-tar-gzip-sha256-roundtrip | 6.44 | 7.76 | 6.55 | 5.18 | 7.96 | 152.6 | 18177 |
| compression | compression-zstd-xz-stream | 10.97 | 13.68 | 11.29 | 8.18 | 13.87 | 88.6 | 25767 |
| vfs | vfs-tree-clone-chmod-stat | 3.68 | 4.02 | 3.72 | 3.50 | 4.08 | 268.7 | 6117 |
| math-utils | math-awk-bc-numfmt-reduction | 1.32 | 1.80 | 1.33 | 1.01 | 1.93 | 754.3 | 2985 |
| chaos | chaos-adversarial-find-xargs0 | 1.66 | 1.94 | 1.64 | 1.43 | 2.00 | 608.3 | 3062 |
| lifecycle | shell-cold-start-and-exec | 1.25 | 1.43 | 1.24 | 1.06 | 1.46 | 807.0 | 1968 |
| diff-patch | diff-patch-diff3-merge | 3.42 | 3.65 | 3.10 | 2.35 | 3.65 | 322.3 | 4587 |
| csv-analytics | csvkit-xan-data-science | 3.78 | 4.49 | 3.84 | 3.22 | 4.65 | 260.1 | 6668 |
| web-scraping | htmlq-xmllint-web-scraping | 1.18 | 2.34 | 1.48 | 0.94 | 2.52 | 676.4 | 2214 |
| session-state | session-state-json-roundtrip | 1.77 | 3.13 | 1.97 | 1.30 | 3.41 | 507.3 | 3893 |
| document-media | document-mermaid-svg-pipeline | 1.10 | 2.40 | 1.43 | 0.86 | 2.60 | 698.0 | 1517 |
| agent-workflow | agent-refactor-release-pipeline | 11.81 | 12.62 | 11.66 | 10.69 | 12.74 | 85.8 | 24315 |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.25 | 3.25 | 2.47 | 2.08 | 3.49 | 405.0 | 3665 |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.60 | 1.80 | 1.61 | 1.50 | 1.85 | 620.0 | 1741 |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 37.36 | 42.65 | 36.38 | 29.13 | 43.85 | 27.5 | 70683 |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 1.64 | 1.77 | 1.62 | 1.43 | 1.78 | 615.9 | 2662 |
| document-media | media-office-ffmpeg-soffice-pipeline | 2.85 | 6.65 | 3.81 | 2.42 | 7.33 | 262.7 | 6961 |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 1.68 | 1.98 | 1.73 | 1.50 | 2.02 | 578.5 | 6451 |
