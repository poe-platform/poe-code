# Git in your virtual filesystem

Run Git against `@poe-code/safe-fs` in Safe Bash, including Cloudflare Workers without `nodejs_compat`. The command uses the Rust Git engine compiled to WebAssembly and never starts a host process.

```ts
import { gitCommands } from '@poe-platform/safe-bash/commands/git';

shell.use(gitCommands());
await shell.run('git init -b main; git add .; git commit -m "Initial commit"');
```

| Commands | Purpose |
| --- | --- |
| `init`, `config`, `status`, `add`, `rm`, `mv` | Manage a repository and stage files |
| `commit`, `log`, `diff`, `show`, `reset`, `restore`, `checkout` | Inspect and update history, index and worktree |
| `branch`, `switch`, `tag`, `merge`, `cherry-pick`, `stash` | Manage branches and changes |
| `rev-parse`, `cat-file`, `hash-object`, `ls-files` | Inspect Git objects and paths |
| `remote`, `clone`, `fetch`, `pull`, `push` | Exchange changes through explicitly supplied HTTP |

`createGitCommand()`, `createGitCommands()` and `gitCommands()` accept no arguments. Optional `limits` bound filesystem entries (4096), file/path bytes (4 MiB), depth (128), HTTP requests (16) and HTTP bytes (4 MiB). The filesystem is imported as a bounded snapshot per invocation; changed entries are published after successful execution. A failed input or output budget check publishes no filesystem changes. Adapter publication failures may leave partial writes, as with ordinary filesystem operations; serialize commands that mutate the same repository.

Network operations require an explicit `http(request)` callback returning `{status, headers, body}`. The callback receives URL, method, headers, byte body and cancellation signal. Hosts control authentication, redirects and network policy. No ambient credentials or network access are used.

Workers bundlers should enable the `workerd` condition and import `.wasm` files as modules. An already imported `WebAssembly.Module` can also be supplied as `wasmModule`. The workspace build requires the Rust `wasm32-unknown-unknown` target.
