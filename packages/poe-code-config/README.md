# @poe-code/poe-code-config

Utilities for reading and writing scoped `poe-code` configuration.

## Config resolution order

For a resolved field, values are applied in this order:

1. CLI flags such as `--model`
2. Project config in `<cwd>/.poe-code/config.json`
3. Global config in `~/.poe-code/config.json`
4. Environment variables
5. Schema defaults
6. Constants in callers

This package is responsible for merging global and project config documents. CLI flags and caller-specific constants are applied outside this package.

## Config locations

- Global: `~/.poe-code/config.json`
- Project: `<cwd>/.poe-code/config.json`

Use `resolveConfigPath(homeDir)` for the global file and `resolveProjectConfigPath(cwd)` for the project file.

## Merge semantics

Project config is read as an override on top of global config.

- Documents are merged by scope.
- Keys inside a scope are merged.
- When the same key exists in both places, the project value wins.
- Missing or `undefined` project keys do not remove global values.

Example:

```json
{
  "models": {
    "default": "anthropic/claude-opus-4.7",
    "codex": "openai/gpt-5.3-codex"
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
