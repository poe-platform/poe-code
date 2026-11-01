# safe-bash-rust

Run virtualized shell commands in native Rust or WebAssembly (`wasm32-unknown-unknown`), with a TypeScript bridge on native hosts for document and media tools and `ls` long listings (`-l`, `-g`, `-o`, `-n`). Native-only mode rejects these long listings instead of silently omitting file metadata; ordinary filename listings remain native.

`safe-bash-rust` provides a zero-dependency Rust `Shell`, `PoeAgentShellHost`, and WebAssembly runtime (`createRustWasmBash`) with built-in POSIX/Bash grammar, virtual filesystems (`MemoryVfs`, `OverlayVfs`, `MountVfs`, `RealVfs`), resource budgets (`ShellLimits`), and native implementations of `rg`, `find`, `xargs`, `sed`, `awk`, `jq`, `yq`, `xan`, `csvcut`/`csvgrep`/`csvsort`, `sqlite3`, `tar`, `gzip`/`zstd`/`xz`/`bzip2`/`zip`, `sha256sum`, `xxd`, `od`, and `dd`. Document and media commands, including `pandoc`, use the TypeScript safe-bash bridge in hybrid mode. Native-only and WebAssembly execution report these operations as unsupported instead of emitting incomplete documents or media files.

For trusted Python in native hybrid mode, install Pyodide 314.0.6 and set the host process's `SAFE_BASH_PYODIDE_MODULE_URL` to its `pyodide.mjs` file URL. This registers `python` and `python3` with the existing Python worker adapter, sharing the shell's virtual files, working directory, stdin and environment. No host Python fallback is used. Pyodide JavaScript interoperability is not a security sandbox. Package provisioning is separate from the standard-library runtime.

## Feature Index

| Capability | Description |
| --- | --- |
| `Shell` | Stateful virtual shell (`cwd`, `env`, `SafeBashFs`) using native Rust by default; select `BackendMode::Hybrid` or `TypeScriptOnly` explicitly for the Node bridge |
| `createRustWasmBash` | Node.js loader for the zero-dependency WebAssembly (`wasm32-unknown-unknown`) shell |
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

If you supply a custom `SafeBashFs`, implement `create_file` to let `cp` create a destination. It must create the file with the requested mode and return `EEXIST` if the name is already occupied, including by a dangling symlink. To support `ln` and `cp -l`, implement `supports_hard_links` and `hard_link`. A hard link shares the source inode, including when the source is a symlink. In a filesystem snapshot, entries with the same `link_group` share an inode; file payloads use `Arc<[u8]>` so a snapshot stores those bytes once.

Custom filesystems can support `touch` and timestamp-preserving copies by implementing `set_times(path, atime_ms, mtime_ms)`. Each time is an `Option<f64>` in milliseconds since the Unix epoch; leave the corresponding time unchanged for `None`.

### 2. WebAssembly Shell from JavaScript / TypeScript

The JavaScript entry point requires Node.js to load the packaged WebAssembly binary. Use `await bash.fs.open(path, { access: "readwrite" })` for positioned I/O on memory files. Use `await bash.fs.link(existingPath, newPath)` to give a file or symlink a second name. The descriptor stays attached to the opened file after renames and unlinks; call `await descriptor.close()` to release it. Use `await bash.fs.readdir(path, { maxEntries })` for sorted `{ name, type }` entries; exceeding the limit raises `EFBIG`. The synchronous `bash.readdir(path)` returns names.

Use `await bash.fs.utimes(path, atimeMs, mtimeMs)` to set access and modification times, including fractional milliseconds and dates before 1970. Read both values with `await bash.fs.stat(path)`.

By default the shell exposes a virtual `/dev/null` alongside files you supply under `/dev`. Use `deviceView: "provided"` to keep your own `/dev/null`, or call `bash.mountDevices()` to mount the device filesystem over `/dev`.

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
