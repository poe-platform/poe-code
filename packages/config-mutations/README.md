# @poe-code/config-mutations

Composable file and config mutation engine.

This package applies ordered filesystem, JSON, TOML, YAML, and template
mutations with dry-run support and observer hooks. Callers inject the filesystem
so tests can use in-memory adapters and production flows can use
`node:fs/promises`.

## Usage

```ts
import { configMutation, fileMutation, runMutations } from "@poe-code/config-mutations";

await runMutations(
  [
    fileMutation.ensureDirectory({ path: "~/.config/example" }),
    configMutation.merge({
      target: "~/.config/example/config.json",
      format: "json",
      value: { enabled: true }
    })
  ],
  { fs, homeDir: "/Users/me" }
);
```

## Public API

- `runMutations(mutations, context)`: applies mutations in order.
- `configMutation`: builders for config merge, prune, and transform mutations.
- `fileMutation`: builders for directory, file, backup, restore, and mode mutations.
- `templateMutation`: builders for template writes and template-backed config merges.
- `renderTemplate(template, variables)`: renders template variables.
- Filesystem helpers: `isNotFound`, `readFileIfExists`, `pathExists`, and `createTimestamp`.

## Config Options

`MutationContext` controls execution:

| Option | Type | Description |
| ------ | ---- | ----------- |
| `fs` | `FileSystem` | Required filesystem adapter. |
| `homeDir` | `string` | Required home directory for `~` expansion. |
| `dryRun` | `boolean` | Reports changes without writing them. |
| `observers` | `MutationObservers` | Receives mutation lifecycle events. |
| `templates` | `TemplateLoader` | Loads templates referenced by template mutations. |
| `pathMapper` | `PathMapper` | Redirects target directories for isolated config flows. |

Mutation builders also expose per-mutation options such as target path, format,
label, force removal, backup behavior, template id, and transform callbacks.

## Environment Variables

This package does not read or expose environment variables.
