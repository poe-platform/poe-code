# @poe-code/maestro-tui

Interactive TUI package for browsing Maestro task lists.

`runMaestroTui()` resolves a Maestro workflow, opens the configured task-list
backend, loads tasks, and starts the shared design-system explorer. The explorer
shows task rows grouped by state, renders task detail markdown with metadata and
available events, and refreshes from the task list after source-file edits.

Available explorer actions:

| Action                | Key | Behavior                                                                                              |
| --------------------- | --- | ----------------------------------------------------------------------------------------------------- |
| Open in `$EDITOR`     | `o` | Visible for tasks with `sourcePath`; opens the task source file and refreshes the explorer afterward. |
| Open issue in browser | `g` | Visible for tasks whose metadata has an HTTP(S) `url`; opens the issue URL externally.                |

## Public API

- `runMaestroTui(options?)`: loads a workflow task list and launches the explorer.
- `buildMaestroExplorerConfig(options)`: builds an explorer config from an existing task list and task snapshot.

## Configuration

This package does not introduce config file options.

`runMaestroTui(options?)` accepts:

| Option         | Behavior                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `workflowPath` | Explicit Maestro workflow path. Cannot be combined with `name`.                                 |
| `name`         | Named Maestro workflow resolved by `@poe-code/maestro`. Cannot be combined with `workflowPath`. |
| `taskList`     | SDK-only pre-opened task list. When provided, workflow loading is skipped.                      |
| `variables`    | Environment values passed to source-file edit actions. Defaults to `process.env`.               |

`buildMaestroExplorerConfig(options)` accepts:

| Option      | Behavior                                                    |
| ----------- | ----------------------------------------------------------- |
| `tasks`     | Initial task snapshot used for explorer rows.               |
| `taskList`  | Task-list backend used to load events for detail rendering. |
| `variables` | Environment values passed to source-file edit actions.      |
| `onRefresh` | Reloads tasks after edits or explorer refreshes.            |

## Environment Variables

| Env var  | Behavior                                                              |
| -------- | --------------------------------------------------------------------- |
| `EDITOR` | Used by the source-file edit action when `variables` is not provided. |
