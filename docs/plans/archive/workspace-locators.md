---
status:
  state: completed
  iteration: 10
---
# Workspace Locators

Replace the `research` command with a workspace locator abstraction in `spawn`.
Today `spawn` takes `--cwd <path>` (local filesystem only) and `research` separately
handles `--github`, `--path`, and temp clone lifecycle. This plan unifies both under
a single locator-based `--cwd` on `spawn`, starting with `github://` support.

## Problem

- `research` is a specialized `spawn` that defaults to `--mode read` and adds
  GitHub clone logic (`src/sdk/research.ts:254-339`). It duplicates `spawn`'s
  execution path (it calls `spawnSdk` internally) and adds its own CLI surface
  for concepts (`--github`, `--path`, `--keep`) that belong in a shared resolver.
- `spawn --cwd` only accepts local paths (`src/cli/commands/spawn.ts:353-361`).
  There is no way to say "run this agent against a GitHub repo" without using
  the separate `research` command.
- The SDK has `SpawnOptions.cwd?: string` (`src/sdk/types.ts:10`) and
  `ResearchOptions` (`src/sdk/research.ts:16-29`) as separate surfaces. This
  forces SDK consumers to choose between two APIs for what is fundamentally
  one operation: run an agent in a workspace.

## Goals

1. Remove the `research` command and CLI registration.
2. Extend `spawn --cwd` to accept workspace locator strings.
3. Implement `github://` as the first non-local scheme.
4. Design the resolver interface so future schemes (`ssh://`, `docker://`) can
   be added without changing `spawn` itself.
5. Keep SDK parity: `spawn("agent", { cwd: "github://owner/repo" })` works.

## Non-goals

- Implementing `ssh://` or `docker://` locators (future plan).
- Remote execution (running the agent process on a remote host / inside a container).
  All locators in this plan resolve to a local filesystem path before spawn.
- Changing the process-runner package or its Runner interface.
- Changing how providers are invoked after cwd is resolved.

## Locator syntax

```
<scheme>://<authority><path>[#<ref>][:<subdir>]
```

### Supported schemes (this plan)

| Scheme | Authority | Path | Fragment | Example |
|--------|-----------|------|----------|---------|
| (none) | - | local path | - | `/tmp/project`, `./src` |
| `github` | `owner/repo` | optional subdir after authority | `#ref` for branch/tag/sha | `github://poe-platform/poe-code` |

### GitHub locator forms

```
github://owner/repo
github://owner/repo#ref
github://owner/repo/path/to/subdir
github://owner/repo#ref:path/to/subdir
```

### Reserved schemes (not implemented)

```
ssh://user@host/path
docker://container/path
```

These parse correctly but throw "unsupported scheme" at resolution time.

## Resolver interface

```typescript
// packages/workspace-locator/src/types.ts

type LocatorScheme = "local" | "github" | "ssh" | "docker";

interface ParsedLocator =
  | { scheme: "local"; path: string }
  | { scheme: "github"; owner: string; repo: string; ref?: string; subdir?: string }
  | { scheme: "ssh"; user?: string; host: string; port?: number; path: string }
  | { scheme: "docker"; container: string; path: string };

interface ResolvedWorkspace {
  /** Absolute local filesystem path ready for child_process cwd. */
  cwd: string;
  /** Cleanup callback — e.g. remove temp clone. Called after spawn completes. */
  cleanup?: () => Promise<void>;
  /** Original parsed locator for metadata / logging. */
  locator: ParsedLocator;
}

interface WorkspaceResolverOptions {
  /** Base directory for resolving relative local paths. */
  baseDir: string;
  /** Home directory for cache paths (~/.poe-code/workspaces/...). */
  homeDir: string;
  /** Spawn mode — affects checkout isolation policy. */
  mode?: SpawnMode;
  /** Function to run shell commands (git clone, git fetch). */
  exec: (command: string, args: string[], opts?: { cwd?: string }) => Promise<ExecResult>;
  /** Filesystem abstraction for mkdir, stat, etc. */
  fs: ResolverFileSystem;
}

async function resolveWorkspace(
  input: string,
  options: WorkspaceResolverOptions
): Promise<ResolvedWorkspace>;
```

Pure function: parse the input string, resolve it to a local path, return.
No global state, no singletons, no registry.

## Package: `packages/workspace-resolver`

New package. Owns parsing and resolution. No dependency on `agent-spawn`
or the CLI — it only needs `fs` and `exec` injected by the caller.

### Why a separate package

The code itself is small (~100-150 lines), but multiple packages consume it:

- **process-runner** — resolves `cwd` in `RunSpec` before executing
- **process-launcher** — long-running services need workspace targets
- **agent-spawn**, **acp client** — future consumers (not wired in this plan)

Putting it inside any one consumer would create awkward cross-dependencies.
A shared leaf package with zero heavy dependencies is the cleanest option.

### File structure

```
packages/workspace-resolver/
  src/
    types.ts          # ParsedLocator, ResolvedWorkspace, options
    index.ts          # re-exports
    parse.ts          # parseLocator(input: string): ParsedLocator
    parse.test.ts
    resolve.ts        # resolveWorkspace(input, options): ResolvedWorkspace
    resolve.test.ts
    github/
      clone.ts        # cloneOrUpdate, buildCachePath, buildCloneUrl
      clone.test.ts
      isolation.ts    # createWritableCheckout (worktree or copy for edit/yolo)
      isolation.test.ts
  README.md
  package.json
  tsconfig.json
```

## GitHub resolution behavior

### Cache location

`~/.poe-code/workspaces/github/<owner>-<repo>/`

Single bare or full clone per repo. Refs are resolved via `git fetch` + checkout.

### Clone strategy

Current heuristics (carried over from `research.ts:267-318`, refined):

**Fresh clone** (cache dir does not exist):
```
git clone --depth 1 <url> <cache-dir>
```
- Shallow clone to minimize download time/disk.
- If clone fails (auth, network, bad URL): surface git's stderr as the error
  message. Do not swallow or reformat — git's errors are already clear.

**Existing clone** (cache dir exists):
```
git status --porcelain          # check for local modifications
git pull --ff-only              # update only if clean and fast-forwardable
```
- If `git status` fails: warn, use existing clone as-is.
- If working tree is dirty (uncommitted changes): warn, skip update.
- If `git pull --ff-only` fails (diverged, network): warn, use existing clone.
- Never force-update or reset. The clone may have been used in a writable
  session that left changes behind.

### Ref resolution

`#ref` can be a branch name, tag, or commit SHA:
```
git fetch origin                # ensure remote refs are up to date
git checkout <ref>              # switch to requested ref
```
- If no ref specified: use default branch (whatever HEAD points to after clone).
- Detached HEAD is fine (expected for SHA or tag).
- If ref doesn't exist after fetch: throw with clear error listing available
  remote refs is a follow-up; for now, surface git's error.

### Subdir resolution

After checkout, if subdir is specified:
```
stat <cache-dir>/<subdir>       # verify it exists
```
- If subdir does not exist: throw with error naming the subdir and the repo.
- Return `<cache-dir>/<subdir>` as the final `cwd`.

### Write safety / isolation

| Mode | Behavior |
|------|----------|
| `read` | Use the shared cached checkout directly. Read-only is safe. |
| `edit`, `yolo` | Create an isolated writable copy (git worktree or temp dir copy). Return cleanup callback to remove it. |

This prevents `edit`/`yolo` from mutating the shared cache and corrupting
future `read` runs.

### Cleanup

- `read` mode: no cleanup needed (shared cache persists).
- `edit`/`yolo` mode: `cleanup()` removes the writable worktree/copy.
  The caller (`spawn`) invokes cleanup after the agent process exits.
  This replaces the old `research --keep` flag behavior.

## Integration (this plan)

### process-runner

`RunSpec.cwd` currently accepts a local path. With workspace-resolver:

- Before calling `runner.exec()`, consumers can resolve locator strings
  via `resolveWorkspace()` and pass the resulting local `cwd` to the runner.
- The runner itself stays unchanged — it always receives a local path.
- The integration point is at the consumer level, not inside the runner.

### process-launcher

`ProcessSpec.cwd` can accept a locator string. The supervisor resolves it
once at startup via `resolveWorkspace()` and passes the local path to the
runner for all subsequent restarts.

### Deferred (follow-up plan)

- Wire into `spawn` CLI command (replace `resolveSpawnWorkingDirectory`)
- Wire into SDK `spawn()` function
- Remove `research` command and `src/sdk/research.ts`
- Migration guide for `research` → `spawn --mode read -C github://...`

## Implementation order

### Phase 1: workspace-resolver package

1. Scaffold `packages/workspace-resolver/` — package.json, tsconfig, README
2. `parse.ts` + tests — parse locator strings into `ParsedLocator`
   - local paths (absolute, relative)
   - `github://owner/repo` variants
   - unknown schemes throw
3. `github/clone.ts` + tests — `cloneOrUpdate()`, `buildCachePath()`, `buildCloneUrl()`
   - uses injected `exec` and `fs` (memfs in tests)
   - no real git calls in unit tests
4. `github/isolation.ts` + tests — `createWritableCheckout()`
   - worktree creation for edit/yolo
   - cleanup callback
5. `resolve.ts` + tests — `resolveWorkspace()` orchestrator
   - local paths: resolve relative to baseDir
   - github: parse, clone/update, isolate if writable, return cwd

### Phase 2: wire into process-runner and process-launcher

6. Add `@poe-code/workspace-resolver` as dependency to both packages
7. Document usage pattern: resolve locator before passing cwd to runner/supervisor
8. Add integration examples to workspace-resolver README

### Phase 3 (follow-up, separate plan): wire into spawn + remove research

Not part of this plan. See "Deferred" section above.

## Relationship to other plans

- **process-runner.md**: Unchanged. Process-runner owns how processes are
  executed (host vs docker). Workspace-locator owns where they run (what cwd).
  These are orthogonal. A future plan could combine docker locators with
  docker runners, but this plan does not.
- **spawn-docker-integration.md**: Unchanged. Docker runtime config is about
  the execution environment. Workspace locators are about the target codebase.
  A spawn could use both: `--cwd github://owner/repo` with Docker runtime.

## Resolved questions

1. **Cache eviction**: Not needed. GitHub clones are cleaned up automatically
   after use (read mode shares a transient checkout, edit/yolo worktrees are
   removed via cleanup callback).
2. **Auth for private repos**: Uses whatever git credentials are configured on
   the system (credential helpers, SSH keys, etc.). No custom `--token` flag.
   The resolver must surface git's auth errors clearly — no swallowing stderr.
3. **Submodules**: Follow-up. `--depth 1` without `--recurse-submodules` for now.
