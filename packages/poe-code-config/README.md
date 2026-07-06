# @poe-code/poe-code-config

Utilities for reading and writing scoped `poe-code` configuration.

## Config resolution order

For a resolved field, values are applied in this order:

1. CLI flags such as `--model`
2. Environment variables declared by the field schema
3. Project config in `<cwd>/.poe-code/config.json`
4. Global config in `~/.poe-code/config.json`
5. Schema defaults
6. Constants in callers

This package is responsible for merging global and project config documents, then
resolving schema-declared environment variables over the merged file value. CLI
flags and caller-specific constants are applied outside this package.

## Config locations

- Global: `~/.poe-code/config.json`
- Project: `<cwd>/.poe-code/config.json`

Use `resolveConfigPath(homeDir)` for the global file and `resolveProjectConfigPath(cwd)` for the project file.

## Environment Variables

This package resolves only environment variables declared by compiled config schemas. It does not hard-code package-specific env names.

## Configuration Options

Config options are schema-declared scope fields. Built-in scopes documented below include runtime execution options and runner sync options; other packages contribute their own scopes with `defineScope(...)`.

## Schema compilation

Packages can define declarative config fragments with `defineScope(...)` and export them from production entrypoints. `compileConfigSchemaFromEntrypoints(...)` walks static imports and re-exports from those entrypoints, collects reachable exported `defineScope(...)` calls, merges fragments by scope name, and emits a JSON Schema document through `toolcraft-schema`.

```ts
import { defineScope } from "@poe-code/poe-code-config";

export const pipelineConfigScope = defineScope("pipeline", {
  plan_directory: {
    type: "string",
    default: "docs/plans",
    env: "POE_PIPELINE_PLAN_DIRECTORY",
    doc: "Directory where Pipeline plan documents are stored"
  }
});
```

Supported compiled field types are `string`, `number`, and `boolean`. Scope names, field names, field defaults, `doc`, and optional `env` metadata must be static literals. Multiple packages may contribute to the same scope, but duplicate field names in a scope are rejected.

Compiler document options:

- `id`: JSON Schema `$id`.
- `title`: JSON Schema document title.
- `description`: JSON Schema document description.
- `schema`: JSON Schema dialect URI. Defaults to `https://json-schema.org/draft/2020-12/schema`.

## State locations

Runtime state is global to the local machine and lives under `~/.poe-code/state`.

- Template cache: `~/.poe-code/state/templates.json`
- Runtime jobs: `~/.poe-code/state/jobs/<job_id>.json`

Use `loadStateManager(homeDir)` for node-backed state or `createStateManager(homeDir, fs)` when tests need an injected filesystem.

## Runtime Scope

The `runtime` scope describes where commands execute. `parseRuntime(...)` accepts:

- `type`: `host`, `docker`, or `e2b`. Defaults to `host`.
- `build_args`: build argument object used by image/template builds. Defaults to `{}`.
- `mounts`: additional runtime mounts. Defaults to `[]`.
- `link`: optional informational URL or label for the runtime definition.

Docker-specific options:

- `image`: prebuilt Docker image. When present, no Dockerfile build is required.
- `dockerfile`: Dockerfile path. Defaults to `.poe-code/Dockerfile` when a build is needed.
- `build_context`: Docker build context. Defaults to the current project directory.
- `engine`: `docker` or `podman`.
- `network`: Docker network.
- `extra_args`: additional container runtime arguments.

E2B-specific options:

- `template_id`: prebuilt E2B template id. When present, no template build is required.
- `dockerfile`: Dockerfile path. Defaults to `.poe-code/Dockerfile` when a template build is needed.
- `build_context`: E2B template build context. Defaults to the current project directory.
- `cpu`: CPU count for template builds.
- `memory_mb`: memory in megabytes for template builds.
- `timeout_minutes`: sandbox timeout in minutes.
- `preserve_after_exit_hours`: hours to keep a detached sandbox alive after job exit. Defaults to `24`; valid range is `0` to `168`.

The E2B API key is configured under the separate `e2b` scope, owned by `@poe-code/runner-e2b`. See that package's README.

## Runner Scope

Runner settings are stored as `runtime.runner` in config and parsed with `parseRunner(...)`.

- `detach`: run through a detached runtime job when the backend supports it. Defaults to `false`.
- `upload_max_file_mb`: maximum file size uploaded during workspace transfer. Defaults to `100`.
- `download_conflict`: sync-back conflict policy, either `refuse` or `overwrite`. Defaults to `refuse`.
- `workspace.exclude`: upload exclusion list. Defaults to `.git`, `node_modules`, `dist`, `.turbo`, `.next`, and `.poe-code/state.json`.

## Merge semantics

Project config is read as an override on top of global config.

- Documents are merged by scope.
- Keys inside a scope are merged.
- When the same key exists in both places, the project value wins.
- Missing or `undefined` project keys do not remove global values.
- If the project config path resolves to the global config path, only the global document is read and no self-merge is attempted.
- Project config reads auto-extend from the global config directory, but self-discovered optional bases are ignored by `@poe-code/config-extends`.

Example:

```json
{
  "models": {
    "default": "<model-id>",
    "codex": "<model-id>"
  }
}
```

## `createConfigStore`

Pass both paths when you want project overrides to be visible on reads:

```ts
import { createConfigStore } from "@poe-code/poe-code-config";

const store = createConfigStore({
  fs,
  filePath: globalConfigPath,
  projectFilePath: projectConfigPath,
  env: process.env
});
```

- `get()` and `getAll()` read the merged document.
- `set()` always writes to the global config file.

## Raw document reads

For callers that work with whole scopes directly, use `readMergedDocument(fs, globalPath, projectPath)`.

This returns the same merged view used by `createConfigStore`.

## Write behavior

Project config is read-only from this package's perspective.

- `writeScope(...)` writes to the global config file only.
- `createConfigStore(...).scope(...).set(...)` writes to the global config file only.
- Users can edit project config manually or through higher-level tooling.
