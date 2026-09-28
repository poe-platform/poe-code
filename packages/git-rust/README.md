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

`status --porcelain` and `--porcelain=v1` provide short machine-readable status. Combine `-s` and `-b` (including `-sb` or `-bs`) to include the branch header, use `-uno` or `--untracked-files=no` to hide untracked files, and select files or directories with pathspecs. `diff` accepts paths, two revisions, `A..B`, or `A...B` (from the merge base); choose `--name-only`, `--name-status`, `--stat`, `--quiet` (exit 1 for changes), or `-U<n>` / `--unified=<n>`. Use `branch --show-current`, `-a`, `-r`, `-m` or `-M` to inspect or rename branches. `log` accepts a revision, `A..B`, or `A...B` (symmetric difference), file or directory pathspecs (including deleted paths, with optional `--`), `-n N`, `-N`, and `--max-count=N`. `--format` and `--pretty` accept values with either a space or `=`, including `oneline`, `short`, `medium`, `full`, or a custom format. `format:...` omits the trailing newline. Custom formats support commit IDs (`%H`, `%h`), subject/body (`%s`, `%b`, `%B`), author/committer names and emails (`%an`, `%ae`, `%cn`, `%ce`), `%%` and `%n`.

`rev-parse` resolves multiple revisions in order, supports `--short[=<n>]`, and reports ref names with `--abbrev-ref` or `--symbolic-full-name`. `show` displays blob content and tree entries by object ID or revision path, including objects referenced by annotated tags. `merge -m <message> <revision>` sets the merge commit message and uses the configured identity. `cherry-pick` accepts multiple revisions in order; `-n` or `--no-commit` accumulates their changes with existing staged changes without advancing HEAD. Cherry-pick commits preserve the original author and use the configured user as committer.

Revision arguments accept `@` as an alias for `HEAD` and support abbreviated object IDs and chained ancestry selectors such as `HEAD~2`, `HEAD^2`, and `main~1^`. Peel annotated tags with `^{}` or `^{commit}`, and resolve tree or blob IDs with `<revision>:<path>`. Branch, tag, merge, and cherry-pick revision arguments use the same selectors. Branch creation, checkout, reset, merge, and cherry-pick automatically peel annotated tags to their commit; `rev-parse <tag>` still returns the tag object ID. Three-dot `diff` ranges peel annotated tags on both sides, and `show <tag>` displays each annotated tag’s metadata before the referenced commit and its commit ID. `checkout -b <name> <start-point>` and `switch -c <name> <start-point>` create and switch to the requested commit. `checkout -B <name> [<start-point>]` and `switch -C <name> [<start-point>]` create or reset a branch after a successful checkout. `checkout --orphan <name> [<start-point>]` starts a new history with the selected files. The start-point may also precede the branch creation option, as in `checkout <start-point> -b <name>` or `switch <start-point> -C <name>`. Use `checkout <path>` to restore tracked paths from the index or `checkout <revision> <path>` (with optional `--` before the paths) to restore only those paths and their index entries without changing `HEAD`. `tag -m <message> <name> [<revision>]` creates an annotated tag; `-a` and `-m` may appear before or after the name. Use `show :<path>` (or `:0:<path>`) to read staged content, and `show <revision>:<path>` to read a historical file and `restore --source=<revision> <path>` (also `--source <revision>` or `-s<revision>`) to restore it.

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
