# @poe-code/task-list

Multi-list task manager with pluggable storage backends.

## Backends

`@poe-code/task-list` exposes one API over two backends:

- `markdown-dir`: one Markdown file per task, organized into subdirectories per list
- `yaml-file`: one YAML document with a top-level `lists:` mapping

The task lifecycle is `draft -> planned -> in-progress -> done -> archived`. `archived` is terminal.

## Public API

- `openTaskList(options)`: opens a task store and returns a `TaskList`
- `TaskList`: top-level interface for listing lists, querying all tasks, and resolving qualified IDs
- `Tasks`: per-list interface for create, update, transition, delete, and list operations
- `Task`: normalized task record with `list`, `id`, `qualifiedId`, `name`, `state`, `description`, and `metadata`
- `TaskState`: `"draft" | "planned" | "in-progress" | "done" | "archived"`
- `TaskDefaults`: default `state` and `metadata` applied when creating new tasks
- Error classes: `TaskNotFoundError`, `TaskAlreadyExistsError`, `InvalidTransitionError`, `MalformedTaskError`

## Options

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | `"markdown-dir" \| "yaml-file"` | required | Selects the backend implementation. |
| `path` | `string` | required | Root directory for `markdown-dir` or YAML file path for `yaml-file`. |
| `defaults` | `TaskDefaults` | `{ state: "draft", metadata: {} }` | Seeds omitted fields on new tasks only. |
| `create` | `boolean` | `false` | Creates missing storage for the selected backend when enabled. |
| `lockStaleMs` | `number` | `30_000` | Stale threshold passed to backend file locking. |
| `lockRetries` | `number` | `20` | Retry count passed to backend file locking. |
| `fs` | `TaskListFs` | `node:fs/promises` adapter | Injectable filesystem, primarily for tests. |

## Env vars

None.

## Usage

### `markdown-dir`

```ts
import { openTaskList } from "@poe-code/task-list";

const taskList = await openTaskList({
  type: "markdown-dir",
  path: "/repo/tasks",
  create: true
});

const planning = taskList.list("planning");

await planning.create({
  id: "ship-readme",
  name: "Ship package README"
});

await planning.transition("ship-readme", "planned");
```

### `yaml-file`

```ts
import { openTaskList } from "@poe-code/task-list";

const taskList = await openTaskList({
  type: "yaml-file",
  path: "/repo/tasks.yaml",
  create: true
});

const planning = taskList.list("planning");

await planning.create({
  id: "review-release",
  name: "Review release checklist"
});

await planning.transition("review-release", "in-progress");
```

## Notes

The package never overwrites existing task files or store files. `defaults` are applied only when creating new tasks and do not retroactively update existing tasks.
