# `@poe-platform/safe-bash-e2e`

End-to-end integration, chaos, and performance benchmark suite for `@poe-platform/safe-bash` and its upcoming zero-dependency Rust engine (`safe-bash-rs`).

## What This Package Covers

1. **10 End-to-End Integration Suites (200+ Scenarios)**:
   - `shell-grammar-expansion.test.ts` — POSIX & Bash grammar, parameter expansions, indexed/associative arrays, functions, traps, arithmetic, `read`/`mapfile`, background jobs.
   - `pipelines-redirections-streams.test.ts` — Multi-stage pipelines, `PIPESTATUS`, FD duplication, heredocs, `/dev/null` & `/dev/zero`, `tee`, `sponge`, `split`, `paste`, `join`, `comm`, `diff`, `patch`.
   - `search-find-xargs-refactor.test.ts` — `rg`, `grep`, `find`, `fd`, `xargs`, `locate` across realistic multi-package TypeScript + Rust monorepo trees.
   - `text-processing-awk-sed.test.ts` — Complex `awk` and `sed` programs, `tr`, `cut`, `column`, `rev`, `tac`, `nl`, `fold`, `fmt`, `expand`, `unexpand`, `strings`.
   - `structured-data-jq-yq-xml-csv.test.ts` — `jq`, `yq`, `xmllint`, `xpath`, `mlr` (Miller), `csvlook`, `html-to-markdown` cross-format ETL pipelines.
   - `database-sqlite3-analytics.test.ts` — `sqlite3` DDL, joins, window functions, CTEs, triggers, transactions, `.mode csv`/`.mode json`, `.import`, `.dump`.
   - `archives-compression-integrity.test.ts` — `tar`, `zip`/`unzip`, `gzip`, `bzip2`, `xz`, `zstd`, `sha256sum`/`sha512sum`/`sha1sum`/`md5sum`/`cksum`, `xxd`, `od`, `hexdump`, `dd`, `file`, `cmp`, `base64`/`base32`.
   - `vfs-isolation-mounts-overlays.test.ts` — `OverlayFileSystem` copy-on-write, `MountFileSystem`, `ReadOnlyFileSystem`, symlinks, hardlinks, `chmod`, `umask`, `stat`, `du`, `df`, `tree`, `pathchk`, `mktemp`.
   - `math-system-utilities.test.ts` — `bc -l`, `expr`, `factor`, `seq`, `numfmt`, `envsubst`, `iconv`, `dos2unix`/`unix2dos`, `cal`, `date`, `timeout`, `getopt`, `id`, `uname`, `env`.
   - `budgets-cancellation-chaos.test.ts` — `ShellLimits` enforcement, `AbortSignal` cancellation, VFS byte quotas (`ENOSPC`), fork-bomb/expansion-bomb defense, and adversarial filename safety.

2. **Performance Benchmarking & Multi-Run Comparison (`benchmarks/`)**:
   - High-resolution per-exec metrics (`durationMs`, `cpuUserUs`, `cpuSystemUs`, `heapDeltaBytes`, `stdoutBytes`).
   - Multi-iteration scenario benchmarking (`p50`, `p95`, `p99`, `mean`, `stddev`, `opsPerSec`, geometric mean).
   - Stored baselines across optimization profiles (`ts-baseline-warm-memory-fastpath`, `ts-baseline-overlay-cow-fs`, `ts-baseline-strict-budgets-mount-dev`) and side-by-side comparison tables in `benchmarks/COMPARISON_REPORT.md`.

## Commands

```bash
# Run all E2E and benchmark verification tests
npm --workspace=@poe-platform/safe-bash-e2e test

# Run the multi-profile benchmark suite and regenerate benchmarks/COMPARISON_REPORT.md
npm --workspace=@poe-platform/safe-bash-e2e run bench

# Compare any two stored benchmark JSON runs
npm --workspace=@poe-platform/safe-bash-e2e run bench -- --compare benchmarks/ts-baseline-overlay-cow-fs.json benchmarks/ts-baseline-warm-memory-fastpath.json
```
