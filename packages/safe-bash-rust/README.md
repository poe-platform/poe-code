# safe-bash-rust

Run virtualized, sandboxed shell commands and full `@poe-platform/safe-bash` scripts with zero external dependencies in native Rust or WebAssembly (`wasm32-unknown-unknown`).

`safe-bash-rust` provides a zero-dependency Rust `Shell`, `PoeAgentShellHost`, and WebAssembly runtime (`createRustWasmBash`) with built-in POSIX/Bash grammar, virtual filesystems (`MemoryVfs`, `OverlayVfs`, `MountVfs`, `RealVfs`), resource budgets (`ShellLimits`), and native implementations of `rg`, `find`, `xargs`, `sed`, `awk`, `jq`, `yq`, `xan`, `csvcut`/`csvgrep`/`csvsort`, `sqlite3`, `tar`, `gzip`/`zstd`/`xz`/`bzip2`/`zip`, `sha256sum`, `xxd`, `od`, `dd`, and document/media utilities.

## Feature Index

| Capability | Description |
| --- | --- |
| `Shell` | Stateful virtual shell (`cwd`, `env`, `SafeBashFs`) with `BackendMode::{Hybrid, NativeOnly, TypeScriptOnly}` |
| `createRustWasmBash` | Zero-dependency WebAssembly (`wasm32-unknown-unknown`) shell for Node.js, Edge, and Browser runtimes |
| `MemoryVfs` / `OverlayVfs` / `MountVfs` | In-memory VFS with quota limits, Copy-on-Write overlays, and path-routed virtual mounts (`/dev`) |
| `ShellLimits` | Bounded loop iterations, command count, recursion depth, output bytes, and filesystem operations |
| `PoeAgentShellHost` | Drop-in `poe-agent-rust` shell host with `read`/`edit` policy checks, 128 KiB UTF-16 tail retention, and background handles (`run_in_background`, `read_background`, `kill_background`) |
| Zero-Dep Command Suite | `rg`, `grep`, `find`, `fd`, `xargs`, `sed`, `awk`, `diff`, `diff3`, `patch`, `apply_patch`, `jq`, `yq`, `xan`, `sqlite3`, `tar`, `gzip`, `zstd`, `xz`, `bzip2`, `zip`, `unzip`, `sha256sum`, `xxd`, `od`, `dd`, and POSIX coreutils |

## Quick Start

### 1. Zero-Dependency Rust Shell with `MemoryVfs`

```rust
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

let vfs = MemoryVfs::new();
vfs.mkdir_all("/workspace").unwrap();

let mut shell = Shell::new(
    Arc::new(vfs.clone()),
    ShellOptions {
        cwd: Some("/workspace".into()),
        mode: BackendMode::NativeOnly,
        ..Default::default()
    },
);

shell.exec("echo '3\n1\n2' > numbers.txt").unwrap();

let result = shell
    .exec("for n in $(sort numbers.txt); do echo \"v=$n\" >> sorted.txt; done")
    .unwrap();
assert_eq!(result.exit_code, 0);

let sorted = String::from_utf8(vfs.read_file("/workspace/sorted.txt").unwrap()).unwrap();
assert_eq!(sorted, "v=1\nv=2\nv=3\n");
```

### 2. WebAssembly Shell from JavaScript / TypeScript

```ts
import { createRustWasmBash } from "@poe-code/safe-bash-rust";

const bash = createRustWasmBash({
  cwd: "/workspace",
  files: {
    "/workspace/events.jsonl": '{"service":"api","latency_ms":12}\n{"service":"api","latency_ms":48}\n',
  },
});

const res = await bash.exec("jq -s 'map(.latency_ms) | max' /workspace/events.jsonl");
console.log(res.stdout); // "48\n"
bash.dispose();
```

### 3. Using with `poe-agent-rust` (`PoeAgentShellHost`)

```rust
use safe_bash_rust::{
    AgentRunCommandRequest, MemoryVfs, PoeAgentShellHost, PoeAgentShellOptions, SafeBashFs,
    ShellMode,
};
use std::sync::Arc;

let vfs = MemoryVfs::new();
vfs.mkdir_all("/workspace").unwrap();
vfs.write_file("/workspace/README.md", b"# Project\n").unwrap();

let mut host = PoeAgentShellHost::new(
    Arc::new(vfs),
    PoeAgentShellOptions {
        cwd: Some("/workspace".into()),
        allowed_paths: vec!["/workspace".into()],
        ..Default::default()
    },
);

let output = host
    .run_command(AgentRunCommandRequest {
        command: "cat README.md".into(),
        mode: Some(ShellMode::Edit),
        ..Default::default()
    })
    .unwrap();
assert_eq!(output, "# Project");
```
