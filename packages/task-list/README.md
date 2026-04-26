# @poe-code/task-list

Multi-list task management library.

## Environment Variables

None.

## openTaskList Options

| option | type | default | meaning |
| --- | --- | --- | --- |
| `type` | `"markdown-dir" \| "yaml-file"` | required | backend selector |
| `path` | `string` | required | root directory or YAML file path |
| `defaults` | `TaskDefaults` | `{ state: "draft", metadata: {} }` | defaults applied when creating tasks |
| `create` | `boolean` | `false` | let the backend create missing storage |
| `lockStaleMs` | `number` | `30000` | stale lock threshold |
| `lockRetries` | `number` | `20` | lock retry count |
| `fs` | `TaskListFs` | node `fs/promises` | injectable filesystem for tests |
