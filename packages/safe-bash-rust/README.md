# safe-bash-rust

Run virtualized shell commands in native Rust or WebAssembly (`wasm32-unknown-unknown`), with a TypeScript bridge on native hosts for document and media tools and `ls` long listings (`-l`, `-g`, `-o`, `-n`). Native-only mode rejects these long listings instead of silently omitting file metadata; ordinary filename listings remain native.

`safe-bash-rust` provides a zero-dependency Rust `Shell`, `PoeAgentShellHost`, and WebAssembly runtime (`createRustWasmBash`) with built-in POSIX/Bash grammar, virtual filesystems (`MemoryVfs`, `OverlayVfs`, `MountVfs`, `RealVfs`), resource budgets (`ShellLimits`), and native implementations of `rg`, `find`, `xargs`, `sed`, `awk`, `jq`, `yq`, `xan`, `csvcut`/`csvgrep`/`csvsort`, `sqlite3`, `tar`, `gzip`/`zstd`/`xz`/`bzip2`/`zip`, `sha256sum`, `xxd`, `od`, and `dd`. Document and media commands, including `pandoc`, use the TypeScript safe-bash bridge in hybrid mode. Native-only and WebAssembly execution report these operations as unsupported instead of emitting incomplete documents or media files.

For trusted Python in native hybrid mode, install Pyodide 314.0.6 and set the host process's `SAFE_BASH_PYODIDE_MODULE_URL` to its `pyodide.mjs` file URL. This registers `python` and `python3` with the existing Python worker adapter, sharing the shell's virtual files, working directory, stdin and environment. No host Python fallback is used. Pyodide JavaScript interoperability is not a security sandbox. Package provisioning is separate from the standard-library runtime.

## Feature Index

| Capability | Description |
| --- | --- |
| `Shell` | Stateful virtual shell (`cwd`, `env`, `SafeBashFs`) using native Rust by default; select `BackendMode::Hybrid` or `TypeScriptOnly` explicitly for the Node bridge |
| `createRustWasmBash` | Node.js, browser and Cloudflare Workers loader for the zero-dependency WebAssembly (`wasm32-unknown-unknown`) shell |
| `MemoryVfs` / `OverlayVfs` / `MountVfs` | In-memory VFS with quota limits, Copy-on-Write overlays, and path-routed virtual mounts (`/dev`) |
| `ShellLimits` | Bounded loop iterations, command count, recursion depth, output bytes, and filesystem operations |
| `PoeAgentShellHost` | Drop-in `poe-agent-rust` shell host with `read`/`edit` policy checks, 128 KiB UTF-16 tail retention, and background handles (`run_in_background`, `read_background`, `kill_background`) |
| Zero-Dep Command Suite | `rg`, `grep`, `find`, `fd`, `xargs`, `sed`, `awk`, `diff`, `diff3`, `patch`, `apply_patch`, `jq`, `yq`, `xan`, `sqlite3`, `tar`, `gzip`, `zstd`, `xz`, `bzip2`, `zip`, `unzip`, `sha256sum`, `xxd`, `od`, `dd`, and POSIX coreutils |

Inside a registered Rust command, `ctx.invoke(name, args, options, &mut stdin)` runs literal arguments in a child with the current filesystem and execution budget. It returns the exit status and both output streams; changes to the child’s variables and working directory stay in the child.

Native Rust callers can pass `ExecOptions { fs: Some(filesystem), ..Default::default() }` to read and write a different `SafeBashFs` for one call. Subsequent calls use the shell’s original filesystem. `shell.exec_with_stream(script, chunks)` takes an iterator of `Result<Vec<u8>, String>`. Commands pull stdin on demand and duplicated descriptors share unread bytes. Streamed calls use the native backend, including in hybrid mode, so an unknown command returns status 127 without replaying the script. TypeScript-only mode rejects streamed calls.

The standalone Node loader supports stream commands installed with `bash.register(command)` or `bash.use(plugin)`. Install the optional `safe-bash-contracts` peer and use `await bash.exec(...)` on a Node runtime with WebAssembly Promise Integration (JSPI). Register middleware with `bash.use(async (ctx, next) => { ... })` or `host.use` during plugin setup. Return or await `next()` to run the command in the current shell, or return an exit code object to skip it. Plugin setup can also register commands and filesystem factories. Use `host.provideCapabilities(defaults)` to supply capabilities to handlers; options passed to `exec` take precedence. Execution waits for setup. Handlers receive byte streams, arguments, cwd, exported variables, cancellation and invocation capabilities. Use `onInternalError` on the shell or an individual execution to receive private plugin errors while keeping them out of stderr. Use `ctx.stdinIsDefault` to distinguish the default input from a supplied stream, pipe, or file, even when it contains no bytes. While a handler is running, `ctx.fs` supports `open`, `readFile`, `readStream`, `openReadFile`, `writeFile`, `appendFile`, `stat`, `lstat`, `readdir`, `mkdir`, `rm`, `access`, `chmod`, `readlink`, `realpath`, `rename`, `symlink` and `unlink`. Handlers can also use `copyFile` on the built-in filesystem or on an external filesystem with `deviceView: "provided"`. When the shell overlays its own devices on an external filesystem, `copyFile` returns `ENOTSUP`. Plugins can check `ctx.fs.capabilities` for shared features or `await ctx.fs.capabilitiesFor(path)` before changing permissions or creating private output. On memory filesystems, use `writeFileConditional` and `removeFileConditional` with parent and destination stats to reject stale changes. Use `createStagedFile` for private output, then `publishStagedFile` to replace the destination only if it still matches the observed stat. Request `retainCleanup: true` to append chunks through the staged writer and clean up the original stage even if its parent is renamed. A memory-file stream pins the bytes on its first pull. Set `start`, `endExclusive`, and `chunkSize` to read a range without loading the entire file. Open descriptors and retained readers stay on the opened file if its path is replaced and close when the handler finishes. Memory and mounted filesystems support writable descriptors; overlays support retained readers. These calls share the script’s filesystem operation and pathname limits. New files and directories use the shell umask unless the handler provides a mode. Use `ctx.registerCleanup(callback)` to release resources when the command ends. The shell waits for the callbacks before running the next command. Use `ctx.invoke(name, args, options)` to call a command with literal arguments, inherited or replacement environment, cwd and byte streams. The child shares the script’s limits. Explicit input and child output are buffered; output sinks receive the child’s bytes after it finishes. Admitted process handles, process signal endpoints and shell redirection descriptors are not yet available. The registry lists custom commands only. Await `bash.dispose()` to run plugin cleanup.

Wasm hosts can register a command with `safe_bash_register_command(session, namePtr, nameLen, callbackSlot)`. Pass a UTF-8 name and a function in the exported indirect table; a return value of 0 means the registration succeeded. The session and subsequent forks can invoke it by name or by its virtual executable path.

The callback receives `(packetPtr, packetLen, replyPtr)` and returns an exit status from 0 to 255. The packet starts with three little-endian 32-bit words: argument count, exported environment count, and whether an explicit `argv0` follows. Next come the working directory, optional `argv0`, arguments, and environment key/value pairs. Each field is a 32-bit byte length followed by that many bytes. The rest of the packet is stdin. Use the packet only during the call. To return stdout or stderr, write a pointer and byte length for each stream at `replyPtr` (stdout first); both pairs start at zero. Write the number of stdin bytes consumed to the fifth word (offset 16, initially zero). The next command sharing that descriptor receives the remaining bytes. The sixth word (offset 20) contains the remaining output budget in bytes. If the seventh word (offset 24) is 1, stdout and stderr share a destination: append both to the stdout buffer in write order. Offsets 28 and 32 contain the remaining filesystem operations and maximum path components. Write the number of filesystem operations admitted to offset 36 (initially zero); Rust charges them to the current execution. Offset 40 contains the file creation mode after applying the current shell umask. Offset 52 is 1 if stdin is the default source. At offset 56, bits 0, 1 and 2 indicate whether stdin can be read, stdout can be written, and stderr can be written, respectively. Offset 60 contains the directory creation mode after applying the umask. A host can return −5 for an exceeded filesystem operation budget, −2 for cancellation, −3 for an exceeded output budget, or −4 for an internal handler failure. An internal failure preserves earlier output and reports the shell source line without exposing the handler exception. For a public diagnostic, transfer its UTF-8 pointer and length at offsets 44 and 48 and return −6. Transfer each nonempty stream in its own buffer from `safe_bash_alloc(length)`. Rust frees those buffers and applies the shell's output limits and redirections.

A host command can return −7 to run a child before finishing. Transfer a request at offsets 44/48, leave stdout, stderr and consumed stdin empty, and report any filesystem operations since the previous callback. The request starts with three little-endian u32 words: flags, argument count and environment pair count. Length-prefixed byte fields follow: command, optional cwd (flag 1), optional argv0 (2), arguments, environment pairs and stdin. Flags 4, 8, 16 and 32 select a replacement environment, external command lookup, default stdin and a shared stdout/stderr destination respectively. Rust runs the child with the caller’s budget and calls the host again with the same command packet. Offset 72 (i32) is −1 on the initial call, the child exit status on success, or −2 on failure. The borrowed response at offsets 64/68 contains a u32 unread stdin count followed by length-prefixed stdout and stderr, or a UTF-8 error on failure. Copy it before returning or suspending. Offsets 76/80 on a −7 reply reserve previously uncharged stdout/stderr bytes; on a final reply they identify returned bytes already charged by a reservation or a child. Offset 84 contains the maximum input byte count. Return −9 if supplied child input exceeds it. On each child or final reply, set offset 88 to the cumulative bytes reserved for file output by this host command. Include outstanding writes; if a counted write accepts fewer bytes than reserved, subtract the unused bytes. File output shares the script’s output limit with stdout and stderr. Finish with an ordinary host reply.

On a host with JSPI, passing an abort signal to `exec` makes `sleep` wait at the command itself. Aborting keeps earlier filesystem writes and skips the commands that follow. A surrounding `timeout` shortens the wait. `execSync` continues to advance the virtual clock without a wall-clock wait.

Custom Wasm hosts can call `safe_bash_exec_stream(session, scriptPtr, scriptLen, callbackSlot)`. Install the callback in a new slot of the exported `__indirect_function_table`. Rust calls it with `(session, dataPtrOut, lengthOut)`. Return 0 for EOF, 1 for a chunk, -1 for a UTF-8 error message, or -2 to cancel the execution. Cancellation stops the script and preserves earlier filesystem writes. For a nonempty chunk or error, transfer a buffer from `safe_bash_alloc(length)` by writing its pointer and length to the two output addresses. Rust frees the buffer. A chunk of length zero does not end the stream. On hosts with WebAssembly Promise Integration (JSPI), the JavaScript loader pulls async stdin as Rust commands read it and closes the iterator when they finish. On hosts without JSPI it still collects async stdin before execution.

Pass a filesystem to `exec(script, { fs })` to use it for that call only. On Node with WebAssembly Promise Integration, the standalone Rust shell calls the supplied filesystem directly for file contents, metadata, directory entries, and links. Concurrent calls may use different filesystems. Redirects keep using the opened file across renames when the host supports positioned descriptors. Renderers can publish output conditionally on filesystems that provide atomic writes or publication. A destination replaced during rendering is left alone. A configured companion continues to handle external filesystem calls.

`sort` uses byte order in the C and POSIX locales. For other locales the Wasm loader uses `Intl.Collator`, and native Linux, macOS and Windows builds load the system ICU library on demand. An unavailable locale or collation service gives exit status 2 before any input or destination is opened. Language availability and ordering can differ between ICU versions. Shell `[[ < ]]` and `[[ > ]]` use the same locale service for UTF-8 locales, with the locale’s default case order. Custom Wasm hosts must provide the `safe_bash.collator_open(tagPtr, tagLen, lowerFirst)`, `collator_compare` and `collator_close` imports alongside the clock and entropy imports. AWK’s `strftime` and `mktime` use the shell’s `TZ`. For named zones the Wasm loader uses `Intl.DateTimeFormat`; native builds read system ICU time zone data. Custom Wasm hosts must also provide `safe_bash.timezone_fields(namePtr, nameLen, epochSeconds, offsetPtr, labelPtr, capacity)`. It writes a signed 32-bit offset in seconds east of UTC and a UTF-8 short label, returning the label length in bytes or −1 on failure.

In UTF-8 locales, `fold` measures display columns with fixed Unicode width tables. They use the same zero-width marks and wide-character ranges as the JavaScript command, independent of the host locale library. See [the Unicode data license](./LICENSE.UNICODE).

Native `tac -r` searches byte patterns from the end of each input. It reports `EFBIG` when a pattern exceeds 64 KiB or 64 nested groups, or when compilation or matching exceeds its work or memory budgets. JavaScript can accept larger patterns.

In browsers, use `const shell = await createRustWasmBash(options)`. Serve `safe_bash_rust.wasm` beside the bundled JavaScript with the `application/wasm` content type. Each shell has its own memory; concurrent shells share the compiled module.

In Cloudflare Workers, import `createRustWasmBash` from the package and configure your bundler to include `safe_bash_rust.wasm` and `stream-adapter.wasm` as compiled Wasm modules. The Worker entry requires no Node.js compatibility flag. Dispose each shell after use: Workers keep filesystem identity tokens until the owning shell is disposed.

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

For `sed -i`, the filesystem must support retained reads and guarded file replacement. For `sed -i.bak`, implement `replace_file_with_backup` to move the original inode to the backup name in the same commit that installs the edited file. The native memory filesystem supports this; unsupported providers return an error without replacing either file.

Custom filesystems can update timestamps for `touch` and timestamp-preserving copies by implementing `set_times(path, atime_ms, mtime_ms)`. Each time is an `Option<f64>` in milliseconds since the Unix epoch; leave the corresponding time unchanged for `None`. Implement `append_file` if the backend supports atomic append or writing without read permission. The default reads the existing file and stops if that read fails for any reason other than `ENOENT`.

Implement `open_chunks` if a custom filesystem can stream input. Each call to the returned reader replaces its buffer with the next chunk, or clears it at EOF. The default reads the whole file. For external sorting, implement `scratch_file(directory)` to return a private, unnamed file with positioned reads and writes. Its storage must stay available until the last handle is dropped. When a sort needs to spill and the filesystem does not support scratch files, it fails. The memory filesystem charges scratch bytes against its normal quotas.

### 2. WebAssembly Shell from JavaScript / TypeScript

The JavaScript entry point requires Node.js to load the packaged WebAssembly binary. Use `await bash.fs.open(path, { access: "readwrite" })` for positioned I/O on memory files. Use `await bash.fs.link(existingPath, newPath)` to give a file or symlink a second name. The descriptor stays attached to the opened file after renames and unlinks; call `await descriptor.close()` to release it. Use `await bash.fs.readdir(path, { maxEntries })` for sorted `{ name, type }` entries; exceeding the limit raises `EFBIG`. The synchronous `bash.readdir(path)` returns names.

Use `await bash.fs.openReadFile(path)` for positioned reads from regular Wasm files. The handle follows the opened file across renames and unlinks; close it when finished. Pass `{ allowDirectory: true }` to read directory metadata. Directory handles reject byte reads with `EISDIR`. Production JavaScript commands such as `cat` can read these files through this interface. Use `await bash.fs.appendFile(path, bytes)` to append bytes or create a file. Production shell redirections (`>` and `>>`) and `tee` can write to this filesystem.

Use `await bash.fs.access(path, mode)` to check existence (0), read (4), write (2), or execute/search permission (1). Combine permission bits to require all of them. Pass an abort signal to `bash.fs.chmod(path, mode, { signal })` to cancel a mode change. On memory-backed paths, including ordinary files alongside a device mount, pass `parent`, `expected`, and an ordered `ancestors` list from `lstat` to change only the inspected entry. A stale receipt returns `EAGAIN`; a final symlink changes mode without affecting its target. On memory-backed overlays, guarded chmod replaces regular files in the upper layer and preserves directory identity across copy-up. Guarded overlay symlinks return `ENOTSUP` without changing the target. A mounted root returns `EBUSY`, and device files do not support guarded permission changes.

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
