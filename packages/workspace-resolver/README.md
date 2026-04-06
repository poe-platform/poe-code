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

### `github` — GitHub repository

```
github://owner/repo
github://owner/repo/packages/core
github://owner/repo#ref
github://owner/repo#ref:subdir
```

| Part | Required | Description |
|------|----------|-------------|
| `owner` | yes | GitHub user or organisation |
| `repo` | yes | Repository name |
| path segments after repo | no | Subdir (alternative to fragment syntax) |
| `#ref` | no | Branch, tag, or commit |
| `:subdir` (after ref) | no | Subdir within the repo |

Subdir can be specified via path (`owner/repo/sub`) or fragment (`owner/repo#ref:sub`), but not both.

Cached clones live in `~/.poe-code/workspaces/github/owner-repo`. Writable (`edit`) mode creates a git-worktree under `~/.poe-code/workspaces/checkouts/`.

### `ssh` — remote host

```
ssh://host/remote-path
ssh://user@host/remote-path
ssh://user@host:2222/remote-path
```

| Part | Required | Description |
|------|----------|-------------|
| `user` | no | SSH username |
| `host` | yes | Hostname or IP |
| `port` | no | SSH port (default 22) |
| `remote-path` | yes | Absolute path on the remote |

Parsed via standard URL rules. The agent process runs on the remote host.

The local `cwd` (or a specified local path) is bidirectionally synced with `remote-path` before and after the spawn — similar to Unison. The resolver manages the sync lifecycle so the agent sees a consistent workspace on the remote.

### `docker` — container path

```
docker://container/container-path
docker://myimage:latest/workspace
```

| Part | Required | Description |
|------|----------|-------------|
| `container` | yes | Container name or image reference |
| `container-path` | yes | Absolute path inside the container |

Everything before the first `/` is the container identifier; everything from the `/` onward is the workspace path inside the container.

The local `cwd` is bidirectionally synced with `container-path` before and after the spawn — the agent works inside the container while changes propagate back to the host.

### `modal` — Modal sandbox (planned)

```
modal://app-name/sandbox-name
```

| Part | Required | Description |
|------|----------|-------------|
| `app-name` | yes | Modal app |
| `sandbox-name` | yes | Sandbox to create or reuse |

Sandbox is provisioned on demand via the Modal API. Workspace files are synced in before spawn and results synced out after.

### `k8s` — Kubernetes pod (planned)

```
k8s://namespace/pod-template
```

| Part | Required | Description |
|------|----------|-------------|
| `namespace` | yes | Kubernetes namespace |
| `pod-template` | yes | Pod spec or template name |

Runs the agent as a Job. Workspace is mounted via PVC or ephemeral volume. Pod is cleaned up after exit.

## Access modes

Every backend respects the `mode` option:

| Mode | Behaviour |
|------|-----------|
| `read` | Shared, read-only checkout. Multiple agents can access the same cache. |
| `edit` | Isolated writable checkout with cleanup callback. |
| `yolo` | Direct mutable access (no isolation). |

## Options

- `baseDir`: base path for relative local paths
- `homeDir`: home directory used for resolver caches
- `mode`: workspace access mode — `read`, `edit`, or `yolo`

No environment variables or config files are read by this package directly.
