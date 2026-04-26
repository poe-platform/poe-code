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
- `Tasks`: per-list interface for create, update, `fire`, `canFire`, `events`, delete, and list operations
- `Task`: normalized task record with `list`, `id`, `qualifiedId`, `name`, `state`, `description`, and `metadata`
- `TaskState`: `"draft" | "planned" | "in-progress" | "done" | "archived"`
- `TaskDefaults`: default `metadata` applied when creating new tasks
- `StateMachineDef` / `EventDef`: exported types for custom task lifecycle definitions passed via `openTaskList({ stateMachine })`
- `defaultStateMachine`: exported default lifecycle with `plan`, `start`, `complete`, and `archive` events
- Error classes: `TaskNotFoundError`, `TaskAlreadyExistsError`, `InvalidTransitionError`, `MalformedTaskError`

## State Machines

```ts
interface StateMachineDef<TState extends string = string, TEvent extends string = string> {
  initial: TState;
  states: readonly TState[];
  events: Readonly<Record<TEvent, EventDef<TState>>>;
}

interface EventDef<TState extends string = string> {
  from: readonly TState[] | "*";
  to: TState;
  guard?: (task: Task) => true | string;
  onEnter?: (task: Task) => void | Promise<void>;
  onExit?: (task: Task) => void | Promise<void>;
}
```

Pass a custom machine with `openTaskList({ stateMachine })`. If omitted, the package uses `defaultStateMachine`, whose event names are `plan`, `start`, `complete`, and `archive`.

## Options

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | `"markdown-dir" \| "yaml-file"` | required | Selects the backend implementation. |
| `path` | `string` | required | Root directory for `markdown-dir` or YAML file path for `yaml-file`. |
| `defaults` | `TaskDefaults` | `{ metadata: {} }` | Seeds omitted metadata on new tasks only. New tasks always start at the configured state machine's initial state. |
| `create` | `boolean` | `false` | Creates missing storage for the selected backend when enabled. |
| `lockStaleMs` | `number` | `30_000` | Stale threshold passed to backend file locking. |
| `lockRetries` | `number` | `20` | Retry count passed to backend file locking. |
| `fs` | `TaskListFs` | `node:fs/promises` adapter | Injectable filesystem, primarily for tests. |
| `stateMachine` | `StateMachineDef` | `defaultStateMachine` | Overrides the task lifecycle used by `create`, `fire`, `canFire`, and `events`. |

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

await planning.fire("ship-readme", "plan");
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

await planning.fire("review-release", "plan");
await planning.fire("review-release", "start");
```

## Notes

The package never overwrites existing task files or store files. `defaults.metadata` is applied only when creating new tasks and does not retroactively update existing tasks.

Task state changes are event-driven: use `fire(id, event)` to move between states, `canFire(id, event)` to check whether an event is currently legal, and `events(id)` to list the currently legal event names. There is no `transition()` API.

`create()` always starts new tasks at `stateMachine.initial`. `update()` cannot change `state`; use `fire()` instead.
