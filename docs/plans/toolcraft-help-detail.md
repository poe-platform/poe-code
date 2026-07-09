---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft help detail (concise vs extended)

Tool-level config for `--help` depth: concise (direct children only) or extended (every nested action).

## 1. What we're building

Toolcraft group `--help` should support two output depths:

- **concise** — current behavior: list only direct child commands/groups for the help target
- **extended** — list every nested action under the help target (full tree of commands)

This is **tool-level config** on the CLI author surface (`runCLI` options / `CLIControls`-style), not a new end-user flag. Different tools can choose concise or extended; the **default is extended**.

Leaf command help (options, secrets, examples) is unchanged. JSON group help follows the same depth config as human help.

### Non-goals

- No new user-facing `--full-help` / `--help=full` flag unless later requested
- No change to leaf option tables, secrets, or examples sections
- No change to MCP tool description generation
- No change to `createCLICommandTreeSnapshot` schema (already full tree, independent of help layout)
- No README updates without explicit permission

## 2. User-facing shape

### Author config

```ts
await runCLI(root, {
  controls: {
    help: "extended" // default when omitted
    // help: "concise"
  }
});
```

`CLIControls.help` is `"concise" | "extended"`. Omitted → `"extended"`.

This is author-only. End users do not pass a help-depth flag.

### Concise group help (opt-in)

Current behavior preserved when `controls.help === "concise"`.

```text
toolcraft

Usage: toolcraft [command] [OPTIONS]

Commands
  calendar                                   Google Calendar events.
  asana                                      Asana tasks.

Options:
  --output <rich|md|markdown|json>
```

Only direct children of the help target. Nested groups are not expanded.

### Extended group help (default)

Same heading / usage / options sections. The Commands section is an indented tree of every visible nested action under the help target.

```text
toolcraft

Usage: toolcraft [command] [OPTIONS]

Commands
  calendar                                   Google Calendar events.
    events
      list                                   List calendar events
    meeting
      create                                 Create meeting
  asana                                      Asana tasks.
    list-tasks [--section <value>] ...       List tasks
    details --task-gid <value>               Get task details

Options:
  --output <rich|md|markdown|json>
```

Rules for the tree:

- Depth 0 rows are direct children (same as concise).
- Nested rows indent by 2 spaces per level.
- Group rows keep group name + description; they do not get parameter tokens.
- Command rows keep existing name formatting: aliases, inline parameter tokens, description.
- Hidden commands stay omitted; non-CLI-scoped nodes stay omitted.
- Help for a nested group (`toolcraft calendar --help`) still only walks that group's subtree, not the whole tool.
- Empty groups still appear as group rows so the path remains visible.

### Leaf help

Unchanged for both modes:

```text
toolcraft asana details — Get task details

Usage: toolcraft asana details [OPTIONS]

Options
  --task-gid <value>                         taskGid (required)
```

### JSON help (`--help --output json`)

Follows the same control:

**concise** — `commands` is direct children only (current shape).

**extended** — `commands` is a preorder tree of the full subtree. Each entry includes relative path depth so consumers can rebuild nesting without inventing layout:

```json
{
  "schemaVersion": 1,
  "kind": "group",
  "name": "toolcraft",
  "path": [],
  "usage": "toolcraft [command] [OPTIONS]",
  "commands": [
    { "name": "calendar", "description": "Google Calendar events.", "kind": "group", "depth": 0 },
    { "name": "events", "description": "", "kind": "group", "depth": 1 },
    { "name": "list", "description": "List calendar events", "kind": "command", "depth": 2 },
    { "name": "meeting", "description": "", "kind": "group", "depth": 1 },
    { "name": "create", "description": "Create meeting", "kind": "command", "depth": 2 }
  ],
  "options": []
}
```

Concise rows omit `kind` / `depth` only if we keep exact current JSON shape for concise mode; extended always includes them. Prefer always including `kind` + `depth` in both modes for one schema (depth is always `0` in concise).

### Migration for tool authors

Default flips from today's concise layout to extended. Tools that want the old surface set:

```ts
controls: { help: "concise" }
```

No end-user migration. Snapshots / agents that scrape human help text may see more lines under Commands.
