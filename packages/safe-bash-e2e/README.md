# `@poe-platform/safe-bash-e2e`

End-to-end integration, chaos, and performance benchmark suite for `@poe-platform/safe-bash` and its upcoming zero-dependency Rust engine (`safe-bash-rs`).

## What This Package Covers

1. **32 End-to-End Integration Suites (624 Scenarios)**:
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
   - `benchmark-suite.test.ts` — Verification of the 20 end-to-end benchmark workloads and multi-run comparison report generator.
   - `diff-patch-merge-workflows.test.ts` — `diff`, `diff3`, `patch`, `comm`, `cmp`, and 3-way merge conflict resolution workflows.
   - `csv-data-science-csvkit-mlr.test.ts` — `csvcut`, `csvgrep`, `csvstat`, `csvsort`, `csvjoin`, `csvstack`, `csvsql`, `csvjson`, `in2csv`, `sql2csv`, `xan`, and `mlr`.
   - `html-xml-web-scraping.test.ts` — `htmlq`, `html-to-markdown`, `xmllint`, `xpath`, and `xq` scraping and structured extraction pipelines.
   - `session-state-persistence-snapshots.test.ts` — `ShellSession` state persistence, `snapshotState`/`restoreState`, functions, traps, and cwd/env isolation.
   - `graph-sorting-splitting-formatting.test.ts` — `tsort`, `sort`, `csplit`, `split`, `pr`, `fmt`, `fold`, `column`, `nl`, `paste`, and `join`.
   - `posix-builtins-special-semantics.test.ts` — `eval`, `exec`, `set`, `shopt`, `trap`, `readonly`, `local`, `declare`, `getopts`, `command`, `type`, `hash`, `umask`, `ulimit`, `wait`, and `kill`.
   - `grep-family-regex-engines.test.ts` — `grep`, `egrep`, `fgrep`, `rg`, `ag`, `ack`, `ugrep`, and `zgrep` regex and fixed-string search parity.
   - `document-media-conversion-pipelines.test.ts` — Zero-dep `magick`/`convert`/`identify`, `sips`, `exiftool`, `qpdf`, `pdftk`, `pdfunite`, `pdfseparate`, `pdfinfo`, `pdftotext`, `pdftohtml`, `pdfimages`, `pdftoppm`, `pdftocairo`, `mmdc`, `wkhtmltopdf`, `unrtf`, `docx`, and `xlsx`.
   - `real-world-agent-workflows.test.ts` — Autonomous coding-agent workflows: codebase audit, refactoring, test generation, SQLite telemetry, and release packaging.
   - `unicode-locale-byte-safety.test.ts` — `C.UTF-8` vs `LC_ALL=C` byte/codepoint semantics across parameter expansion, `wc`, `cut`, `rev`, `fold`, `sed`, `awk`, `grep`, `rg`, `iconv`, `printf`, and binary streams.
   - `concurrency-subshells-job-control.test.ts` — Background jobs (`&`, `$!`, `jobs`, `wait`, `kill`, `disown`), subshells `( ... )` vs `{ ...; }`, `<(...)`, `>(...)`, `PIPESTATUS`, `xargs -P`, and `sponge`.
   - `adversarial-parser-quoting-fuzz.test.ts` — 4-level nested `$()`, heredocs in `$()`, multi-FD heredocs, parameter expansion operators, `extglob`, brace expansion, and C-style arithmetic precedence/short-circuit/bases.
   - `ffmpeg-audio-video-media-pipelines.test.ts` — Zero-dep `ffmpeg` & `ffprobe` lavfi video/audio synthesis, filterchains, frame sequences, concat, `vstack`/`hstack`, `.srt`/`.vtt`/`.ass` subtitles, chapters, GIF, WAV/AIFF/AU/CAF, contact sheets, and HLS `.m3u8`.
   - `soffice-office-document-workflows.test.ts` — Zero-dep `soffice`/`libreoffice` TXT/MD/RTF/DOCX/CSV/XLSX/HTML/PNG/PDF conversions, `--cat`, `FilterData`, and `StarCalc` CSV filters.
   - `sqlite3-advanced-sql-window-cte-triggers.test.ts` — Window functions (`ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE`, `LAG`, `LEAD`, `FIRST_VALUE`, `NTH_VALUE`), recursive CTEs, triggers, `ON CONFLICT` upserts, `RETURNING`, savepoints, `ALTER TABLE`, `FILTER (WHERE ...)`, JSON1 (`json_each`, `json_tree`, `json_patch`), and `UNION`/`INTERSECT`/`EXCEPT`.
   - `awk-sed-advanced-programming.test.ts` — Recursive `awk` functions, multi-dimensional arrays, two-file joins, `getline`, paragraph mode, dynamic output redirections, and `sed` hold space (`h`/`H`/`g`/`G`/`x`), multi-line (`N`/`P`/`D`), and branching (`:label`, `b`, `t`).
   - `jq-yq-xq-complex-queries.test.ts` — Custom `jq` `def` functions, `reduce`/`foreach`, `walk()`, paths, `try`/`catch`, `label`/`break`, `@base64`/`@uri`/`@csv`/`@html`, regex builtins, ISO-8601 dates, `yq` multi-doc YAML & TOML pipelines, and `xq` XML extraction.
   - `apply-patch-xan-tabular-workflows.test.ts` — Atomic `apply_patch` multi-file add/update/move/delete envelopes, path traversal & non-atomic filesystem rejection, and high-speed `xan` (`headers`, `count`, `select -e/-f`, `slice -s/-l/-e/-i/-I/-S/-E/-B`).
   - `coreutils-filesystem-printf-formatting.test.ts` — `printf` numeric/float/escape/quoting conversions, `numfmt` SI/IEC/IEC-i scaling & delimited column formatting, `shuf`, `truncate`, `install -d/-D/-m/-C/--backup=numbered`, `cp`, `mv`, `ln -sr`, `touch`, `readlink`, `realpath`, `stat`, `chmod`, `ls`, `du`, and `find -printf`.
   - `binary-inspection-encoding-crypto-streams.test.ts` — `xxd` (`-p`, `-r`, `-i`, `-b`), `od`, `hexdump`/`hd`, `dd` (`conv=ucase,swab,notrunc,block,unblock,ebcdic,ascii`), `base64`/`base32`, `sha256sum`/`sha512sum`/`sha384sum`/`md5sum`/`cksum -c`, `cmp`, `strings`, `file` magic classification, `iconv`, `dos2unix`/`unix2dos`, `tac`/`rev`/`nl`/`expand`/`unexpand`/`fold`, `split`/`csplit`, `fmt`/`column`/`tsort`, `expr`/`bc`/`factor`, and `getopt`/`envsubst`.
   - `shell-traps-jobs-arrays-read-mapfile.test.ts` — `trap` (`EXIT`, `ERR` with `set -E`, `RETURN` with `set -T`, `DEBUG` with `shopt -s extdebug`, `trap -p`), background jobs (`&`, `$!`, `wait`, `kill`), `read`, `mapfile`/`readarray`, indexed & associative arrays, parameter expansions (`${var@Q}`, `${var@E}`), `getopts`, and `select` menus.

2. **Performance Benchmarking & Multi-Run Comparison (`benchmarks/`)**:
   - High-resolution per-exec metrics (`durationMs`, `cpuUserUs`, `cpuSystemUs`, `heapDeltaBytes`, `stdoutBytes`).
   - 20 multi-iteration E2E benchmark workloads (`p50`, `p95`, `p99`, `mean`, `stddev`, `opsPerSec`, geometric mean).
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
