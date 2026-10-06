# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `eefb24200b` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **4.53** | 1082.28 | 290.1 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **6.93** | 2243.88 | 293.0 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **3.46** | 992.13 | 454.3 |
| `rust-wasm-warm-memory-fastpath` | Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath) | `rust-safe-bash` | **0.19** | 50.94 | 8590.5 |
| `rust-wasm-overlay-cow-fs` | Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write) | `rust-safe-bash` | **0.18** | 49.09 | 9014.1 |
| `rust-wasm-strict-budgets-mount-dev` | Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev) | `rust-safe-bash` | **0.17** | 43.71 | 9363.3 |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-warm-memory-fastpath` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **23.83x**
- **Total Duration Speedup**: **21.25x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 6.08 | 0.72 | **8.39x** | -88.1% |
| pipelines | pipeline-6-stage-stream | 7.46 | 2.82 | **2.65x** | -62.2% |
| search | search-rg-find-monorepo | 5.17 | 0.95 | **5.43x** | -81.6% |
| text-processing | text-awk-sed-log-analytics | 1.18 | 0.40 | **2.93x** | -65.9% |
| structured-data | structured-jq-yq-pipeline | 2.51 | 0.15 | **16.86x** | -94.1% |
| database | sqlite3-join-aggregation | 1.51 | 0.03 | **60.40x** | -98.3% |
| archives | archive-tar-gzip-sha256-roundtrip | 7.30 | 0.34 | **21.22x** | -95.3% |
| compression | compression-zstd-xz-stream | 16.55 | 0.09 | **179.89x** | -99.4% |
| vfs | vfs-tree-clone-chmod-stat | 4.65 | 0.29 | **16.20x** | -93.8% |
| math-utils | math-awk-bc-numfmt-reduction | 1.59 | 0.86 | **1.85x** | -45.9% |
| chaos | chaos-adversarial-find-xargs0 | 2.18 | 0.12 | **18.31x** | -94.5% |
| lifecycle | shell-cold-start-and-exec | 1.93 | 0.07 | **29.75x** | -96.6% |
| diff-patch | diff-patch-diff3-merge | 6.38 | 0.14 | **46.53x** | -97.9% |
| csv-analytics | csvkit-xan-data-science | 5.26 | 0.10 | **55.41x** | -98.2% |
| web-scraping | htmlq-xmllint-web-scraping | 5.19 | 0.05 | **105.96x** | -99.1% |
| session-state | session-state-json-roundtrip | 2.32 | 0.10 | **23.65x** | -95.8% |
| document-media | document-mermaid-svg-pipeline | 2.00 | 0.04 | **46.49x** | -97.8% |
| agent-workflow | agent-refactor-release-pipeline | 15.04 | 1.37 | **10.98x** | -90.9% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.69 | 0.12 | **22.60x** | -95.6% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.19 | 0.10 | **21.48x** | -95.3% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 34.24 | 0.45 | **76.76x** | -98.7% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.96 | 0.08 | **86.99x** | -98.8% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.24 | 0.14 | **23.13x** | -95.7% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.56 | 0.17 | **20.61x** | -95.1% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 56.78 | 0.16 | **359.35x** | -99.7% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.65 | 0.17 | **15.51x** | -93.6% |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-overlay-cow-fs` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **37.82x**
- **Total Duration Speedup**: **45.71x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.75 | 0.58 | **6.42x** | -84.4% |
| pipelines | pipeline-6-stage-stream | 4.86 | 2.35 | **2.06x** | -51.5% |
| search | search-rg-find-monorepo | 26.58 | 0.99 | **26.77x** | -96.3% |
| text-processing | text-awk-sed-log-analytics | 1.06 | 0.38 | **2.80x** | -64.2% |
| structured-data | structured-jq-yq-pipeline | 2.32 | 0.13 | **18.13x** | -94.5% |
| database | sqlite3-join-aggregation | 0.77 | 0.02 | **33.65x** | -97.0% |
| archives | archive-tar-gzip-sha256-roundtrip | 30.70 | 0.25 | **120.86x** | -99.2% |
| compression | compression-zstd-xz-stream | 12.41 | 0.08 | **163.33x** | -99.4% |
| vfs | vfs-tree-clone-chmod-stat | 50.99 | 0.43 | **117.49x** | -99.1% |
| math-utils | math-awk-bc-numfmt-reduction | 0.92 | 0.82 | **1.13x** | -11.3% |
| chaos | chaos-adversarial-find-xargs0 | 8.68 | 0.12 | **71.75x** | -98.6% |
| lifecycle | shell-cold-start-and-exec | 0.91 | 0.07 | **14.06x** | -92.9% |
| diff-patch | diff-patch-diff3-merge | 20.87 | 0.14 | **153.47x** | -99.3% |
| csv-analytics | csvkit-xan-data-science | 4.05 | 0.09 | **44.00x** | -97.7% |
| web-scraping | htmlq-xmllint-web-scraping | 6.16 | 0.05 | **131.09x** | -99.2% |
| session-state | session-state-json-roundtrip | 1.02 | 0.09 | **11.70x** | -91.5% |
| document-media | document-mermaid-svg-pipeline | 4.81 | 0.04 | **117.22x** | -99.1% |
| agent-workflow | agent-refactor-release-pipeline | 114.71 | 1.56 | **73.44x** | -98.6% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 7.65 | 0.11 | **69.57x** | -98.6% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 13.70 | 0.10 | **139.75x** | -99.3% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 84.85 | 0.47 | **180.91x** | -99.4% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.73 | 0.08 | **84.15x** | -98.8% |
| document-media | media-office-ffmpeg-soffice-pipeline | 10.40 | 0.14 | **75.88x** | -98.7% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.97 | 0.20 | **34.15x** | -97.1% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 17.57 | 0.16 | **107.82x** | -99.1% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.47 | 0.14 | **17.87x** | -94.4% |

---

# Benchmark Comparison: `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)` vs `Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev)`

- **Baseline**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-strict-budgets-mount-dev` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **20.46x**
- **Total Duration Speedup**: **22.70x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.25 | 0.54 | **6.03x** | -83.4% |
| pipelines | pipeline-6-stage-stream | 4.43 | 2.24 | **1.98x** | -49.5% |
| search | search-rg-find-monorepo | 4.96 | 0.78 | **6.39x** | -84.4% |
| text-processing | text-awk-sed-log-analytics | 0.69 | 0.36 | **1.92x** | -47.8% |
| structured-data | structured-jq-yq-pipeline | 1.47 | 0.12 | **12.22x** | -91.8% |
| database | sqlite3-join-aggregation | 0.59 | 0.02 | **25.48x** | -96.1% |
| archives | archive-tar-gzip-sha256-roundtrip | 6.12 | 0.19 | **32.05x** | -96.9% |
| compression | compression-zstd-xz-stream | 12.76 | 0.07 | **182.21x** | -99.5% |
| vfs | vfs-tree-clone-chmod-stat | 7.06 | 0.32 | **22.42x** | -95.5% |
| math-utils | math-awk-bc-numfmt-reduction | 0.93 | 0.80 | **1.16x** | -13.6% |
| chaos | chaos-adversarial-find-xargs0 | 2.61 | 0.11 | **22.93x** | -95.6% |
| lifecycle | shell-cold-start-and-exec | 0.55 | 0.07 | **8.03x** | -87.5% |
| diff-patch | diff-patch-diff3-merge | 4.69 | 0.13 | **35.77x** | -97.2% |
| csv-analytics | csvkit-xan-data-science | 3.52 | 0.09 | **40.44x** | -97.5% |
| web-scraping | htmlq-xmllint-web-scraping | 4.25 | 0.05 | **92.44x** | -98.9% |
| session-state | session-state-json-roundtrip | 1.16 | 0.09 | **13.44x** | -92.6% |
| document-media | document-mermaid-svg-pipeline | 1.36 | 0.04 | **33.29x** | -97.0% |
| agent-workflow | agent-refactor-release-pipeline | 21.42 | 1.45 | **14.80x** | -93.2% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.48 | 0.11 | **23.19x** | -95.7% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.45 | 0.10 | **25.81x** | -96.1% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 35.49 | 0.40 | **89.85x** | -98.9% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 4.82 | 0.07 | **66.01x** | -98.5% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.01 | 0.15 | **19.39x** | -94.8% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.00 | 0.15 | **19.98x** | -95.0% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 54.58 | 0.14 | **381.68x** | -99.7% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.62 | 0.13 | **20.43x** | -95.1% |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.53x**
- **Total Duration Speedup**: **2.07x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.75 | 6.08 | **0.62x** | +62.4% |
| pipelines | pipeline-6-stage-stream | 4.86 | 7.46 | **0.65x** | +53.7% |
| search | search-rg-find-monorepo | 26.58 | 5.17 | **5.14x** | -80.5% |
| text-processing | text-awk-sed-log-analytics | 1.06 | 1.18 | **0.90x** | +11.1% |
| structured-data | structured-jq-yq-pipeline | 2.32 | 2.51 | **0.92x** | +8.3% |
| database | sqlite3-join-aggregation | 0.77 | 1.51 | **0.51x** | +95.1% |
| archives | archive-tar-gzip-sha256-roundtrip | 30.70 | 7.30 | **4.21x** | -76.2% |
| compression | compression-zstd-xz-stream | 12.41 | 16.55 | **0.75x** | +33.3% |
| vfs | vfs-tree-clone-chmod-stat | 50.99 | 4.65 | **10.97x** | -90.9% |
| math-utils | math-awk-bc-numfmt-reduction | 0.92 | 1.59 | **0.58x** | +72.3% |
| chaos | chaos-adversarial-find-xargs0 | 8.68 | 2.18 | **3.98x** | -74.9% |
| lifecycle | shell-cold-start-and-exec | 0.91 | 1.93 | **0.47x** | +111.6% |
| diff-patch | diff-patch-diff3-merge | 20.87 | 6.38 | **3.27x** | -69.5% |
| csv-analytics | csvkit-xan-data-science | 4.05 | 5.26 | **0.77x** | +30.0% |
| web-scraping | htmlq-xmllint-web-scraping | 6.16 | 5.19 | **1.19x** | -15.7% |
| session-state | session-state-json-roundtrip | 1.02 | 2.32 | **0.44x** | +127.7% |
| document-media | document-mermaid-svg-pipeline | 4.81 | 2.00 | **2.40x** | -58.4% |
| agent-workflow | agent-refactor-release-pipeline | 114.71 | 15.04 | **7.63x** | -86.9% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 7.65 | 2.69 | **2.85x** | -64.9% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 13.70 | 2.19 | **6.25x** | -84.0% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 84.85 | 34.24 | **2.48x** | -59.7% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.73 | 6.96 | **0.97x** | +3.4% |
| document-media | media-office-ffmpeg-soffice-pipeline | 10.40 | 3.24 | **3.21x** | -68.9% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.97 | 3.56 | **1.95x** | -48.8% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 17.57 | 56.78 | **0.31x** | +223.1% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.47 | 2.65 | **0.93x** | +7.5% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.31x**
- **Total Duration Speedup**: **1.09x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 6.08 | 3.25 | **1.88x** | -46.7% |
| pipelines | pipeline-6-stage-stream | 7.46 | 4.43 | **1.68x** | -40.6% |
| search | search-rg-find-monorepo | 5.17 | 4.96 | **1.04x** | -4.2% |
| text-processing | text-awk-sed-log-analytics | 1.18 | 0.69 | **1.70x** | -41.1% |
| structured-data | structured-jq-yq-pipeline | 2.51 | 1.47 | **1.71x** | -41.6% |
| database | sqlite3-join-aggregation | 1.51 | 0.59 | **2.58x** | -61.2% |
| archives | archive-tar-gzip-sha256-roundtrip | 7.30 | 6.12 | **1.19x** | -16.1% |
| compression | compression-zstd-xz-stream | 16.55 | 12.76 | **1.30x** | -22.9% |
| vfs | vfs-tree-clone-chmod-stat | 4.65 | 7.06 | **0.66x** | +51.9% |
| math-utils | math-awk-bc-numfmt-reduction | 1.59 | 0.93 | **1.72x** | -41.9% |
| chaos | chaos-adversarial-find-xargs0 | 2.18 | 2.61 | **0.83x** | +20.0% |
| lifecycle | shell-cold-start-and-exec | 1.93 | 0.55 | **3.49x** | -71.4% |
| diff-patch | diff-patch-diff3-merge | 6.38 | 4.69 | **1.36x** | -26.5% |
| csv-analytics | csvkit-xan-data-science | 5.26 | 3.52 | **1.50x** | -33.2% |
| web-scraping | htmlq-xmllint-web-scraping | 5.19 | 4.25 | **1.22x** | -18.1% |
| session-state | session-state-json-roundtrip | 2.32 | 1.16 | **2.00x** | -50.1% |
| document-media | document-mermaid-svg-pipeline | 2.00 | 1.36 | **1.46x** | -31.7% |
| agent-workflow | agent-refactor-release-pipeline | 15.04 | 21.42 | **0.70x** | +42.4% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.69 | 2.48 | **1.08x** | -7.7% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.19 | 2.45 | **0.89x** | +11.9% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 34.24 | 35.49 | **0.96x** | +3.7% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.96 | 4.82 | **1.44x** | -30.8% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.24 | 3.01 | **1.08x** | -7.2% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.56 | 3.00 | **1.19x** | -15.9% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 56.78 | 54.58 | **1.04x** | -3.9% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.65 | 2.62 | **1.01x** | -1.4% |
