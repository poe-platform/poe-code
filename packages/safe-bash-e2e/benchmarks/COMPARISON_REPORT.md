# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `b6a4a8646f` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **3.26** | 793.19 | 396.8 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **5.18** | 2280.29 | 347.4 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **2.68** | 854.48 | 618.5 |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.59x**
- **Total Duration Speedup**: **2.88x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.73 | 5.70 | **0.66x** | +52.7% |
| pipelines | pipeline-6-stage-stream | 1.77 | 2.79 | **0.63x** | +58.1% |
| search | search-rg-find-monorepo | 42.95 | 10.23 | **4.20x** | -76.2% |
| text-processing | text-awk-sed-log-analytics | 0.86 | 0.77 | **1.12x** | -10.7% |
| structured-data | structured-jq-yq-pipeline | 0.93 | 0.81 | **1.14x** | -12.3% |
| database | sqlite3-join-aggregation | 0.39 | 0.75 | **0.52x** | +91.1% |
| archives | archive-tar-gzip-sha256-roundtrip | 23.36 | 9.80 | **2.38x** | -58.0% |
| compression | compression-zstd-xz-stream | 15.50 | 12.79 | **1.21x** | -17.5% |
| vfs | vfs-tree-clone-chmod-stat | 56.72 | 5.74 | **9.89x** | -89.9% |
| math-utils | math-awk-bc-numfmt-reduction | 1.52 | 1.14 | **1.34x** | -25.4% |
| chaos | chaos-adversarial-find-xargs0 | 7.66 | 2.21 | **3.46x** | -71.1% |
| lifecycle | shell-cold-start-and-exec | 1.01 | 1.33 | **0.76x** | +32.2% |
| diff-patch | diff-patch-diff3-merge | 12.98 | 4.44 | **2.92x** | -65.8% |
| csv-analytics | csvkit-xan-data-science | 3.70 | 4.07 | **0.91x** | +9.9% |
| web-scraping | htmlq-xmllint-web-scraping | 1.60 | 1.26 | **1.27x** | -21.4% |
| session-state | session-state-json-roundtrip | 1.06 | 2.44 | **0.44x** | +129.5% |
| document-media | document-mermaid-svg-pipeline | 2.37 | 1.10 | **2.15x** | -53.5% |
| agent-workflow | agent-refactor-release-pipeline | 121.28 | 17.71 | **6.85x** | -85.4% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 4.14 | 2.71 | **1.53x** | -34.6% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 6.60 | 1.61 | **4.09x** | -75.5% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 104.12 | 44.58 | **2.34x** | -57.2% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 3.70 | 3.19 | **1.16x** | -13.8% |
| document-media | media-office-ffmpeg-soffice-pipeline | 7.59 | 3.30 | **2.30x** | -56.5% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 2.23 | 1.78 | **1.25x** | -20.2% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 11.40 | 7.95 | **1.43x** | -30.3% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 3.66 | 3.87 | **0.94x** | +5.8% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.22x**
- **Total Duration Speedup**: **0.93x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.70 | 3.07 | **1.85x** | -46.0% |
| pipelines | pipeline-6-stage-stream | 2.79 | 1.66 | **1.69x** | -40.6% |
| search | search-rg-find-monorepo | 10.23 | 13.73 | **0.74x** | +34.2% |
| text-processing | text-awk-sed-log-analytics | 0.77 | 0.48 | **1.60x** | -37.6% |
| structured-data | structured-jq-yq-pipeline | 0.81 | 0.62 | **1.31x** | -23.7% |
| database | sqlite3-join-aggregation | 0.75 | 0.30 | **2.48x** | -59.7% |
| archives | archive-tar-gzip-sha256-roundtrip | 9.80 | 5.77 | **1.70x** | -41.1% |
| compression | compression-zstd-xz-stream | 12.79 | 11.94 | **1.07x** | -6.6% |
| vfs | vfs-tree-clone-chmod-stat | 5.74 | 10.21 | **0.56x** | +78.0% |
| math-utils | math-awk-bc-numfmt-reduction | 1.14 | 1.01 | **1.13x** | -11.1% |
| chaos | chaos-adversarial-find-xargs0 | 2.21 | 3.62 | **0.61x** | +63.7% |
| lifecycle | shell-cold-start-and-exec | 1.33 | 0.28 | **4.73x** | -78.9% |
| diff-patch | diff-patch-diff3-merge | 4.44 | 2.58 | **1.72x** | -41.9% |
| csv-analytics | csvkit-xan-data-science | 4.07 | 4.02 | **1.01x** | -1.3% |
| web-scraping | htmlq-xmllint-web-scraping | 1.26 | 1.03 | **1.22x** | -18.2% |
| session-state | session-state-json-roundtrip | 2.44 | 1.00 | **2.45x** | -59.1% |
| document-media | document-mermaid-svg-pipeline | 1.10 | 1.12 | **0.98x** | +2.1% |
| agent-workflow | agent-refactor-release-pipeline | 17.71 | 21.66 | **0.82x** | +22.3% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.71 | 2.32 | **1.17x** | -14.4% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.61 | 1.84 | **0.88x** | +14.1% |
| archives-compression | archive-multi-format-tar-xz-bzip2-zip-pipeline | 44.58 | 49.36 | **0.90x** | +10.7% |
| database-sqlite3 | sqlite3-window-cte-analytics-pipeline | 3.19 | 2.75 | **1.16x** | -13.6% |
| document-media | media-office-ffmpeg-soffice-pipeline | 3.30 | 3.71 | **0.89x** | +12.3% |
| structured-data | polyglot-yq-jq-xmllint-config-compiler | 1.78 | 1.48 | **1.20x** | -16.7% |
| document-media | pdf-imagemagick-wkhtmltopdf-publishing | 7.95 | 7.80 | **1.02x** | -1.8% |
| shell-grammar | shell-builtins-parameter-transforms-arrays | 3.87 | 4.56 | **0.85x** | +17.8% |
