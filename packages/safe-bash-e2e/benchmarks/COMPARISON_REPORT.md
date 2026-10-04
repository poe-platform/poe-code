# safe-bash E2E Performance Baselines & Optimization Comparisons

Generated from commit `b6a4a8646f` on `darwin/arm64` (Apple M2 Pro, Node `v22.22.2`).

## 1. Summary Across Stored Runs

| Run ID | Profile / Optimization | Backend | Geomean p50 (ms) | Total Suite (ms) | Mean Ops/sec |
| --- | --- | --- | ---: | ---: | ---: |
| `ts-baseline-warm-memory-fastpath` | TypeScript safe-bash (Warm MemoryFileSystem + FastPaths) | `ts-safe-bash` | **2.54** | 477.46 | 514.8 |
| `ts-baseline-overlay-cow-fs` | TypeScript safe-bash (OverlayFileSystem Copy-on-Write) | `ts-safe-bash` | **4.19** | 1819.22 | 553.2 |
| `ts-baseline-strict-budgets-mount-dev` | TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start) | `ts-safe-bash` | **2.10** | 503.82 | 811.3 |

---

# Benchmark Comparison: `TypeScript safe-bash (OverlayFileSystem Copy-on-Write)` vs `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)`

- **Baseline**: `ts-baseline-overlay-cow-fs` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.65x**
- **Total Duration Speedup**: **3.81x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 3.28 | 5.38 | **0.61x** | +64.0% |
| pipelines | pipeline-6-stage-stream | 2.04 | 2.49 | **0.82x** | +22.4% |
| search | search-rg-find-monorepo | 40.96 | 8.20 | **4.99x** | -80.0% |
| text-processing | text-awk-sed-log-analytics | 0.69 | 0.67 | **1.02x** | -2.0% |
| structured-data | structured-jq-yq-pipeline | 0.90 | 0.85 | **1.07x** | -6.3% |
| database | sqlite3-join-aggregation | 0.36 | 0.63 | **0.57x** | +75.3% |
| archives | archive-tar-gzip-sha256-roundtrip | 23.36 | 6.94 | **3.37x** | -70.3% |
| compression | compression-zstd-xz-stream | 12.72 | 10.96 | **1.16x** | -13.8% |
| vfs | vfs-tree-clone-chmod-stat | 56.01 | 5.23 | **10.71x** | -90.7% |
| math-utils | math-awk-bc-numfmt-reduction | 0.87 | 1.24 | **0.70x** | +42.5% |
| chaos | chaos-adversarial-find-xargs0 | 6.99 | 1.91 | **3.66x** | -72.7% |
| lifecycle | shell-cold-start-and-exec | 0.69 | 1.34 | **0.51x** | +95.5% |
| diff-patch | diff-patch-diff3-merge | 13.08 | 3.46 | **3.78x** | -73.5% |
| csv-analytics | csvkit-xan-data-science | 3.71 | 4.16 | **0.89x** | +11.9% |
| web-scraping | htmlq-xmllint-web-scraping | 1.67 | 1.34 | **1.25x** | -19.8% |
| session-state | session-state-json-roundtrip | 1.00 | 1.82 | **0.55x** | +82.8% |
| document-media | document-mermaid-svg-pipeline | 2.30 | 1.11 | **2.06x** | -51.5% |
| agent-workflow | agent-refactor-release-pipeline | 118.94 | 13.76 | **8.64x** | -88.4% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 4.99 | 2.52 | **1.98x** | -49.4% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 5.99 | 1.83 | **3.26x** | -69.4% |

---

# Benchmark Comparison: `TypeScript safe-bash (Warm MemoryFileSystem + FastPaths)` vs `TypeScript safe-bash (Strict Budgets + Mount /dev + Core Cold-Start)`

- **Baseline**: `ts-baseline-warm-memory-fastpath` (`ts-safe-bash`)
- **Candidate**: `ts-baseline-strict-budgets-mount-dev` (`ts-safe-bash`)
- **Geometric Mean Speedup (p50)**: **1.21x**
- **Total Duration Speedup**: **0.95x**

| Category | Scenario | Baseline p50 (ms) | Candidate p50 (ms) | Speedup | Delta (%) |
| --- | --- | ---: | ---: | ---: | ---: |
| shell-grammar | shell-grammar-arithmetic-loops | 5.38 | 3.24 | **1.66x** | -39.7% |
| pipelines | pipeline-6-stage-stream | 2.49 | 1.67 | **1.50x** | -33.1% |
| search | search-rg-find-monorepo | 8.20 | 10.49 | **0.78x** | +27.9% |
| text-processing | text-awk-sed-log-analytics | 0.67 | 0.49 | **1.36x** | -26.6% |
| structured-data | structured-jq-yq-pipeline | 0.85 | 0.70 | **1.21x** | -17.5% |
| database | sqlite3-join-aggregation | 0.63 | 0.35 | **1.79x** | -44.2% |
| archives | archive-tar-gzip-sha256-roundtrip | 6.94 | 5.19 | **1.34x** | -25.2% |
| compression | compression-zstd-xz-stream | 10.96 | 12.09 | **0.91x** | +10.3% |
| vfs | vfs-tree-clone-chmod-stat | 5.23 | 7.88 | **0.66x** | +50.7% |
| math-utils | math-awk-bc-numfmt-reduction | 1.24 | 0.85 | **1.46x** | -31.4% |
| chaos | chaos-adversarial-find-xargs0 | 1.91 | 4.65 | **0.41x** | +143.7% |
| lifecycle | shell-cold-start-and-exec | 1.34 | 0.31 | **4.38x** | -77.2% |
| diff-patch | diff-patch-diff3-merge | 3.46 | 2.62 | **1.32x** | -24.2% |
| csv-analytics | csvkit-xan-data-science | 4.16 | 3.27 | **1.27x** | -21.3% |
| web-scraping | htmlq-xmllint-web-scraping | 1.34 | 0.98 | **1.37x** | -26.9% |
| session-state | session-state-json-roundtrip | 1.82 | 1.01 | **1.81x** | -44.8% |
| document-media | document-mermaid-svg-pipeline | 1.11 | 1.00 | **1.11x** | -10.1% |
| agent-workflow | agent-refactor-release-pipeline | 13.76 | 18.16 | **0.76x** | +32.0% |
| tabular-coreutils | tabular-xan-numfmt-truncate-pipeline | 2.52 | 2.33 | **1.08x** | -7.7% |
| binary-crypto | binary-xxd-dd-od-sha256-pipeline | 1.83 | 1.83 | **1.00x** | -0.3% |
