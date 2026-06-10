# @poe-code/agent-maestro

## Env Vars

| Env var            | Used by                               | Behavior                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GH_HOST`          | `tasks.type: gh-issues`               | Overrides the GitHub GraphQL host used by the `gh-issues` task backend. Empty, unset, and `github.com` use `https://api.github.com/graphql`; any other value uses `https://<GH_HOST>/api/graphql`.                                     |
| `MAESTRO_GH_TOKEN` | turn-based GitHub Actions `gh-issues` | PAT or GitHub App token for the turn-based workflow template and `gh-issues` backend when configured as `tasks.auth.token: $MAESTRO_GH_TOKEN`. Use this instead of `GITHUB_TOKEN` when issue changes must trigger later workflow runs. |

`WORKFLOW.md` string config values can also reference environment variables with `$NAME`. The referenced name must contain only uppercase letters, digits, and `_`.

## Config

`WORKFLOW.md` frontmatter is the maestro config.

| Field       | Type   | Default                                                                                       | Behavior                                                                                                                   |
| ----------- | ------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tasks`     | object | required                                                                                      | Task-list backend config passed to `@poe-code/task-list`.                                                                  |
| `states`    | object | required                                                                                      | State map. States with `prompt` are active and dispatched; states with `terminal: true` stop work and clean up workspaces. |
| `polling`   | object | `{ interval_ms: 30000 }`                                                                      | Polling behavior.                                                                                                          |
| `workspace` | object | `{ root: "<os tmp>/poe-code-maestro" }`                                                       | Workspace allocation behavior.                                                                                             |
| `agent`     | object | `{ service: "codex", max_concurrent_agents: 1, max_turns: 20, max_retry_backoff_ms: 300000 }` | Agent dispatch behavior.                                                                                                   |

`tasks` fields:

| Field               | Backends                    | Type                                           | Default           | Behavior                                                                                                               |
| ------------------- | --------------------------- | ---------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `type`              | all                         | `"markdown-dir" \| "yaml-file" \| "gh-issues"` | required          | Selects the task-list backend.                                                                                         |
| `path`              | `markdown-dir`, `yaml-file` | string                                         | required          | Directory for `markdown-dir`; YAML file path for `yaml-file`. Relative paths resolve from the `WORKFLOW.md` directory. |
| `repo`              | `gh-issues`                 | string                                         | required          | GitHub repository as `owner/name`; issues are created and read from this repo.                                         |
| `project.owner`     | `gh-issues`                 | string                                         | required          | GitHub Project v2 owner.                                                                                               |
| `project.number`    | `gh-issues`                 | number                                         | required          | GitHub Project v2 number.                                                                                              |
| `defaults.metadata` | all                         | object                                         | `{}`              | Metadata applied only when creating new tasks.                                                                         |
| `create`            | `markdown-dir`, `yaml-file` | boolean                                        | `false`           | Creates missing local task storage when enabled.                                                                       |
| `singleList`        | `markdown-dir`              | string                                         | unset             | Treats the configured directory as one list with this list name.                                                       |
| `frontmatterMode`   | `markdown-dir`              | `"strict" \| "passthrough"`                    | `"strict"`        | Controls how Markdown task frontmatter is read and written.                                                            |
| `auth.token`        | `gh-issues`                 | string                                         | unset             | Explicit GitHub token. If omitted, the backend runs `gh auth token`.                                                   |
| `fs`                | `markdown-dir`, `yaml-file` | `TaskListFs`                                   | Node fs adapter   | SDK-only injectable filesystem.                                                                                        |
| `stateMachine`      | `markdown-dir`, `yaml-file` | `StateMachineDef`                              | task-list default | SDK-only custom task lifecycle.                                                                                        |
| `fetch`             | `gh-issues`                 | `typeof fetch`                                 | global `fetch`    | SDK-only fetch implementation.                                                                                         |

`agent` fields:

| Field                       | Type   | Default   | Behavior                                                                                     |
| --------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------- |
| `service`                   | string | `"codex"` | Default agent service for states that do not set `agent`.                                    |
| `service` for `ralph` tasks | string | ignored   | Ignored by the `ralph` workflow driver; ralph reads its agent from the plan doc frontmatter. |
| `list`                      | string | required  | Task list to poll. For `gh-issues`, this is `<project.owner>/<project.number>`.              |
| `max_concurrent_agents`     | number | `1`       | Maximum number of task workers running at once.                                              |
| `max_turns`                 | number | `20`      | Maximum turns passed to each spawned agent execution.                                        |
| `max_retry_backoff_ms`      | number | `300000`  | Maximum retry backoff after retryable failures.                                              |

State definition fields:

| Field      | Type                         | Default                  | Behavior                                                                                                                                |
| ---------- | ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`   | string                       | unset                    | Prompt template for this state. Presence makes the state active and eligible for dispatch.                                              |
| `agent`    | string                       | workflow `agent.service` | Agent service for this state. Falls back to the workflow-level `agent.service` when omitted.                                            |
| `model`    | string                       | agent runner default     | Model for this state. Falls back to the agent runner's default when omitted.                                                            |
| `mode`     | `"yolo" \| "edit" \| "read"` | `"yolo"`                 | Spawn mode for this state.                                                                                                              |
| `terminal` | boolean                      | `false`                  | Marks this state as terminal. Terminal states are not dispatched and their workspaces are removed.                                      |
| `gate`     | boolean                      | `false`                  | Marks a human approval gate. `poe-code tasks next` and `tasks set-state` will not cross or leave this state unless `--force` is passed. |

### Template variables

| Variable           | Behavior                                  |
| ------------------ | ----------------------------------------- |
| `task.id`          | Backend task id.                          |
| `task.qualifiedId` | List-qualified task id.                   |
| `task.url`         | Task URL. Renders empty on file backends. |
| `task.description` | Task artifact body.                       |
| `task.name`        | Task title.                               |
| `task.state`       | Current task state.                       |
| `task.metadata`    | Task metadata, JSON-stringified.          |
| `task.list`        | Task list name.                           |

`polling` fields:

| Field         | Type   | Default | Behavior                     |
| ------------- | ------ | ------- | ---------------------------- |
| `interval_ms` | number | `30000` | Delay between polling ticks. |

`workspace` fields:

| Field  | Type   | Default                       | Behavior                                                                                                                                   |
| ------ | ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `root` | string | `"<os tmp>/poe-code-maestro"` | Parent directory for per-task workspaces. Relative paths resolve from the `WORKFLOW.md` directory; `~` expands to the user home directory. |

## Artifact and transitions

On each poll, maestro dispatches tasks whose current state has a `prompt`.

The artifact is `task.description`.

Agents read the current artifact with `poe-code tasks get` and write it with `poe-code tasks set`. Use `poe-code tasks next` for the happy path. Use `poe-code tasks set-state` for explicit jumps. Use `poe-code tasks comment` for comments; comments are supported only by `gh-issues`.

Declaration order in `states:` is the happy path used by `poe-code tasks next`. Any state can transition to any other declared state.

## Workflow drivers

Agent maestro includes two built-in workflow drivers:

- `pipeline`: runs the prompt for the task's current state.
- `ralph`: runs plan-doc tasks through the ralph workflow driver.

The driver is selected from the task plan doc frontmatter `kind:` field. Tasks without `kind:` use the `pipeline` driver.

The `ralph` driver requires a file-backed task backend, such as `markdown-dir` or `yaml-file`. `gh-issues` tasks always use the `pipeline` driver.

## Turn-based mode

Turn-based mode runs one short-lived process per external event. Each invocation handles one transition and exits; no in-memory state is shared across invocations. Daemon mode is the existing long-running `poe-code maestro` process; see [Artifact and transitions](#artifact-and-transitions) and [Failure semantics](#failure-semantics) for daemon behavior.

Use turn-based mode for GitHub Actions, git hooks, and environments where a long-running process is unavailable or unwanted.

CLI:

```sh
poe-code maestro tick --task <id> --transition <from>:<to>
```

Flags:

| Flag                               | Required | Behavior                                                                      |
| ---------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `--task <qualifiedId>`             | yes      | Task id. Unqualified ids use `agent.list`; qualified ids must match it.       |
| `--transition <fromState:toState>` | yes      | External transition edge.                                                     |
| `--list <name>`                    | no       | Overrides `agent.list`; also inherited from parent `poe-code maestro --list`. |
| `--config <path>`                  | no       | Path to `WORKFLOW.md`. Defaults to `./WORKFLOW.md`.                           |

For GitHub Issues storage, use `tasks.type: gh-issues`; the backend is implemented in [packages/task-list/src/backends/gh-issues.ts](../task-list/src/backends/gh-issues.ts) and documented in [@poe-code/task-list](../task-list/README.md#gh-issues). Configure `tasks.repo`, `tasks.project.owner`, `tasks.project.number`, and usually `tasks.auth.token: $MAESTRO_GH_TOKEN` in GitHub Actions; see [Examples](#examples).

There are no time-based retries in turn-based mode. If you need retry backoff, run the daemon. Retries are in-memory only and are intentionally lost on restart in both modes.

GitHub Actions workflows triggered by `GITHUB_TOKEN` do not chain. Use a PAT or GitHub App token as `MAESTRO_GH_TOKEN` to keep issue-label transitions firing follow-up runs.

Workflow template: [packages/github-workflows/src/workflow-templates/maestro-turn.yml](../github-workflows/src/workflow-templates/maestro-turn.yml).

## Failure semantics

Shutdown aborts the active polling tick before waiting for it to finish. The runtime checks that signal before fetching candidates and between dispatches, so large ticks stop claiming new work promptly. Workers already dispatched by that tick are then aborted during shutdown.

Workspace cleanup failures are logged with `logger.warn` and are not surfaced as `MaestroEvent` records. Terminal cleanup from reconcile, retry-queue cleanup, normal worker exit, and shutdown all continue releasing in-memory state even if `removeWorkspace` fails.

Retry state is intentionally in memory only. A process restart loses scheduled retry attempts; after restart, eligible active tasks are discovered again by polling and start a new in-memory attempt sequence. Persisted retry state is out of scope for this package.

## Examples

`markdown-dir` `WORKFLOW.md`:

```md
---
tasks:
  type: markdown-dir
  path: ./tasks
  create: true
  frontmatterMode: passthrough
  singleList: plans
agent:
  service: codex
  list: plans
  max_concurrent_agents: 1
  max_turns: 20
  max_retry_backoff_ms: 300000
polling:
  interval_ms: 30000
workspace:
  root: ./.poe-code/maestro/workspaces
states:
  planned:
    prompt: |
      Work this task.

      {{ prompt }}
  done:
    terminal: true
  archived:
    terminal: true
---

{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
```

`yaml-file` `WORKFLOW.md`:

```md
---
tasks:
  type: yaml-file
  path: ./tasks.yaml
  create: true
agent:
  service: codex
  list: backlog
  max_concurrent_agents: 1
  max_turns: 20
  max_retry_backoff_ms: 300000
polling:
  interval_ms: 30000
workspace:
  root: ./.poe-code/maestro/workspaces
states:
  planned:
    prompt: |
      Implement the task.

      {{ prompt }}
    agent: claude-code
  review:
    prompt: |
      Review the task.

      {{ prompt }}
    mode: read
  done:
    terminal: true
---

{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
```

`gh-issues` `WORKFLOW.md`:

```md
---
tasks:
  type: gh-issues
  repo: octo-org/octo-repo
  project:
    owner: octo-org
    number: 7
  auth:
    token: $GITHUB_TOKEN
agent:
  service: codex
  list: octo-org/7
  max_concurrent_agents: 1
  max_turns: 20
  max_retry_backoff_ms: 300000
polling:
  interval_ms: 30000
workspace:
  root: ./.poe-code/maestro/workspaces
states:
  queued:
    prompt: |
      Work this issue.

      {{ prompt }}
  agent-running:
    prompt: |
      Continue this issue.

      {{ prompt }}
  human-review:
    terminal: true
  failed:
    terminal: true
  archived:
    terminal: true
  done:
    terminal: true
---

{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
```
