# @poe-code/agent-maestro

## Env Vars

| Env var | Used by | Behavior |
| --- | --- | --- |
| `GH_HOST` | `tasks.type: gh-issues` | Overrides the GitHub GraphQL host used by the `gh-issues` task backend. Empty, unset, and `github.com` use `https://api.github.com/graphql`; any other value uses `https://<GH_HOST>/api/graphql`. |

`WORKFLOW.md` string config values can also reference environment variables with `$NAME`. The referenced name must contain only uppercase letters, digits, and `_`.

## Config

`WORKFLOW.md` frontmatter is the maestro config.

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `tasks` | object | required | Task-list backend config passed to `@poe-code/task-list`. |
| `active_states` | string array | `["planned", "in-progress"]` | Task states eligible for dispatch. |
| `terminal_states` | string array | `["done", "archived"]` | Task states that stop work and clean up workspaces. |
| `polling` | object | `{ interval_ms: 30000 }` | Polling behavior. |
| `workspace` | object | `{ root: "<os tmp>/poe-code-maestro" }` | Workspace allocation behavior. |
| `agent` | object | `{ service: "codex", max_concurrent_agents: 1, max_turns: 20, max_retry_backoff_ms: 300000 }` | Agent dispatch behavior. |
| `step_overrides` | object | `{}` | Per-step overrides merged into `@poe-code/pipeline` step config. |

`tasks` fields:

| Field | Backends | Type | Default | Behavior |
| --- | --- | --- | --- | --- |
| `type` | all | `"markdown-dir" \| "yaml-file" \| "gh-issues"` | required | Selects the task-list backend. |
| `path` | `markdown-dir`, `yaml-file` | string | required | Directory for `markdown-dir`; YAML file path for `yaml-file`. Relative paths resolve from the `WORKFLOW.md` directory. |
| `repo` | `gh-issues` | string | required | GitHub repository as `owner/name`; issues are created and read from this repo. |
| `project.owner` | `gh-issues` | string | required | GitHub Project v2 owner. |
| `project.number` | `gh-issues` | number | required | GitHub Project v2 number. |
| `defaults.metadata` | all | object | `{}` | Metadata applied only when creating new tasks. |
| `create` | `markdown-dir`, `yaml-file` | boolean | `false` | Creates missing local task storage when enabled. |
| `singleList` | `markdown-dir` | string | unset | Treats the configured directory as one list with this list name. |
| `frontmatterMode` | `markdown-dir` | `"strict" \| "passthrough"` | `"strict"` | Controls how Markdown task frontmatter is read and written. |
| `lockStaleMs` | `markdown-dir`, `yaml-file` | number | `30000` | Stale threshold for local file locks. |
| `lockRetries` | `markdown-dir`, `yaml-file` | number | `20` | Retry count for local file locks. |
| `auth.token` | `gh-issues` | string | unset | Explicit GitHub token. If omitted, the backend runs `gh auth token`. |
| `fs` | `markdown-dir`, `yaml-file` | `TaskListFs` | Node fs adapter | SDK-only injectable filesystem. |
| `stateMachine` | `markdown-dir`, `yaml-file` | `StateMachineDef` | task-list default | SDK-only custom task lifecycle. |
| `fetch` | `gh-issues` | `typeof fetch` | global `fetch` | SDK-only fetch implementation. |

`agent` fields:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `service` | string | `"codex"` | Default agent service for steps that do not set `agent` in `steps.yaml` or `step_overrides`. |
| `list` | string | required | Task list to poll. For `gh-issues`, this is `<project.owner>/<project.number>`. |
| `max_concurrent_agents` | number | `1` | Maximum number of task workers running at once. |
| `max_turns` | number | `20` | Maximum turns passed to each spawned agent execution. |
| `max_retry_backoff_ms` | number | `300000` | Maximum retry backoff after retryable failures. |

`polling` fields:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `interval_ms` | number | `30000` | Delay between polling ticks. |

`workspace` fields:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `root` | string | `"<os tmp>/poe-code-maestro"` | Parent directory for per-task workspaces. Relative paths resolve from the `WORKFLOW.md` directory; `~` expands to the user home directory. |

`active_states` fields:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `active_states` | string array | `["planned", "in-progress"]` | States the daemon treats as runnable or still active. |

`terminal_states` fields:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `terminal_states` | string array | `["done", "archived"]` | States the daemon treats as complete, canceled, or otherwise no longer runnable. |

`step_overrides` fields:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `step_overrides.<step>.mode` | `"yolo" \| "edit" \| "read"` | step config value | Overrides the step execution mode. |
| `step_overrides.<step>.prompt` | string | step config value | Overrides the step prompt template. |
| `step_overrides.<step>.agent` | string | step config value | Overrides the agent service for that step. |
| `step_overrides.<step>.model` | string | step config value | Overrides the model for that step. |

Step definitions are loaded from `.poe-code/pipeline/steps.yaml` or `~/.poe-code/pipeline/steps.yaml`; see the `@poe-code/pipeline` README for the `steps.yaml` schema.

## Examples

`markdown-dir` `WORKFLOW.md`:

```md
---
tasks:
  type: markdown-dir
  path: ./tasks
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
active_states:
  - planned
  - in-progress
terminal_states:
  - done
  - archived
step_overrides: {}
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
active_states:
  - planned
  - in-progress
terminal_states:
  - done
  - archived
step_overrides:
  implement:
    mode: yolo
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
active_states:
  - queued
  - agent-running
terminal_states:
  - human-review
  - failed
  - archived
  - done
step_overrides:
  review:
    mode: read
    agent: codex
---
{{ task.qualifiedId }}: {{ task.name }}

{{ task.description }}
```
