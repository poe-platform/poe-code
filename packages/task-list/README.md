# @poe-code/task-list

Multi-list task manager with pluggable storage backends.

## Backends

`@poe-code/task-list` exposes one API over these backends:

| Backend        | Storage                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `markdown-dir` | One Markdown file per task, organized into subdirectories per list.                                  |
| `yaml-file`    | One YAML document with a top-level `lists:` mapping.                                                 |
| `gh-issues`    | GitHub Issues in one repository, ordered and state-tracked through a GitHub Project v2 Status field. |

The task lifecycle is `draft -> planned -> in-progress -> done -> archived`. `archived` is terminal.

## Public API

- `openTaskList(options)`: opens a task store and returns a `TaskList`
- `TaskList`: top-level interface for listing lists, querying all tasks, and resolving qualified IDs
- `Tasks`: per-list interface for create, update, `fire`, `canFire`, `events`, delete, `move`, `reorder`, and list operations
- `Task`: normalized task record with `list`, `id`, `qualifiedId`, `name`, `state`, `description`, and `metadata`
- `TaskState`: `"draft" | "planned" | "in-progress" | "done" | "archived"`
- `TaskDefaults`: default `metadata` applied when creating new tasks
- `StateMachineDef` / `EventDef`: exported types for custom task lifecycle definitions passed via `openTaskList({ stateMachine })`
- `defaultStateMachine`: exported default lifecycle with `plan`, `start`, `complete`, and `archive` events
- Error classes: `TaskNotFoundError`, `TaskAlreadyExistsError`, `InvalidTransitionError`, `MalformedTaskError`, `OrderMismatchError`, `AnchorNotFoundError`

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

## Configuration Options

| Option            | Type                                           | Default                    | Behavior                                                                                                          |
| ----------------- | ---------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `type`            | `"markdown-dir" \| "yaml-file" \| "gh-issues"` | required                   | Selects the backend implementation.                                                                               |
| `path`            | `string`                                       | required                   | Root directory for `markdown-dir` or YAML file path for `yaml-file`.                                              |
| `defaults`        | `TaskDefaults`                                 | `{ metadata: {} }`         | Seeds omitted metadata on new tasks only. New tasks always start at the configured state machine's initial state. |
| `create`          | `boolean`                                      | `false`                    | Creates missing storage for the selected backend when enabled.                                                    |
| `singleList`      | `string`                                       | unset                      | `markdown-dir` only. Treats `path` as one list with this name instead of one subdirectory per list.               |
| `frontmatterMode` | `"strict" \| "passthrough"`                    | `"strict"`                 | `markdown-dir` only. `passthrough` preserves non-task frontmatter and allows files without a frontmatter block.   |
| `fs`              | `TaskListFs`                                   | `node:fs/promises` adapter | Injectable filesystem, primarily for tests.                                                                       |
| `stateMachine`    | `StateMachineDef`                              | `defaultStateMachine`      | Overrides the task lifecycle used by `create`, `fire`, `canFire`, and `events`.                                   |

## Environment Variables

| Env var   | Behavior                                                        |
| --------- | --------------------------------------------------------------- |
| `GH_HOST` | Defers to gh CLI's host configuration; set GH_HOST to override. |

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

By default, `markdown-dir` stores tasks as `<path>/<list>/<nn-id>.md`. Set `singleList` to treat the root directory as one list, which is how plan folders such as `docs/plans` are exposed through the task API:

```ts
const plans = await openTaskList({
  type: "markdown-dir",
  path: "/repo/docs/plans",
  singleList: "plans",
  frontmatterMode: "passthrough"
});

await plans.list("plans").reorder(["api-shape-providers", "memory"]);
```

`frontmatterMode: "strict"` expects full task frontmatter (`kind`, `version`, `name`, `state`, and related task fields). `frontmatterMode: "passthrough"` keeps unrelated frontmatter keys as task metadata and writes back only the task-owned fields (`name`, `description`, `state`), so existing plan metadata is preserved.

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

### `gh-issues`

```ts
import { openTaskList } from "@poe-code/task-list";

const taskList = await openTaskList({
  type: "gh-issues",
  repo: "octo-org/octo-repo",
  project: {
    owner: "octo-org",
    number: 7
  }
});

const project = taskList.list("octo-org/7");

await taskList.lists(); // ["octo-org/7"]

const created = await project.create({
  id: "local-id-is-ignored",
  name: "Review release checklist"
});

await project.fire(created.id, "In Progress");
await project.move(created.id, { position: "top" });
await project.move(created.id, { after: "42" });
```

`gh-issues` exposes one list named `${project.owner}/${project.number}`. `create()` ignores `TaskCreate.id` because GitHub assigns issue numbers. `fire(state)` writes the Project v2 `Status` field to the matching single-select option. `move()` reorders project items.

If the GitHub Project v2 board has not been set up manually, run `poe-code tasks sync <list>` before opening the backend. `openTaskList({ type: "gh-issues" })` no longer requires manual board setup when the board was provisioned with `tasks sync` first.

## Verifying and provisioning the GitHub Project v2 board

Use `verifyGhProject` to check whether a GitHub Project v2 board has the required Project and `Status` single-select options:

```ts
import { verifyGhProject } from "@poe-code/task-list";

const report = await verifyGhProject({
  owner: "octo-org",
  number: 7,
  requiredStates: ["queued", "agent-running", "human-review", "done", "failed", "archived"],
  auth: { token: "github-token" }
});
```

`VerifyGhProjectOptions` has this shape:

```ts
interface VerifyGhProjectOptions {
  owner: string;
  number: number;
  requiredStates: readonly string[];
  client?: GhClient;
  fetch?: typeof fetch;
  auth?: { token: string };
}
```

`verifyGhProject` returns `Promise<VerifyGhProjectReport>`:

```ts
interface VerifyGhProjectReport {
  ok: boolean;
  project: { id: string; number: number; owner: string } | null;
  statusField: { id: string; options: readonly string[] } | null;
  missingProject: boolean;
  missingStatusField: boolean;
  missingOptions: readonly string[];
}
```

Use `syncGhProject` to provision anything missing:

```ts
import { syncGhProject } from "@poe-code/task-list";

const report = await syncGhProject({
  owner: "octo-org",
  number: 7,
  requiredStates: ["queued", "agent-running", "human-review", "done", "failed", "archived"],
  title: "Delivery Board",
  yes: true,
  auth: { token: "github-token" }
});
```

`SyncGhProjectOptions` extends `VerifyGhProjectOptions`:

```ts
interface SyncGhProjectOptions extends VerifyGhProjectOptions {
  title?: string;
  yes?: boolean;
}
```

`syncGhProject` returns `Promise<SyncGhProjectReport>`:

```ts
interface SyncGhProjectReport extends VerifyGhProjectReport {
  created: readonly string[];
  updated: readonly string[];
}
```

The root CLI exposes verification, provisioning, and task mutation commands:

```sh
poe-code tasks verify <list> --workflow ./WORKFLOW.md --repo octo-org/octo-repo --project octo-org/7 --states queued,agent-running,human-review,done,failed,archived --json
poe-code tasks sync <list> --workflow ./WORKFLOW.md --repo octo-org/octo-repo --project octo-org/7 --states queued,agent-running,human-review,done,failed,archived --json --yes
```

`<list>` and `--project` both use `<owner>/<number>` project syntax. `--workflow` defaults to `./WORKFLOW.md`. `--repo` overrides the task repository from workflow frontmatter. `--states` overrides the required state list from workflow frontmatter. `--json` prints the report object as JSON. `--yes` confirms non-interactive sync; it is only used by `poe-code tasks sync`.

| Option                     | Commands         | Behavior                                            |
| -------------------------- | ---------------- | --------------------------------------------------- |
| `--workflow <path>`        | `verify`, `sync` | Workflow file path. Defaults to `./WORKFLOW.md`.    |
| `--repo <owner/name>`      | `verify`, `sync` | GitHub repository owner/name.                       |
| `--project <owner/number>` | `verify`, `sync` | GitHub Project v2 owner/number. Overrides `<list>`. |
| `--states <csv>`           | `verify`, `sync` | Required task state names.                          |
| `--json`                   | `verify`, `sync` | Prints the report as JSON.                          |
| `--yes`                    | `sync`           | Confirms non-interactive provisioning.              |

Additional task backend commands:

| Command                                 | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `poe-code tasks move`                   | Move tasks between workflow-configured backends.      |
| `poe-code tasks import`                 | Import Markdown task files into a configured backend. |
| `poe-code tasks get <id>`               | Read one task.                                        |
| `poe-code tasks set <id>`               | Update one task.                                      |
| `poe-code tasks set-state <id> <state>` | Set one task's state.                                 |
| `poe-code tasks next <id>`              | Advance one task to the next workflow state.          |
| `poe-code tasks comment <id>`           | Add a task comment when the backend supports it.      |

The `Status` field name and option names are matched case-sensitively. The field must be named `Status`, and required option names must match exactly. For example, `status` is treated as a missing field, and `Done` is treated as missing when the required state is `done`.

In v1, if sync creates a new GitHub Project v2 board, the CLI prints the new project number and does not rewrite `WORKFLOW.md`. The operator must update `WORKFLOW.md` by hand with the printed `<owner>/<number>`.

## Notes

The package never overwrites existing task files or store files. `defaults.metadata` is applied only when creating new tasks and does not retroactively update existing tasks.

Task state changes are event-driven: use `fire(id, event)` to move between states, `canFire(id, event)` to check whether an event is currently legal, and `events(id)` to list the currently legal event names. There is no `transition()` API.

`create()` always starts new tasks at `stateMachine.initial`. `update()` cannot change `state`; use `fire()` instead.

### `gh-issues` limitations

- The state machine is fetched at open and frozen for the session; re-open to refresh project Status options.
- `archived` is not supported and returns an empty result.
- `update()` does not write labels, assignees, or milestone in v1.
- `moveBetweenLists()` is unsupported on `gh-issues`.
- `id` on `TaskCreate` is ignored on this backend.
- `gh auth token` must be available, or pass `auth: { token }`.
