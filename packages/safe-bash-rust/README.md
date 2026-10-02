# safe-bash-rust

Run virtualized, sandboxed shell commands and full `@poe-platform/safe-bash` scripts directly from Rust crates and `poe-agent-rust`.

`safe-bash-rust` provides a native Rust `Shell` and `PoeAgentShellHost` backed by a hybrid execution engine: common shell built-ins and registered Rust commands execute in-process at native speed, while complex bash syntax and full agent toolsets (`awk`, `sed`, `jq`, `rg`, `sort`, `tar`, and pipelines) transparently delegate to `@poe-platform/safe-bash` with automatic bidirectional virtual filesystem (`MemoryVfs` / `git-rust::MemoryFs`) state synchronization.

## Feature Index

| Capability | Description |
| --- | --- |
| `Shell` | Stateful virtual shell (`cwd`, `env`, `SafeBashFs`) with `BackendMode::{Hybrid, NativeOnly, TypeScriptOnly}` |
| `PoeAgentShellHost` | Drop-in `poe-agent-rust` shell host with `read`/`edit` policy checks, 128 KiB UTF-16 tail retention, and background handles (`run_in_background`, `read_background`, `kill_background`) |
| `MemoryVfs` | Shared in-memory filesystem compatible with `git-rust::MemoryFs` so Rust Git and shell commands operate on the same virtual tree |
| `register_command` | Register native Rust closures (`RustCommand`) alongside TypeScript `safe-bash` commands |
| Native Fast-Path Built-ins | `pwd`, `cd`, `echo`, `cat`, `mkdir`, `touch`, `rm`, `export`, `true`, `false`, `&&` chains, and `>` / `>>` redirections |
| TypeScript `safe-bash` Bridge | Full POSIX/Bash loops, arithmetic `$((...))`, parameter expansion, pipelines, and `agentCommands()` plugins |

## Quick Start

### 1. Hybrid Shell with Shared `MemoryVfs`

```rust
use safe_bash_rust::{BackendMode, MemoryVfs, SafeBashFs, Shell, ShellOptions};
use std::sync::Arc;

let vfs = MemoryVfs::new();
vfs.mkdir_all("/workspace").unwrap();

let mut shell = Shell::new(
    Arc::new(vfs.clone()),
    ShellOptions {
        cwd: Some("/workspace".into()),
        mode: BackendMode::Hybrid,
        ..Default::default()
    },
);

// Executes in native Rust fast-path
shell.exec("echo '3\n1\n2' > numbers.txt").unwrap();

// Transparently delegates to TypeScript @poe-platform/safe-bash and syncs VFS
let result = shell
    .exec("for n in $(sort numbers.txt); do echo \"v=$n\" >> sorted.txt; done")
    .unwrap();
assert_eq!(result.exit_code, 0);

let sorted = String::from_utf8(vfs.read_file("/workspace/sorted.txt").unwrap()).unwrap();
assert_eq!(sorted, "v=1\nv=2\nv=3\n");
```

### 2. Using with `poe-agent-rust` (`PoeAgentShellHost`)

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
