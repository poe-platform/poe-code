# @poe-code/runner-e2b

E2B execution environment runner for Poe Code.

This package implements the shared `ExecutionEnvFactory` contract for `runtime.type: "e2b"`.
It is responsible for opening E2B sandboxes, resolving or building templates from the Poe Code
runtime config, uploading/downloading workspaces, and reconnecting to detached sandboxes.

## API key

The E2B API key is read from the `e2b` config scope. Resolution order:

1. `E2B_API_KEY` environment variable.
2. `e2b.api_key` in the project config (`<cwd>/.poe-code/config.json`).
3. `e2b.api_key` in the global config (`~/.poe-code/config.json`).

Example global config:

```json
{
  "e2b": {
    "api_key": "e2b_..."
  }
}
```

Missing key on `open()` or `attach()` raises an error pointing to both locations.
Blank `E2B_API_KEY` values are ignored so project or global config can still resolve.

## Runtime Config

Use these options under the `runtime` config scope:

- `type`: must be `e2b`.
- `template_id`: existing E2B template id. When set, template build is skipped.
- `dockerfile`: Dockerfile path used to build a template when `template_id` is not set. Defaults to `.poe-code/Dockerfile`.
- `build_context`: build context path. Defaults to the project root.
- `build_args`: build argument object included in the template hash.
- `mounts`: unsupported for E2B; non-empty mounts are rejected before sandbox startup.
- `workspace_dir`: sandbox-local workspace directory used for upload, execution, and download. Defaults to `/workspace`.
- `cpu`: CPU count used when building an E2B template.
- `memory_mb`: memory in megabytes used when building an E2B template.
- `timeout_minutes`: sandbox timeout in minutes.
- `preserve_after_exit_hours`: hours to keep a detached sandbox alive after job exit. Defaults to `24`; valid range is `0` to `168`.

Non-empty `mounts` are rejected because E2B does not support host mounts.
Host-workspace subdirectory `cwd` values are mapped into the sandbox workspace.

Runner workspace behavior is controlled by `runtime.runner` in `@poe-code/poe-code-config`:

- `detach`: default detached execution preference when the caller supports it.
- `upload_max_file_mb`: maximum file size uploaded by workspace transfer.
- `download_conflict`: sync-back policy, `refuse` or `overwrite`.
- `workspace.exclude`: upload exclusion list.

Example project config:

```json
{
  "runtime": {
    "type": "e2b",
    "dockerfile": ".poe-code/Dockerfile",
    "build_context": ".",
    "workspace_dir": "/workspace",
    "timeout_minutes": 60,
    "preserve_after_exit_hours": 24,
    "runner": {
      "detach": false,
      "download_conflict": "refuse"
    }
  }
}
```

## Template Build Flow

When `runtime.template_id` is present, `e2bExecutionEnvFactory.open(...)` uses that template id
directly.

When `runtime.template_id` is absent:

1. Read the configured Dockerfile, defaulting to `.poe-code/Dockerfile`.
2. Read regular files from the configured build context, defaulting to the project root.
3. Compute a SHA-256 hash from Dockerfile bytes, build context file paths and bytes, and sorted `build_args`.
4. Look up the hash in `state.templates.get("e2b", hash)`.
5. If a cached entry has `template_id`, reuse it.
6. Otherwise build a new E2B template named `poe-code-<hash-prefix>`.
7. Persist the built template in `~/.poe-code/state/templates.json`.

The hash is deterministic for the same Dockerfile, build context contents, and build args, ignoring files excluded by `.dockerignore`. That keeps
template identity stable across runs and across teammates using the same inputs.
Blank cached template ids are ignored and rebuilt.

## Sandbox Lifecycle

`e2bExecutionEnvFactory.open(...)` opens a new sandbox from the resolved template and returns an
`OpenedEnv`.

The opened environment supports:

- `uploadWorkspace()`: archives the local workspace and uploads it into the sandbox.
- `exec(spec)`: runs a command inside the sandbox.
- `shell()`: opens an interactive shell using the shared `RunHandle` shape.
- `detach()`: leaves the sandbox running and returns a job handle.
- `downloadWorkspace({ conflictPolicy })`: syncs files back, refusing or overwriting local conflicts according to the runner policy.
- `close()`: shuts down the sandbox when the run is not detached.

`e2bExecutionEnvFactory.attach(envId, context)` reconnects to an existing sandbox id. Detached jobs
are tracked by the caller state manager under `~/.poe-code/state/jobs/<job_id>.json`.

Command completion markers and exit-code output are parsed strictly; malformed
values are rejected instead of being coerced. If kill is requested before the E2B
command handle resolves, the command is killed as soon as the handle becomes
available.
