# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `81dc544aad` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **2.50** | 356.37 | 530.1 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **4.52** | 5017.04 | 509.6 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **2.35** | 518.39 | 811.2 |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.81x**
- **Total Duration Speedup**: **14.08x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.44 | 5.04 | **0.68x** | +46.7% |
| pipelines | pipeline-6-stage-stream | 2.14 | 2.59 | **0.83x** | +21.0% |
| search | search-rg-find-monorepo | 39.64 | 8.25 | **4.80x** | -79.2% |
| text-processing | text-awk-sed-log-analytics | 0.72 | 0.62 | **1.17x** | -14.6% |
| structured-data | structured-jq-yq-pipeline | 0.87 | 0.87 | **1.00x** | +0.3% |
| database | sqlite3-join-aggregation | 0.36 | 0.73 | **0.49x** | +105.3% |
| archives | archive-tar-gzip-sha256-roundtrip | 23.58 | 7.48 | **3.15x** | -68.3% |
| compression | compression-zstd-xz-stream | 15.25 | 11.92 | **1.28x** | -21.8% |
| vfs | vfs-tree-clone-chmod-stat | 59.89 | 4.05 | **14.79x** | -93.2% |
| math-utils | math-awk-bc-numfmt-reduction | 1.36 | 1.19 | **1.14x** | -12.2% |
| chaos | chaos-adversarial-find-xargs0 | 12.43 | 1.51 | **8.25x** | -87.9% |
| lifecycle | shell-cold-start-and-exec | 0.66 | 1.15 | **0.57x** | +74.8% |
| diff-patch | diff-patch-diff3-merge | 13.98 | 3.69 | **3.79x** | -73.6% |
| csv-analytics | csvkit-xan-data-science | 3.88 | 3.89 | **1.00x** | +0.3% |
| web-scraping | htmlq-xmllint-web-scraping | 1.79 | 1.33 | **1.34x** | -25.5% |
| session-state | session-state-json-roundtrip | 1.18 | 1.83 | **0.64x** | +55.6% |
| document-media | document-mermaid-svg-pipeline | 2.30 | 1.10 | **2.08x** | -51.9% |
| agent-workflow | agent-refactor-release-pipeline | 150.37 | 12.07 | **12.45x** | -92.0% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.06x**
- **Total Duration Speedup**: **0.69x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.04 | 3.31 | **1.52x** | -34.3% |
| pipelines | pipeline-6-stage-stream | 2.59 | 1.62 | **1.59x** | -37.2% |
| search | search-rg-find-monorepo | 8.25 | 10.75 | **0.77x** | +30.2% |
| text-processing | text-awk-sed-log-analytics | 0.62 | 0.52 | **1.19x** | -15.7% |
| structured-data | structured-jq-yq-pipeline | 0.87 | 0.65 | **1.33x** | -24.9% |
| database | sqlite3-join-aggregation | 0.73 | 0.35 | **2.11x** | -52.7% |
| archives | archive-tar-gzip-sha256-roundtrip | 7.48 | 8.83 | **0.85x** | +18.0% |
| compression | compression-zstd-xz-stream | 11.92 | 21.84 | **0.55x** | +83.2% |
| vfs | vfs-tree-clone-chmod-stat | 4.05 | 12.96 | **0.31x** | +220.0% |
| math-utils | math-awk-bc-numfmt-reduction | 1.19 | 0.98 | **1.22x** | -18.0% |
| chaos | chaos-adversarial-find-xargs0 | 1.51 | 3.65 | **0.41x** | +142.1% |
| lifecycle | shell-cold-start-and-exec | 1.15 | 0.29 | **4.02x** | -75.1% |
| diff-patch | diff-patch-diff3-merge | 3.69 | 2.61 | **1.41x** | -29.1% |
| csv-analytics | csvkit-xan-data-science | 3.89 | 3.53 | **1.10x** | -9.2% |
| web-scraping | htmlq-xmllint-web-scraping | 1.33 | 0.97 | **1.37x** | -27.2% |
| session-state | session-state-json-roundtrip | 1.83 | 1.13 | **1.63x** | -38.5% |
| document-media | document-mermaid-svg-pipeline | 1.10 | 1.24 | **0.89x** | +12.4% |
| agent-workflow | agent-refactor-release-pipeline | 12.07 | 21.77 | **0.56x** | +80.3% |
