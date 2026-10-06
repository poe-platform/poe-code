# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `ff78f654ea` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **4.09** | 1002.87 | 331.3 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **6.72** | 2193.69 | 296.4 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **3.37** | 963.54 | 490.4 |
| `rust-wasm-warm-memory-fastpath` | Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath) | `rust-safe-bash` | **0.11** | 35.93 | 15832.1 |
| `rust-wasm-overlay-cow-fs` | Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write) | `rust-safe-bash` | **0.11** | 35.17 | 16279.2 |
| `rust-wasm-strict-budgets-mount-dev` | Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev) | `rust-safe-bash` | **0.11** | 32.33 | 15783.6 |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-warm-memory-fastpath` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **35.81x**
- **Total Duration Speedup**: **27.91x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.59 | 0.22 | **25.87x** | -96.1% |
| pipelines | pipeline-6-stage-stream | 6.14 | 2.39 | **2.57x** | -61.0% |
| search | search-rg-find-monorepo | 3.93 | 0.59 | **6.62x** | -84.9% |
| text-processing | text-awk-sed-log-analytics | 1.03 | 0.26 | **3.95x** | -74.7% |
| structured-data | structured-jq-yq-pipeline | 2.08 | 0.12 | **16.92x** | -94.1% |
| database | sqlite3-join-aggregation | 1.26 | 0.02 | **78.56x** | -98.7% |
| archives | archive-tar-gzip-sha256-roundtrip | 7.33 | 0.19 | **38.80x** | -97.4% |
| compression | compression-zstd-xz-stream | 14.72 | 0.07 | **216.46x** | -99.5% |
| vfs | vfs-tree-clone-chmod-stat | 3.72 | 0.26 | **14.31x** | -93.0% |
| math-utils | math-awk-bc-numfmt-reduction | 1.19 | 0.74 | **1.60x** | -37.4% |
| chaos | chaos-adversarial-find-xargs0 | 1.82 | 0.06 | **28.91x** | -96.5% |
| lifecycle | shell-cold-start-and-exec | 1.69 | 0.01 | **129.77x** | -99.2% |
| diff-patch | diff-patch-diff3-merge | 6.03 | 0.09 | **70.06x** | -98.6% |
| csv-analytics | csvkit-xan-data-science | 4.75 | 0.07 | **64.15x** | -98.4% |
| web-scraping | htmlq-xmllint-web-scraping | 5.35 | 0.03 | **178.20x** | -99.4% |
| session-state | session-state-json-roundtrip | 1.79 | 0.05 | **35.20x** | -97.2% |
| document-media | document-mermaid-svg-pipeline | 1.76 | 0.03 | **70.56x** | -98.6% |
| agent-workflow | agent-refactor-release-pipeline | 14.70 | 0.96 | **15.32x** | -93.5% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.55 | 0.07 | **37.47x** | -97.3% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.40 | 0.06 | **43.67x** | -97.7% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 35.13 | 0.34 | **103.32x** | -99.0% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.63 | 0.06 | **116.25x** | -99.1% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.14 | 0.08 | **37.81x** | -97.4% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.51 | 0.12 | **29.23x** | -96.6% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 54.97 | 0.09 | **597.52x** | -99.8% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.52 | 0.07 | **38.75x** | -97.4% |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-overlay-cow-fs` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **59.73x**
- **Total Duration Speedup**: **62.38x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.70 | 0.16 | **22.57x** | -95.6% |
| pipelines | pipeline-6-stage-stream | 4.87 | 2.16 | **2.25x** | -55.6% |
| search | search-rg-find-monorepo | 26.45 | 0.56 | **46.90x** | -97.9% |
| text-processing | text-awk-sed-log-analytics | 1.09 | 0.23 | **4.64x** | -78.5% |
| structured-data | structured-jq-yq-pipeline | 2.24 | 0.10 | **22.14x** | -95.5% |
| database | sqlite3-join-aggregation | 0.79 | 0.02 | **49.44x** | -98.0% |
| archives | archive-tar-gzip-sha256-roundtrip | 30.70 | 0.23 | **134.66x** | -99.3% |
| compression | compression-zstd-xz-stream | 13.18 | 0.05 | **248.72x** | -99.6% |
| vfs | vfs-tree-clone-chmod-stat | 50.49 | 0.39 | **130.46x** | -99.2% |
| math-utils | math-awk-bc-numfmt-reduction | 0.84 | 0.76 | **1.11x** | -10.0% |
| chaos | chaos-adversarial-find-xargs0 | 8.73 | 0.07 | **122.99x** | -99.2% |
| lifecycle | shell-cold-start-and-exec | 0.94 | 0.01 | **72.00x** | -98.6% |
| diff-patch | diff-patch-diff3-merge | 21.65 | 0.09 | **248.88x** | -99.6% |
| csv-analytics | csvkit-xan-data-science | 4.01 | 0.07 | **61.68x** | -98.4% |
| web-scraping | htmlq-xmllint-web-scraping | 6.04 | 0.03 | **201.20x** | -99.5% |
| session-state | session-state-json-roundtrip | 1.09 | 0.04 | **25.26x** | -96.0% |
| document-media | document-mermaid-svg-pipeline | 4.00 | 0.02 | **166.88x** | -99.4% |
| agent-workflow | agent-refactor-release-pipeline | 116.93 | 1.09 | **107.67x** | -99.1% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 8.24 | 0.07 | **114.51x** | -99.1% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 13.26 | 0.06 | **232.63x** | -99.6% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 74.59 | 0.41 | **179.74x** | -99.4% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 5.86 | 0.06 | **101.09x** | -99.0% |
| document-media | media-office-ffmpeg-soffice-pipeline | 8.94 | 0.08 | **110.41x** | -99.1% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.15 | 0.11 | **54.90x** | -98.2% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 15.92 | 0.09 | **180.96x** | -99.4% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.23 | 0.06 | **39.07x** | -97.4% |

---

# Benchmark Comparison: `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)` vs `Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev)`

- **Baseline**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-strict-budgets-mount-dev` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **31.16x**
- **Total Duration Speedup**: **29.80x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.55 | 0.15 | **23.52x** | -95.7% |
| pipelines | pipeline-6-stage-stream | 4.36 | 2.14 | **2.04x** | -51.0% |
| search | search-rg-find-monorepo | 4.62 | 0.47 | **9.74x** | -89.7% |
| text-processing | text-awk-sed-log-analytics | 0.70 | 0.24 | **2.97x** | -66.3% |
| structured-data | structured-jq-yq-pipeline | 1.60 | 0.10 | **16.03x** | -93.8% |
| database | sqlite3-join-aggregation | 0.59 | 0.01 | **39.53x** | -97.5% |
| archives | archive-tar-gzip-sha256-roundtrip | 5.51 | 0.17 | **33.40x** | -97.0% |
| compression | compression-zstd-xz-stream | 12.04 | 0.05 | **236.14x** | -99.6% |
| vfs | vfs-tree-clone-chmod-stat | 7.04 | 0.25 | **27.92x** | -96.4% |
| math-utils | math-awk-bc-numfmt-reduction | 0.78 | 0.73 | **1.06x** | -6.0% |
| chaos | chaos-adversarial-find-xargs0 | 2.51 | 0.07 | **38.62x** | -97.4% |
| lifecycle | shell-cold-start-and-exec | 0.54 | 0.01 | **36.27x** | -97.2% |
| diff-patch | diff-patch-diff3-merge | 3.98 | 0.08 | **47.34x** | -97.9% |
| csv-analytics | csvkit-xan-data-science | 3.41 | 0.07 | **50.90x** | -98.0% |
| web-scraping | htmlq-xmllint-web-scraping | 4.27 | 0.04 | **115.51x** | -99.1% |
| session-state | session-state-json-roundtrip | 1.13 | 0.05 | **21.79x** | -95.4% |
| document-media | document-mermaid-svg-pipeline | 1.37 | 0.03 | **44.29x** | -97.7% |
| agent-workflow | agent-refactor-release-pipeline | 19.40 | 0.96 | **20.29x** | -95.1% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.38 | 0.07 | **35.49x** | -97.2% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.11 | 0.06 | **38.36x** | -97.4% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 36.09 | 0.33 | **108.07x** | -99.1% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 5.35 | 0.06 | **92.26x** | -98.9% |
| document-media | media-office-ffmpeg-soffice-pipeline | 2.98 | 0.08 | **37.67x** | -97.3% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.08 | 0.10 | **29.29x** | -96.6% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 56.48 | 0.09 | **664.41x** | -99.8% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.48 | 0.06 | **43.56x** | -97.7% |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.64x**
- **Total Duration Speedup**: **2.19x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.70 | 5.59 | **0.66x** | +50.9% |
| pipelines | pipeline-6-stage-stream | 4.87 | 6.14 | **0.79x** | +26.0% |
| search | search-rg-find-monorepo | 26.45 | 3.93 | **6.73x** | -85.1% |
| text-processing | text-awk-sed-log-analytics | 1.09 | 1.03 | **1.06x** | -5.5% |
| structured-data | structured-jq-yq-pipeline | 2.24 | 2.08 | **1.07x** | -6.9% |
| database | sqlite3-join-aggregation | 0.79 | 1.26 | **0.63x** | +58.9% |
| archives | archive-tar-gzip-sha256-roundtrip | 30.70 | 7.33 | **4.19x** | -76.1% |
| compression | compression-zstd-xz-stream | 13.18 | 14.72 | **0.90x** | +11.7% |
| vfs | vfs-tree-clone-chmod-stat | 50.49 | 3.72 | **13.57x** | -92.6% |
| math-utils | math-awk-bc-numfmt-reduction | 0.84 | 1.19 | **0.71x** | +41.3% |
| chaos | chaos-adversarial-find-xargs0 | 8.73 | 1.82 | **4.79x** | -79.1% |
| lifecycle | shell-cold-start-and-exec | 0.94 | 1.69 | **0.56x** | +80.2% |
| diff-patch | diff-patch-diff3-merge | 21.65 | 6.03 | **3.59x** | -72.2% |
| csv-analytics | csvkit-xan-data-science | 4.01 | 4.75 | **0.84x** | +18.4% |
| web-scraping | htmlq-xmllint-web-scraping | 6.04 | 5.35 | **1.13x** | -11.4% |
| session-state | session-state-json-roundtrip | 1.09 | 1.79 | **0.60x** | +65.3% |
| document-media | document-mermaid-svg-pipeline | 4.00 | 1.76 | **2.27x** | -56.0% |
| agent-workflow | agent-refactor-release-pipeline | 116.93 | 14.70 | **7.95x** | -87.4% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 8.24 | 2.55 | **3.24x** | -69.1% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 13.26 | 2.40 | **5.52x** | -81.9% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 74.59 | 35.13 | **2.12x** | -52.9% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 5.86 | 6.63 | **0.89x** | +13.0% |
| document-media | media-office-ffmpeg-soffice-pipeline | 8.94 | 3.14 | **2.85x** | -64.9% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.15 | 3.51 | **1.75x** | -43.0% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 15.92 | 54.97 | **0.29x** | +245.2% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.23 | 2.52 | **0.88x** | +13.1% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.22x**
- **Total Duration Speedup**: **1.04x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.59 | 3.55 | **1.57x** | -36.4% |
| pipelines | pipeline-6-stage-stream | 6.14 | 4.36 | **1.41x** | -29.0% |
| search | search-rg-find-monorepo | 3.93 | 4.62 | **0.85x** | +17.5% |
| text-processing | text-awk-sed-log-analytics | 1.03 | 0.70 | **1.47x** | -31.8% |
| structured-data | structured-jq-yq-pipeline | 2.08 | 1.60 | **1.30x** | -23.0% |
| database | sqlite3-join-aggregation | 1.26 | 0.59 | **2.12x** | -52.8% |
| archives | archive-tar-gzip-sha256-roundtrip | 7.33 | 5.51 | **1.33x** | -24.9% |
| compression | compression-zstd-xz-stream | 14.72 | 12.04 | **1.22x** | -18.2% |
| vfs | vfs-tree-clone-chmod-stat | 3.72 | 7.04 | **0.53x** | +89.1% |
| math-utils | math-awk-bc-numfmt-reduction | 1.19 | 0.78 | **1.53x** | -34.5% |
| chaos | chaos-adversarial-find-xargs0 | 1.82 | 2.51 | **0.72x** | +37.8% |
| lifecycle | shell-cold-start-and-exec | 1.69 | 0.54 | **3.10x** | -67.8% |
| diff-patch | diff-patch-diff3-merge | 6.03 | 3.98 | **1.51x** | -34.0% |
| csv-analytics | csvkit-xan-data-science | 4.75 | 3.41 | **1.39x** | -28.2% |
| web-scraping | htmlq-xmllint-web-scraping | 5.35 | 4.27 | **1.25x** | -20.1% |
| session-state | session-state-json-roundtrip | 1.79 | 1.13 | **1.58x** | -36.9% |
| document-media | document-mermaid-svg-pipeline | 1.76 | 1.37 | **1.28x** | -22.2% |
| agent-workflow | agent-refactor-release-pipeline | 14.70 | 19.40 | **0.76x** | +31.9% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.55 | 2.38 | **1.07x** | -6.7% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.40 | 2.11 | **1.14x** | -12.2% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 35.13 | 36.09 | **0.97x** | +2.7% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.63 | 5.35 | **1.24x** | -19.2% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.14 | 2.98 | **1.05x** | -5.2% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 3.51 | 3.08 | **1.14x** | -12.3% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 54.97 | 56.48 | **0.97x** | +2.7% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.52 | 2.48 | **1.01x** | -1.4% |
