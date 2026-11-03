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

Native Rust callers can pass `ExecOptions { fs: Some(filesystem), ..Default::default() }` to read and write a different `SafeBashFs` for one call. Subsequent calls use the shell’s original filesystem. `shell.exec_with_stream(script, chunks)` takes an iterator of `Result<Vec<u8>, String>`. Commands pull stdin on demand and duplicated descriptors share unread bytes. Streamed calls use the native backend, including in hybrid mode, so an unknown command returns status 127 without replaying the script. TypeScript-only mode rejects streamed calls.

In WebAssembly, pass a shell’s own `fs` to `exec` to use its Wasm filesystem. Selecting another filesystem for a call requires a `companionFactory`; without one, `exec` rejects the call before running the script.

`sort` uses byte order in the C and POSIX locales. For other locales the Wasm loader uses `Intl.Collator`, and native Linux, macOS and Windows builds load the system ICU library on demand. An unavailable locale or collation service gives exit status 2 before any input or destination is opened. Language availability and ordering can differ between ICU versions. Shell `[[ < ]]` and `[[ > ]]` use the same locale service for UTF-8 locales, with the locale’s default case order. Custom Wasm hosts must provide the `safe_bash.collator_open(tagPtr, tagLen, lowerFirst)`, `collator_compare` and `collator_close` imports alongside the clock and entropy imports.

In UTF-8 locales, `fold` measures display columns with fixed Unicode width tables. They use the same zero-width marks and wide-character ranges as the JavaScript command, independent of the host locale library. See [the Unicode data license](./LICENSE.UNICODE).

Native `tac -r` searches byte patterns from the end of each input. It reports `EFBIG` when a pattern exceeds 64 KiB or 64 nested groups, or when compilation or matching exceeds its work or memory budgets. JavaScript can accept larger patterns.

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

If you supply a custom `SafeBashFs`, implement `create_file` to let `touch`, `cp`, and `xmllint -o` create files. It must create the file with the requested mode and return `EEXIST` if the name is already occupied, including by a dangling symlink. To support `ln` and `cp -l`, implement `supports_hard_links` and `hard_link`. A hard link shares the source inode, including when the source is a symlink. In a filesystem snapshot, entries with the same `link_group` share an inode; file payloads use `Arc<[u8]>` so a snapshot stores those bytes once.

Custom filesystems can update timestamps for `touch` and timestamp-preserving copies by implementing `set_times(path, atime_ms, mtime_ms)`. Each time is an `Option<f64>` in milliseconds since the Unix epoch; leave the corresponding time unchanged for `None`. Implement `append_file` if the backend supports atomic append or writing without read permission. The default reads the existing file and stops if that read fails for any reason other than `ENOENT`.

Implement `open_chunks` if a custom filesystem can stream input. Each call to the returned reader replaces its buffer with the next chunk, or clears it at EOF. The default reads the whole file. For external sorting, implement `scratch_file(directory)` to return a private, unnamed file with positioned reads and writes. Its storage must stay available until the last handle is dropped. When a sort needs to spill and the filesystem does not support scratch files, it fails. The memory filesystem charges scratch bytes against its normal quotas.

### 2. WebAssembly Shell from JavaScript / TypeScript

The JavaScript entry point requires Node.js to load the packaged WebAssembly binary. Use `await bash.fs.open(path, { access: "readwrite" })` for positioned I/O on memory files. Use `await bash.fs.link(existingPath, newPath)` to give a file or symlink a second name. The descriptor stays attached to the opened file after renames and unlinks; call `await descriptor.close()` to release it. Use `await bash.fs.readdir(path, { maxEntries })` for sorted `{ name, type }` entries; exceeding the limit raises `EFBIG`. The synchronous `bash.readdir(path)` returns names.

Use `await bash.fs.openReadFile(path)` for positioned reads from regular Wasm files. The handle follows the opened file across renames and unlinks; close it when finished. Pass `{ allowDirectory: true }` to read directory metadata. Directory handles reject byte reads with `EISDIR`. Production JavaScript commands such as `cat` can read these files through this interface. Use `await bash.fs.appendFile(path, bytes)` to append bytes or create a file. Production shell redirections (`>` and `>>`) and `tee` can write to this filesystem.

Use `await bash.fs.access(path, mode)` to check existence (0), read (4), write (2), or execute/search permission (1). Combine permission bits to require all of them. Pass an abort signal to `bash.fs.chmod(path, mode, { signal })` to cancel a mode change. The Wasm filesystem rejects conditional chmod receipts because it cannot yet verify file revisions.

Use `await bash.fs.symlink(target, path)` to create a symbolic link in an existing directory. `await bash.fs.readlink(path)` returns the stored target even if it does not exist. Both methods accept `{ signal }` and report filesystem errors such as `ENOENT` for a missing parent.

Use `await bash.fs.utimes(path, atimeMs, mtimeMs)` to set access and modification times, including fractional milliseconds and dates before 1970. Read both values with `await bash.fs.stat(path)`. Memory files also expose `birthtimeMs` (creation) and `ctimeMs` (last change to the inode). Appending changes modification and status times while preserving access time.

Inode numbers are local to each filesystem. When comparing two entries with `stat`, compare `identityScope`, `dev`, and `ino` together. Metadata such as `nlink`, `uid`, `gid`, and `allocatedBytes` may be absent when the backing filesystem does not report it.

By default the shell exposes a virtual `/dev/null` alongside files you supply under `/dev`. Use `deviceView: "provided"` to keep your own `/dev/null`, or call `bash.mountDevices()` to mount the device filesystem over `/dev`.

To checkpoint a session, save `JSON.stringify(session.state)` after an execution. Pass the parsed snapshot to `bash.createSession(snapshot)` or assign it to `session.state` to restore the shell bindings. Files stay on the filesystem; restoring bindings never repeats file writes. The older Rust-only `rawHistory` format is rejected because it contains commands rather than state.

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
