# Zero-Dependency Rust Rewrite Plan for `safe-bash` and `safe-fs`

## Objective

Migrate `safe-bash` and `safe-fs` to a **100% self-contained, zero-dependency Rust implementation** that serves both native Rust consumers (such as the Poe Rust agent) and JavaScript/TypeScript consumers (Node.js, browsers, Cloudflare Workers) from a single source of truth.

## Non-Negotiable Constraints

1. **Zero Cargo runtime dependencies (`std`-only)**:
   - `[dependencies]` in published/runtime `Cargo.toml` manifests must remain empty (using only Rust `core`, `alloc`, `std`, and internal workspace crates).
   - No `tokio`, `serde`, `regex`, or third-party proc-macro dependency trees. This keeps supply-chain risk at zero and incremental compile times in the 1–3 second range.
2. **Zero external runtime dependencies for Rust consumers**:
   - Linking `safe-bash-rust` produces a single static binary with **no Node.js runtime**, no V8 worker subprocess, and no dependency on host `/bin/bash` or system coreutils.
3. **Zero npm runtime dependencies for JS consumers (`"dependencies": {}`)**:
   - Because the Rust implementation uses only `std`/`alloc` with no OS/C library dependencies, the same codebase compiles directly to `wasm32-unknown-unknown` via stock `rustc`.
   - `@poe-code/safe-bash` wraps the `.wasm` artifact with a thin, zero-dependency TypeScript loader using standard `WebAssembly.instantiate`, preserving `"dependencies": {}` and universal portability across Node, Bun, Deno, browsers, and Cloudflare Workers.
4. **Deterministic resource & sandbox enforcement**:
   - Enforce input/output byte caps, file count/size limits, directory traversal bounds, recursion/loop tick budgets, cooperative cancellation, and hard memory ceilings in one place at the VFS, stream, and allocator/Wasm-memory layers.

---

## Target Architecture

### 1. Rust Workspace Layout

```text
packages/safe-bash-rust/
  Cargo.toml
  src/
    lib.rs              # Public Rust API (Bash, BashBuilder, ExecOptions, ExecResult)
    vfs/                # Zero-dep safe-fs port
      mod.rs            # VirtualFileSystem trait, FileStat, OpenOptions, FsError
      memory.rs         # In-memory VFS with deterministic byte/inode accounting
      real.rs           # Sandboxed host filesystem adapter with root/symlink guards
      overlay.rs        # Copy-on-write overlay VFS combining lower + upper mounts
      mount.rs          # Prefix mount table (/dev/null, /dev/zero, custom schemes)
      path.rs           # Lexical + symlink-aware path normalization
    budget/             # Unified resource accounting & cancellation
      mod.rs            # ExecutionBudget, CancellationToken, bounded Read/Write streams
      alloc.rs          # Optional counting allocator / per-invocation heap guard
    shell/              # POSIX / Bash shell interpreter
      lexer.rs          # Byte-preserving shell tokenizer
      parser.rs         # Recursive-descent AST parser (pipelines, lists, compounds, redirects)
      expand.rs         # Parameter, command substitution, arithmetic, and glob expansion
      eval.rs           # AST evaluator, subshells, functions, traps, variables, builtins
      builtins.rs       # cd, pwd, echo, printf, test, [, [[, read, set, export, local, trap, getopts
    commands/           # Built-in zero-dep command implementations
      mod.rs            # Command trait, CommandContext, CommandRegistry
      coreutils/        # cat, head, tail, wc, sort, uniq, cut, tr, nl, tac, od, fmt, column, split, csplit, shuf, dd, install, sponge, env, timeout, expr, seq, basename, dirname, tee, yes, true, false
      fs/               # ls, cp, mv, rm, mkdir, rmdir, touch, ln, chmod, stat, readlink, realpath, du, df, mktemp
      search/           # rg, grep, find, fd, xargs
      text/             # sed, awk, diff, patch, apply-patch
      structured/       # jq, csvcut, csvgrep, csvstat, xan
      archive/          # tar, zip, unzip, gzip, gunzip
    wasm/               # wasm32-unknown-unknown ABI exports for JS consumers
    fallback/           # Optional transitional bridge for unported JS commands (feature-gated)
```

### 2. Core Rust Traits

- **`VirtualFileSystem`**:
  - Byte-oriented path and content operations (`read_file`, `write_file`, `stat`, `lstat`, `readdir`, `mkdir`, `remove`, `rename`, `symlink`, `readlink`, `chmod`) plus streaming reader/writer handles (`open_read`, `open_write`).
  - Every mutation and read checks the attached `FsBudget` before allocating or writing.
- **`Command` & `CommandContext`**:
  - `fn execute(&self, ctx: &mut CommandContext) -> Result<u8, CommandError>`
  - `CommandContext` provides byte-exact `args: &[Vec<u8>]`, `env`, `cwd`, `vfs: &dyn VirtualFileSystem`, bounded `stdin: &mut dyn Read`, bounded `stdout: &mut dyn Write`, bounded `stderr: &mut dyn Write`, `budget: &ExecutionBudget`, and re-entrant `invoke` for subcommand dispatch (`xargs`, `find -exec`, `timeout`, `env`).
- **Pipelines & Streams**:
  - Multi-stage pipelines connect commands through bounded in-memory ring buffers (or spill-to-VFS buffers when configured) with automatic backpressure and `SIGPIPE` / broken-pipe propagation.

### 3. Dual-Target Consumption Model

- **Native Rust Consumers (Poe Rust Agent)**:
  - Depend on `safe-bash-rust` directly via Cargo.
  - Zero serialization, zero IPC, ~50–200 µs shell invocation overhead, and zero external processes.
- **JavaScript / TypeScript Consumers (`@poe-code/safe-bash`)**:
  - Compile the Rust crate to `wasm32-unknown-unknown`.
  - Expose linear-memory ring buffers and host filesystem callbacks across a minimal C-ABI export table.
  - Enforce hard VM memory limits automatically via `new WebAssembly.Memory({ initial, maximum })`.

---

## Phased Migration Roadmap

### Phase 1: Zero-Dep Rust VFS, Shell Core & Daily-Driver Commands
- Port `safe-fs` (`MemoryFileSystem`, `RealFileSystem`, `OverlayFileSystem`, `/dev/null`, `/dev/zero`, path normalization, and byte/inode budgets) into `packages/safe-bash-rust/src/vfs` using only Rust `std`.
- Implement the shell lexer, parser, expander (variables, `$()`, `$(( ))`, globs, quoting, arrays), redirections, pipelines, control structures (`if`, `for`, `while`, `until`, `case`, functions, `trap`), and POSIX/Bash builtins.
- Implement the high-frequency agent commands in zero-dep Rust:
  - **Filesystem & traversal**: `ls`, `cp`, `mv`, `rm`, `mkdir`, `rmdir`, `touch`, `ln`, `chmod`, `stat`, `readlink`, `realpath`, `mktemp`, `find`, `xargs`
  - **Search & text**: `cat`, `head`, `tail`, `wc`, `sort`, `uniq`, `cut`, `tr`, `nl`, `tac`, `tee`, `sed`, `awk`, `rg`, `grep`, `diff`, `patch`, `apply-patch`
  - **Structured & archives**: `jq`, `tar`, `zip`, `unzip`, `gzip`
- Make the pure-Rust engine the default backend in `safe-bash-rust` (moving the legacy Node worker bridge behind an optional `js-fallback` Cargo feature for unported commands).
- **Outcome**: The Poe Rust agent runs 95%+ of real-world coding workflows with **zero Node.js dependency** and pure-Rust performance.

### Phase 2: Zero-Dep WebAssembly Target for JS Consumers
- Add a `wasm32-unknown-unknown` target entrypoint in `packages/safe-bash-rust/src/wasm`.
- Build a thin, dependency-free TypeScript host wrapper (`"dependencies": {}`) that instantiates the `.wasm` module, wires custom JS `FileSystem` / `VirtualShellPlugin` callbacks when provided, and exposes the `@poe-code/safe-bash` API (`Bash`, `VirtualShell`).
- Verify portability in Node.js, browser, and Cloudflare Worker (`workerd`) test suites.

### Phase 3: Port Long-Tail Commands & Engines from Existing TS Algorithms
- Port the remaining self-contained TypeScript command/engine implementations into zero-dep Rust workspace modules:
  - Text/formatting utilities (`fmt`, `column`, `csplit`, `split`, `shuf`, `od`, `pr`, `dd`, `iconv`, `dos2unix`, `bc`, `html-to-markdown`)
  - Structured data & tabular tools (`csvcut`, `csvgrep`, `csvstat`, `xan`, `sqlite3`)
  - Document & media engines (`ssconvert`, SVG/image tools)
- As each command passes its existing `packages/safe-bash/tests/commands/<cmd>` parity and budget suite against the Rust implementation, retire the corresponding TypeScript `packages/safe-bash-command-<cmd>` workspace.

### Phase 4: Retire Transitional Bridges & Consolidate
- Remove the `js-fallback` Node worker bridge from `packages/safe-bash-rust`.
- Switch `@poe-code/safe-bash` completely to the Wasm-backed Rust engine and remove the legacy TypeScript shell/command workspaces.

---

## Verification & Quality Gates

1. **Zero-Dep Enforcement**:
   - CI check verifying `cargo tree --edges normal` lists **only** workspace crates (no external crates.io dependencies) and `package.json` `dependencies` remains `{}`.
2. **Parity Against Existing Test Suites**:
   - Run the existing shell grammar, expansion, pipeline, redirection, VFS, and per-command test suites against the Rust engine.
3. **Chaos & Resource Budget Scrutiny**:
   - Fuzz parser inputs, deep recursion, fork-bomb function loops, infinite streams (`/dev/zero | ...`), zip/tar bombs, symlink cycles, path traversal attempts, and concurrent cancellation to verify deterministic bounded termination.

### 4. `safe-bash-e2e` Parity & Performance Benchmark Suite
- Maintain a dedicated workspace `packages/safe-bash-e2e` (100 E2E test suites / 2,008 scenarios) with an in-memory VFS fixture builder, multi-stage shell/pipeline scenario runner, and high-resolution performance profiler.
- Record structured benchmark results across runs, backends (TypeScript `safe-bash`, hybrid `safe-bash-rust`, native zero-dep Rust, and Wasm), and optimization passes (tracking p50/p95/mean latency, ops/sec, throughput MB/s, and heap delta) so regressions and speedups are measurable at every step.
