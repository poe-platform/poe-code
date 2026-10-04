# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `a37b2c1c86` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **2.87** | 291.22 | 503.7 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **4.23** | 841.08 | 592.1 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **2.14** | 271.64 | 872.2 |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.47x**
- **Total Duration Speedup**: **2.89x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 4.35 | 5.08 | **0.86x** | +16.7% |
| pipelines | pipeline-6-stage-stream | 2.52 | 3.77 | **0.67x** | +49.8% |
| search | search-rg-find-monorepo | 45.11 | 10.20 | **4.42x** | -77.4% |
| text-processing | text-awk-sed-log-analytics | 0.78 | 0.73 | **1.07x** | -6.4% |
| structured-data | structured-jq-yq-pipeline | 1.03 | 0.92 | **1.12x** | -11.0% |
| database | sqlite3-join-aggregation | 0.41 | 0.86 | **0.47x** | +113.3% |
| archives | archive-tar-gzip-sha256-roundtrip | 25.80 | 12.54 | **2.06x** | -51.4% |
| compression | compression-zstd-xz-stream | 14.57 | 13.32 | **1.09x** | -8.6% |
| vfs | vfs-tree-clone-chmod-stat | 60.54 | 5.06 | **11.96x** | -91.6% |
| math-utils | math-awk-bc-numfmt-reduction | 1.20 | 1.28 | **0.94x** | +6.5% |
| chaos | chaos-adversarial-find-xargs0 | 8.41 | 2.34 | **3.60x** | -72.2% |
| lifecycle | shell-cold-start-and-exec | 0.88 | 1.10 | **0.80x** | +24.7% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.34x**
- **Total Duration Speedup**: **1.07x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.08 | 3.49 | **1.46x** | -31.3% |
| pipelines | pipeline-6-stage-stream | 3.77 | 1.67 | **2.25x** | -55.7% |
| search | search-rg-find-monorepo | 10.20 | 13.12 | **0.78x** | +28.7% |
| text-processing | text-awk-sed-log-analytics | 0.73 | 0.66 | **1.11x** | -10.1% |
| structured-data | structured-jq-yq-pipeline | 0.92 | 0.69 | **1.32x** | -24.3% |
| database | sqlite3-join-aggregation | 0.86 | 0.38 | **2.27x** | -55.9% |
| archives | archive-tar-gzip-sha256-roundtrip | 12.54 | 6.70 | **1.87x** | -46.6% |
| compression | compression-zstd-xz-stream | 13.32 | 11.30 | **1.18x** | -15.2% |
| vfs | vfs-tree-clone-chmod-stat | 5.06 | 8.97 | **0.56x** | +77.1% |
| math-utils | math-awk-bc-numfmt-reduction | 1.28 | 0.92 | **1.39x** | -28.0% |
| chaos | chaos-adversarial-find-xargs0 | 2.34 | 3.28 | **0.71x** | +40.2% |
| lifecycle | shell-cold-start-and-exec | 1.10 | 0.33 | **3.29x** | -69.6% |
