# `@poe-code/git-rust` (`git-rust`)

In-memory-capable Git engine and CLI dispatcher in pure Rust, with a portable WebAssembly boundary for `@poe-code/safe-fs` and the `safe-bash-command-git` plugin.

## Feature Index

| Category | Available Commands & APIs |
| --- | --- |
| **Repository & Config** | `init`, `find_root`, `get_config`, `get_config_all`, `set_config`, `version` |
| **Refs, Branches & Tags** | `resolve_ref`, `write_ref`, `delete_ref`, `list_refs`, `branch`, `delete_branch`, `rename_branch`, `list_branches`, `current_branch`, `tag`, `annotated_tag`, `delete_tag`, `list_tags` |
| **Objects, Trees & Packs** | `hash_blob`, `read_blob`, `write_blob`, `read_tree`, `write_tree`, `read_commit`, `write_commit`, `read_tag`, `write_tag`, `read_object`, `write_object`, `expand_oid`, `pack_objects`, `index_pack`, `upload_pack` |
| **Worktree & Index** | `status`, `status_matrix`, `is_ignored`, `list_files`, `add`, `remove`, `reset_index`, `update_index`, `checkout`, `commit` |
| **History, Merge & Stash** | `log`, `is_descendent`, `find_merge_base`, `merge`, `fast_forward`, `abort_merge`, `cherry_pick`, `stash`, `add_note`, `read_note`, `remove_note`, `list_notes` |
| **Remotes & Smart HTTP** | `add_remote`, `delete_remote`, `list_remotes`, `get_remote_info`, `get_remote_info2`, `list_server_refs`, `fetch`, `clone`, `pull`, `push` |
| **`safe-bash` CLI** | `execute_git_cli(&MemoryFs, cwd, args)` (`git init`, `status`, `add`, `rm`, `mv`, `diff`, `show`, `reset`, `restore`, `commit`, `log`, `branch`, `checkout`, `tag`, `merge`, `cherry-pick`, `stash`, `remote`, `config`, `rev-parse`, `cat-file`, `hash-object`, `ls-files`, `clone`, `fetch`, `pull`, `push`) |

## Quick Start

### Programmatic Rust API

```rust
use git_rust::{add, commit, init, status, Author, MemoryFs};

let fs = MemoryFs::new();
init(&fs, Some("/repo"), None, false, Some("main"))?;

fs.write_str("/repo/hello.txt", "Hello from git-rust!\n");
add(&fs, "/repo", None, &["hello.txt".to_string()], false)?;

let oid = commit(
    &fs,
    "/repo/.git",
    Some("feat: initial commit"),
    Some(Author {
        name: "Alice".to_string(),
        email: "alice@example.com".to_string(),
        timestamp: 1700000000,
        timezone_offset: 0.0,
    }),
    None,
    false,
    false,
    false,
    false,
    None,
    None,
    None,
)?;
assert_eq!(status(&fs, "/repo", None, "hello.txt")?, "unmodified");
```

### `safe-bash` CLI Dispatcher

`status --porcelain` and `--porcelain=v1` provide short machine-readable status. Combine `-s` and `-b` (including `-sb` or `-bs`) to include the branch header, use `-uno` or `--untracked-files=no` to hide untracked files, and select files or directories with pathspecs. `diff` accepts paths, two revisions, `A..B`, or `A...B` (from the merge base); choose `--name-only`, `--name-status`, `--stat`, `--quiet` (exit 1 for changes), or `-U<n>` / `--unified=<n>`. Use `branch --show-current`, `-a`, `-r`, `-m` or `-M` to inspect or rename branches. `log` accepts a revision or `A..B`, file or directory pathspecs after `--`, `-n N`, `-N`, and `--max-count=N`. `--format` and `--pretty` accept values with either a space or `=`, including `oneline`, `short`, `medium`, `full`, or a custom format. `format:...` omits the trailing newline. Custom formats support commit IDs (`%H`, `%h`), subject/body (`%s`, `%b`, `%B`), author/committer names and emails (`%an`, `%ae`, `%cn`, `%ce`), `%%` and `%n`.

For binary output, use `CliResult.stdout_bytes` when present; `stdout` provides the text representation.

```rust
use git_rust::{execute_git_cli, MemoryFs};

let fs = MemoryFs::new();
execute_git_cli(&fs, "/workspace", &["init"]);
execute_git_cli(&fs, "/workspace", &["config", "user.name", "Safe Bash"]);
execute_git_cli(&fs, "/workspace", &["config", "user.email", "bash@poe.com"]);

fs.write_str("/workspace/README.md", "# Project\n");
execute_git_cli(&fs, "/workspace", &["add", "README.md"]);
execute_git_cli(&fs, "/workspace", &["commit", "-m", "Initial commit"]);

let log = execute_git_cli(&fs, "/workspace", &["log", "--oneline"]);
assert_eq!(log.exit_code, 0);
```
