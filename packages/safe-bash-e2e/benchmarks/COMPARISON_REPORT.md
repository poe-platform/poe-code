# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `b6a4a8646f` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **2.60** | 573.16 | 512.1 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **4.37** | 1867.43 | 491.5 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **2.21** | 581.83 | 805.9 |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.68x**
- **Total Duration Speedup**: **3.26x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.52 | 4.51 | **0.78x** | +28.1% |
| pipelines | pipeline-6-stage-stream | 1.74 | 2.55 | **0.68x** | +46.6% |
| search | search-rg-find-monorepo | 37.02 | 7.43 | **4.98x** | -79.9% |
| text-processing | text-awk-sed-log-analytics | 0.68 | 0.71 | **0.96x** | +4.4% |
| structured-data | structured-jq-yq-pipeline | 0.79 | 0.79 | **1.00x** | +0.4% |
| database | sqlite3-join-aggregation | 0.34 | 0.71 | **0.48x** | +107.2% |
| archives | archive-tar-gzip-sha256-roundtrip | 21.14 | 6.44 | **3.28x** | -69.6% |
| compression | compression-zstd-xz-stream | 12.33 | 10.97 | **1.12x** | -11.0% |
| vfs | vfs-tree-clone-chmod-stat | 51.21 | 3.68 | **13.91x** | -92.8% |
| math-utils | math-awk-bc-numfmt-reduction | 0.94 | 1.32 | **0.71x** | +40.3% |
| chaos | chaos-adversarial-find-xargs0 | 6.11 | 1.66 | **3.69x** | -72.9% |
| lifecycle | shell-cold-start-and-exec | 0.69 | 1.25 | **0.55x** | +81.7% |
| diff-patch | diff-patch-diff3-merge | 12.92 | 3.42 | **3.77x** | -73.5% |
| csv-analytics | csvkit-xan-data-science | 4.17 | 3.78 | **1.10x** | -9.4% |
| web-scraping | htmlq-xmllint-web-scraping | 1.67 | 1.18 | **1.41x** | -29.1% |
| session-state | session-state-json-roundtrip | 1.27 | 1.77 | **0.72x** | +39.4% |
| document-media | document-mermaid-svg-pipeline | 2.89 | 1.10 | **2.63x** | -61.9% |
| agent-workflow | agent-refactor-release-pipeline | 117.02 | 11.81 | **9.91x** | -89.9% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 4.00 | 2.25 | **1.78x** | -43.7% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 5.23 | 1.60 | **3.28x** | -69.5% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 75.69 | 37.36 | **2.03x** | -50.6% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 1.33 | 1.64 | **0.81x** | +23.1% |
| document-media | media-office-ffmpeg-soffice-pipeline | 6.20 | 2.85 | **2.18x** | -54.1% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 2.08 | 1.68 | **1.24x** | -19.2% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.18x**
- **Total Duration Speedup**: **0.98x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 4.51 | 3.08 | **1.46x** | -31.6% |
| pipelines | pipeline-6-stage-stream | 2.55 | 1.65 | **1.54x** | -35.3% |
| search | search-rg-find-monorepo | 7.43 | 9.37 | **0.79x** | +26.1% |
| text-processing | text-awk-sed-log-analytics | 0.71 | 0.48 | **1.47x** | -31.7% |
| structured-data | structured-jq-yq-pipeline | 0.79 | 0.64 | **1.23x** | -18.7% |
| database | sqlite3-join-aggregation | 0.71 | 0.29 | **2.47x** | -59.6% |
| archives | archive-tar-gzip-sha256-roundtrip | 6.44 | 5.04 | **1.28x** | -21.7% |
| compression | compression-zstd-xz-stream | 10.97 | 10.24 | **1.07x** | -6.6% |
| vfs | vfs-tree-clone-chmod-stat | 3.68 | 7.03 | **0.52x** | +91.0% |
| math-utils | math-awk-bc-numfmt-reduction | 1.32 | 0.77 | **1.72x** | -41.7% |
| chaos | chaos-adversarial-find-xargs0 | 1.66 | 2.79 | **0.59x** | +68.6% |
| lifecycle | shell-cold-start-and-exec | 1.25 | 0.28 | **4.45x** | -77.5% |
| diff-patch | diff-patch-diff3-merge | 3.42 | 2.58 | **1.33x** | -24.6% |
| csv-analytics | csvkit-xan-data-science | 3.78 | 3.24 | **1.17x** | -14.2% |
| web-scraping | htmlq-xmllint-web-scraping | 1.18 | 0.96 | **1.23x** | -18.8% |
| session-state | session-state-json-roundtrip | 1.77 | 1.03 | **1.72x** | -41.8% |
| document-media | document-mermaid-svg-pipeline | 1.10 | 1.04 | **1.05x** | -5.2% |
| agent-workflow | agent-refactor-release-pipeline | 11.81 | 17.14 | **0.69x** | +45.2% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.25 | 2.11 | **1.06x** | -6.1% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.60 | 1.67 | **0.96x** | +4.5% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 37.36 | 33.93 | **1.10x** | -9.2% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 1.64 | 1.97 | **0.83x** | +20.1% |
| document-media | media-office-ffmpeg-soffice-pipeline | 2.85 | 3.63 | **0.79x** | +27.3% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 1.68 | 1.56 | **1.07x** | -6.7% |
