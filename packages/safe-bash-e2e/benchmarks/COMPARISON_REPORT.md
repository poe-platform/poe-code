# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `ec7d1ab7e5` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **4.53** | 1144.72 | 299.7 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **7.76** | 2721.71 | 258.8 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **4.62** | 1315.10 | 357.3 |
| `rust-wasm-warm-memory-fastpath` | Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath) | `rust-safe-bash` | **0.24** | 66.83 | 5491.3 |
| `rust-wasm-overlay-cow-fs` | Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write) | `rust-safe-bash` | **0.24** | 75.50 | 6704.9 |
| `rust-wasm-strict-budgets-mount-dev` | Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev) | `rust-safe-bash` | **0.32** | 130.23 | 4459.3 |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `Rust Zero-Dep Wasm safe-bash (MemoryVfs FastPath)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-warm-memory-fastpath` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **18.76x**
- **Total Duration Speedup**: **17.13x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 6.50 | 0.74 | **8.81x** | -88.7% |
| pipelines | pipeline-6-stage-stream | 7.39 | 2.68 | **2.76x** | -63.7% |
| search | search-rg-find-monorepo | 4.41 | 1.03 | **4.29x** | -76.7% |
| text-processing | text-awk-sed-log-analytics | 1.19 | 0.44 | **2.68x** | -62.7% |
| structured-data | structured-jq-yq-pipeline | 4.05 | 0.18 | **21.88x** | -95.4% |
| database | sqlite3-join-aggregation | 1.40 | 0.08 | **16.64x** | -94.0% |
| archives | archive-tar-gzip-sha256-roundtrip | 8.03 | 0.46 | **17.64x** | -94.3% |
| compression | compression-zstd-xz-stream | 15.32 | 0.09 | **164.76x** | -99.4% |
| vfs | vfs-tree-clone-chmod-stat | 4.18 | 0.35 | **11.84x** | -91.6% |
| math-utils | math-awk-bc-numfmt-reduction | 1.25 | 0.95 | **1.31x** | -23.8% |
| chaos | chaos-adversarial-find-xargs0 | 1.69 | 0.12 | **14.23x** | -93.0% |
| lifecycle | shell-cold-start-and-exec | 1.66 | 0.08 | **21.58x** | -95.4% |
| diff-patch | diff-patch-diff3-merge | 5.90 | 0.23 | **25.98x** | -96.2% |
| csv-analytics | csvkit-xan-data-science | 4.56 | 0.12 | **38.31x** | -97.4% |
| web-scraping | htmlq-xmllint-web-scraping | 5.45 | 0.07 | **74.59x** | -98.7% |
| session-state | session-state-json-roundtrip | 1.90 | 0.11 | **17.74x** | -94.4% |
| document-media | document-mermaid-svg-pipeline | 1.79 | 0.05 | **36.63x** | -97.3% |
| agent-workflow | agent-refactor-release-pipeline | 14.59 | 2.94 | **4.97x** | -79.9% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.54 | 0.12 | **20.49x** | -95.1% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.55 | 0.10 | **24.79x** | -96.0% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 37.14 | 0.49 | **75.34x** | -98.7% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 8.26 | 0.10 | **84.23x** | -98.8% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.87 | 0.17 | **23.42x** | -95.7% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 4.65 | 0.47 | **9.96x** | -90.0% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 65.90 | 0.23 | **285.27x** | -99.6% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.60 | 0.15 | **17.54x** | -94.3% |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `Rust Zero-Dep Wasm safe-bash (OverlayVfs Copy-on-Write)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-overlay-cow-fs` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **32.35x**
- **Total Duration Speedup**: **36.05x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.98 | 0.85 | **4.71x** | -78.8% |
| pipelines | pipeline-6-stage-stream | 7.04 | 4.21 | **1.67x** | -40.2% |
| search | search-rg-find-monorepo | 28.71 | 2.56 | **11.21x** | -91.1% |
| text-processing | text-awk-sed-log-analytics | 1.13 | 0.41 | **2.75x** | -63.6% |
| structured-data | structured-jq-yq-pipeline | 2.40 | 0.15 | **15.48x** | -93.5% |
| database | sqlite3-join-aggregation | 0.81 | 0.07 | **11.37x** | -91.2% |
| archives | archive-tar-gzip-sha256-roundtrip | 32.70 | 0.38 | **85.16x** | -98.8% |
| compression | compression-zstd-xz-stream | 13.82 | 0.08 | **168.54x** | -99.4% |
| vfs | vfs-tree-clone-chmod-stat | 57.54 | 0.53 | **109.19x** | -99.1% |
| math-utils | math-awk-bc-numfmt-reduction | 1.20 | 0.90 | **1.33x** | -24.8% |
| chaos | chaos-adversarial-find-xargs0 | 9.36 | 0.13 | **70.89x** | -98.6% |
| lifecycle | shell-cold-start-and-exec | 0.96 | 0.08 | **12.52x** | -92.0% |
| diff-patch | diff-patch-diff3-merge | 24.66 | 0.16 | **154.15x** | -99.4% |
| csv-analytics | csvkit-xan-data-science | 5.08 | 0.10 | **48.33x** | -97.9% |
| web-scraping | htmlq-xmllint-web-scraping | 6.99 | 0.07 | **97.04x** | -99.0% |
| session-state | session-state-json-roundtrip | 1.13 | 0.09 | **12.05x** | -91.7% |
| document-media | document-mermaid-svg-pipeline | 4.78 | 0.05 | **95.62x** | -99.0% |
| agent-workflow | agent-refactor-release-pipeline | 130.36 | 2.20 | **59.15x** | -98.3% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 9.10 | 0.16 | **58.33x** | -98.3% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 15.61 | 0.10 | **154.57x** | -99.4% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 90.74 | 0.68 | **133.84x** | -99.3% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 8.64 | 0.09 | **93.97x** | -98.9% |
| document-media | media-office-ffmpeg-soffice-pipeline | 9.83 | 0.15 | **65.09x** | -98.5% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.79 | 0.20 | **34.49x** | -97.1% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 20.15 | 0.23 | **87.23x** | -98.9% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.94 | 0.14 | **20.85x** | -95.2% |

---

# Benchmark Comparison: `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)` vs `Rust Zero-Dep Wasm safe-bash (Strict Budgets + Mount /dev)`

- **Baseline**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Candidate**: `rust-wasm-strict-budgets-mount-dev` (`rust-safe-bash`)
- **Geometric Mean Speedup (p50)**: **14.33x**
- **Total Duration Speedup**: **10.10x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.73 | 2.13 | **1.75x** | -42.9% |
| pipelines | pipeline-6-stage-stream | 6.06 | 8.58 | **0.71x** | +41.5% |
| search | search-rg-find-monorepo | 6.70 | 1.26 | **5.30x** | -81.1% |
| text-processing | text-awk-sed-log-analytics | 0.83 | 0.49 | **1.70x** | -41.3% |
| structured-data | structured-jq-yq-pipeline | 1.78 | 0.36 | **4.97x** | -79.9% |
| database | sqlite3-join-aggregation | 0.75 | 0.14 | **5.17x** | -80.6% |
| archives | archive-tar-gzip-sha256-roundtrip | 7.77 | 0.30 | **25.64x** | -96.1% |
| compression | compression-zstd-xz-stream | 13.99 | 0.07 | **189.11x** | -99.5% |
| vfs | vfs-tree-clone-chmod-stat | 8.22 | 0.41 | **19.81x** | -95.0% |
| math-utils | math-awk-bc-numfmt-reduction | 0.86 | 2.10 | **0.41x** | +142.7% |
| chaos | chaos-adversarial-find-xargs0 | 3.00 | 0.14 | **20.81x** | -95.2% |
| lifecycle | shell-cold-start-and-exec | 0.62 | 0.22 | **2.86x** | -65.0% |
| diff-patch | diff-patch-diff3-merge | 4.25 | 0.15 | **28.31x** | -96.5% |
| csv-analytics | csvkit-xan-data-science | 3.84 | 0.10 | **39.59x** | -97.5% |
| web-scraping | htmlq-xmllint-web-scraping | 4.97 | 0.10 | **49.75x** | -98.0% |
| session-state | session-state-json-roundtrip | 1.36 | 0.10 | **14.33x** | -93.0% |
| document-media | document-mermaid-svg-pipeline | 1.96 | 0.05 | **42.65x** | -97.7% |
| agent-workflow | agent-refactor-release-pipeline | 45.42 | 2.86 | **15.86x** | -93.7% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 6.86 | 0.27 | **25.69x** | -96.1% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 7.54 | 0.12 | **64.41x** | -98.4% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 42.95 | 0.53 | **81.04x** | -98.8% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 6.02 | 0.22 | **27.88x** | -96.4% |
| document-media | media-office-ffmpeg-soffice-pipeline | 4.43 | 0.33 | **13.64x** | -92.7% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 5.51 | 0.22 | **24.59x** | -95.9% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 67.51 | 0.26 | **255.74x** | -99.6% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 3.58 | 0.36 | **9.84x** | -89.8% |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.71x**
- **Total Duration Speedup**: **2.38x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.98 | 6.50 | **0.61x** | +63.3% |
| pipelines | pipeline-6-stage-stream | 7.04 | 7.39 | **0.95x** | +5.0% |
| search | search-rg-find-monorepo | 28.71 | 4.41 | **6.50x** | -84.6% |
| text-processing | text-awk-sed-log-analytics | 1.13 | 1.19 | **0.95x** | +5.2% |
| structured-data | structured-jq-yq-pipeline | 2.40 | 4.05 | **0.59x** | +68.7% |
| database | sqlite3-join-aggregation | 0.81 | 1.40 | **0.58x** | +73.2% |
| archives | archive-tar-gzip-sha256-roundtrip | 32.70 | 8.03 | **4.08x** | -75.5% |
| compression | compression-zstd-xz-stream | 13.82 | 15.32 | **0.90x** | +10.9% |
| vfs | vfs-tree-clone-chmod-stat | 57.54 | 4.18 | **13.77x** | -92.7% |
| math-utils | math-awk-bc-numfmt-reduction | 1.20 | 1.25 | **0.96x** | +3.8% |
| chaos | chaos-adversarial-find-xargs0 | 9.36 | 1.69 | **5.52x** | -81.9% |
| lifecycle | shell-cold-start-and-exec | 0.96 | 1.66 | **0.58x** | +72.4% |
| diff-patch | diff-patch-diff3-merge | 24.66 | 5.90 | **4.18x** | -76.1% |
| csv-analytics | csvkit-xan-data-science | 5.08 | 4.56 | **1.11x** | -10.2% |
| web-scraping | htmlq-xmllint-web-scraping | 6.99 | 5.45 | **1.28x** | -22.1% |
| session-state | session-state-json-roundtrip | 1.13 | 1.90 | **0.60x** | +67.5% |
| document-media | document-mermaid-svg-pipeline | 4.78 | 1.79 | **2.66x** | -62.5% |
| agent-workflow | agent-refactor-release-pipeline | 130.36 | 14.59 | **8.93x** | -88.8% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 9.10 | 2.54 | **3.58x** | -72.1% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 15.61 | 2.55 | **6.12x** | -83.6% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 90.74 | 37.14 | **2.44x** | -59.1% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 8.64 | 8.26 | **1.05x** | -4.5% |
| document-media | media-office-ffmpeg-soffice-pipeline | 9.83 | 3.87 | **2.54x** | -60.7% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 6.79 | 4.65 | **1.46x** | -31.5% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 20.15 | 65.90 | **0.31x** | +227.0% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.94 | 2.60 | **1.13x** | -11.7% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **0.98x**
- **Total Duration Speedup**: **0.87x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 6.50 | 3.73 | **1.75x** | -42.7% |
| pipelines | pipeline-6-stage-stream | 7.39 | 6.06 | **1.22x** | -18.0% |
| search | search-rg-find-monorepo | 4.41 | 6.70 | **0.66x** | +51.7% |
| text-processing | text-awk-sed-log-analytics | 1.19 | 0.83 | **1.42x** | -29.8% |
| structured-data | structured-jq-yq-pipeline | 4.05 | 1.78 | **2.27x** | -56.0% |
| database | sqlite3-join-aggregation | 1.40 | 0.75 | **1.87x** | -46.4% |
| archives | archive-tar-gzip-sha256-roundtrip | 8.03 | 7.77 | **1.03x** | -3.2% |
| compression | compression-zstd-xz-stream | 15.32 | 13.99 | **1.09x** | -8.7% |
| vfs | vfs-tree-clone-chmod-stat | 4.18 | 8.22 | **0.51x** | +96.7% |
| math-utils | math-awk-bc-numfmt-reduction | 1.25 | 0.86 | **1.44x** | -30.6% |
| chaos | chaos-adversarial-find-xargs0 | 1.69 | 3.00 | **0.56x** | +76.9% |
| lifecycle | shell-cold-start-and-exec | 1.66 | 0.62 | **2.68x** | -62.7% |
| diff-patch | diff-patch-diff3-merge | 5.90 | 4.25 | **1.39x** | -28.0% |
| csv-analytics | csvkit-xan-data-science | 4.56 | 3.84 | **1.19x** | -15.8% |
| web-scraping | htmlq-xmllint-web-scraping | 5.45 | 4.97 | **1.09x** | -8.6% |
| session-state | session-state-json-roundtrip | 1.90 | 1.36 | **1.40x** | -28.3% |
| document-media | document-mermaid-svg-pipeline | 1.79 | 1.96 | **0.92x** | +9.3% |
| agent-workflow | agent-refactor-release-pipeline | 14.59 | 45.42 | **0.32x** | +211.3% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.54 | 6.86 | **0.37x** | +169.9% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 2.55 | 7.54 | **0.34x** | +195.2% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 37.14 | 42.95 | **0.86x** | +15.6% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 8.26 | 6.02 | **1.37x** | -27.1% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.87 | 4.43 | **0.87x** | +14.7% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 4.65 | 5.51 | **0.84x** | +18.4% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 65.90 | 67.51 | **0.98x** | +2.5% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 2.60 | 3.58 | **0.72x** | +38.0% |
