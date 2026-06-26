# @poe-code/workspace-resolver

Resolves workspace locator strings to local filesystem paths for spawn-like workflows.

## Locator syntax

A workspace locator is a URI-like string that tells the resolver **where** an agent should run. The scheme selects the backend; everything after `://` is backend-specific.

```
scheme://authority/path[#fragment]
```

Strings without a `://` separator (including Windows drive paths like `C:\repo`) are treated as `local`.

### `local` — filesystem path

```
.
./src
/repo
C:\Users\me\repo
```

No scheme prefix. Relative paths resolve against `baseDir`. The path is used directly — no cloning or caching.
Local paths are validated before use and must exist as directories.

### `github` — GitHub repository

```
github://owner/repo
github://owner/repo/packages/core
github://owner/repo#ref
github://owner/repo#ref:subdir
```

| Part                     | Required | Description                             |
| ------------------------ | -------- | --------------------------------------- |
| `owner`                  | yes      | GitHub user or organisation             |
| `repo`                   | yes      | Repository name                         |
| path segments after repo | no       | Subdir (alternative to fragment syntax) |
| `#ref`                   | no       | Branch, tag, or commit                  |
| `:subdir` (after ref)    | no       | Subdir within the repo                  |

Subdir can be specified via path (`owner/repo/sub`) or fragment (`owner/repo#ref:sub`), but not both.

Cached clones live in `~/.poe-code/workspaces/github/owner-repo`. Writable (`edit`) mode creates a git-worktree under `~/.poe-code/workspaces/checkouts/`.
Clean cached checkouts are updated before use, requested refs are checked out as revisions, and failed `git worktree add` operations clean up any directory they created.

### `ssh` — SSH workspace (parsed, not resolved)

```
ssh://git@example.com/worktree
ssh://git@example.com:2222/worktree
```

| Part   | Required | Description           |
| ------ | -------- | --------------------- |
| `user` | no       | SSH username          |
| `host` | yes      | SSH host              |
| `port` | no       | SSH port              |
| `path` | yes      | Remote workspace path |

The parser accepts this scheme, but `resolveWorkspace()` currently throws
`Unsupported workspace locator scheme "ssh"`.

### `docker` — Docker container workspace (parsed, not resolved)

```
docker://dev-container/workspace
```

| Part        | Required | Description                         |
| ----------- | -------- | ----------------------------------- |
| `container` | yes      | Container name or id                |
| `path`      | yes      | Workspace path inside the container |

The parser accepts this scheme, but `resolveWorkspace()` currently throws
`Unsupported workspace locator scheme "docker"`.

## Access modes

Every backend respects the `mode` option:

| Mode   | Behaviour                                                                                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read` | Shared checkout for GitHub locators without a ref. GitHub locators with a ref use an isolated checkout so the requested ref can be checked out without mutating the shared cache. Local paths resolve directly. |
| `edit` | Isolated writable GitHub checkout with cleanup callback. Local paths resolve directly.                                                                                                                          |
| `auto` | Lets the resolver isolate GitHub workspaces automatically. Today this behaves like `edit` for GitHub locators and direct access for local paths.                                                                |
| `yolo` | Direct mutable access with no isolation. GitHub locators resolve to the shared cache; local paths resolve directly.                                                                                             |

## Options

- `baseDir`: base path for relative local paths
- `homeDir`: home directory used for resolver caches
- `mode`: workspace access mode — `read`, `edit`, `auto`, or `yolo`

No environment variables or config files are read by this package directly.
