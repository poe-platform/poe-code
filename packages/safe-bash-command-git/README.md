# Git in your virtual filesystem

Run Git against `@poe-code/safe-fs` in Safe Bash, including Cloudflare Workers without `nodejs_compat`. The command uses the Rust Git engine compiled to WebAssembly and never starts a host process.

```ts
import { gitCommands } from '@poe-platform/safe-bash/commands/git';

shell.use(gitCommands());
await shell.exec('git init -b main; git add .; git commit -m "Initial commit"');
```

| Commands | Purpose |
| --- | --- |
| `init`, `config`, `status`, `add`, `rm`, `mv`, `clean`, `update-index` | Manage a repository, worktree, and stage files |
| `commit`, `log`, `shortlog`, `describe`, `diff`, `show`, `grep`, `blame`, `reset`, `restore`, `checkout` | Inspect and update history, index, and worktree |
| `branch`, `switch`, `tag`, `merge`, `rebase`, `cherry-pick`, `revert`, `stash`, `notes`, `reflog` | Manage branches, rebases, notes, reflogs, and stashes |
| `format-patch`, `apply`, `am`, `archive`, `submodule`, `worktree` | Generate/apply patches, export tar archives, and manage submodules/worktrees |
| `rev-parse`, `rev-list`, `cat-file`, `hash-object`, `ls-files`, `ls-tree`, `show-ref`, `symbolic-ref`, `update-ref`, `merge-base`, `check-ignore`, `fsck`, `gc`, `count-objects` | Inspect and maintain Git objects, refs, and repository state |
| `remote`, `clone`, `fetch`, `pull`, `push` | Exchange changes through explicitly supplied HTTP |

`createGitCommand()`, `createGitCommands()` and `gitCommands()` accept no arguments. Optional `limits` bound filesystem entries, file/path bytes, depth, HTTP requests and HTTP bytes. Every limit defaults to `Infinity` (disabled); set a positive safe integer to enable a budget. The filesystem is imported as a snapshot per invocation; changed entries are published even when Git reports a conflict or other nonzero exit. A failed request parser or input/output budget check publishes no filesystem changes. Adapter publication failures may leave partial writes, as with ordinary filesystem operations; serialize commands that mutate the same repository.

Network operations require an explicit `http(request)` callback returning `{status, headers, body}`. The callback receives URL, method, headers, byte body and cancellation signal. Hosts control authentication, redirects and network policy. No ambient credentials or network access are used.

Workers bundlers should enable the `workerd` condition and import `.wasm` files as modules. An already imported `WebAssembly.Module` can also be supplied as `wasmModule`. The workspace build requires the Rust `wasm32-unknown-unknown` target.
