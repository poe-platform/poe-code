---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft help agent readability

Make `poe-agent-tools --help` (and every toolcraft-built CLI) comprehensible at a glance — for agents reading piped plain text and for humans reading the colored TTY output.

Related: [toolcraft-help-detail.md](toolcraft-help-detail.md) (concise vs extended depth). This plan changes how rows render, not which rows appear.

## 1. Problems in the current output

Observed on `poe-agent-tools --help` and leaf `--help`:

1. **One flat color.** The entire left cell — command name, positionals, flags, value placeholders — is wrapped in `text.command()` as a single pre-joined string ([help-formatter.ts:253](../../packages/toolcraft-design/src/components/help-formatter.ts#L253), [cli.ts:1964](../../packages/toolcraft/src/cli.ts#L1964)). Nothing separates `create-api-bot` from its 60 flags.
2. **Unbounded lines.** `formatColumns` wraps only the description column; the left cell is normalized to one line and never wrapped. The `create-api-bot` row is a single ~4,600-character line. Piped to an agent this is one unreadable context-burning line; in a terminal it scrolls off screen.
3. **No collapse.** Group help inlines every optional, nested, and `<index>`-templated flag into the tree row. The row is a full API schema dump, not a directory entry.
4. **`required` reads as an enum value.** Leaf option descriptions render `(values: client_secret_supplied, internal_keystore, none, required)` — the trailing `required` marker is inside the values list.
5. **Echo descriptions.** `whoami — Whoami`, `create-api-bot — Create Api Bot`, `--plan.handle <value> — plan.handle`. Descriptions that restate the name are noise that agents still have to read.
6. **Required options are scattered.** In a 60-row leaf OPTIONS table the agent must scan every row for `(required)` to construct a minimal valid call.
7. **Group rows have no descriptions.** `api-bots`, `bot-actions`, `handles` render bare.
8. **No drill-down hint.** Nothing tells the reader that `poe-agent-tools <command> --help` exists.

## 2. Changes

Ordered by impact.

### 2.1 Collapse optional parameters in group rows

Group/tree command rows show: positionals, required flags, then a single collapsed token for the rest.

```text
create-api-bot --plan.handle <value> --plan.display-name <name> --plan.owner-handle <value>
  --plan.provider <value> --plan.provider-model-id <id> ... --access-reason <value>
  [+46 options]
                              Create Api Bot
```

- Required tokens always render inline (an agent can build a valid call from the group listing alone).
- Optional tokens collapse to `[+N options]`. `N` counts collapsed tokens, including `<index>`-templated families.
- Leaf `--help` is the full source of truth and is unchanged in coverage.
- Threshold: collapse only when the command has more than 8 optional tokens; below that, inline everything (current behavior). Applies identically to concise and extended depth.

### 2.2 Wrap the left cell

`formatColumns` wraps the left cell at the available width with a hanging indent (continuation lines align after the row indent + 2). No output line exceeds `totalWidth` regardless of TTY. Width math stays ANSI-aware via the existing `visibleWidth`.

### 2.3 Token colors (TTY only)

Style parameter tokens per role instead of painting the whole cell:

| Token | Style |
| --- | --- |
| command name (+aliases) | `text.command` — theme accent (unchanged) |
| positional `<botHandle>` | `text.argument` — muted |
| flag `--plan.handle` | `text.option` — yellow |
| value placeholder `<value>`, `<id>`, `<url>` | `text.argument` — muted |
| enum literals `private\|public` | default foreground |
| optional brackets `[` `]` and `[+N options]` | dim |

`formatCommandRowName` currently returns one flat string; it changes to return structured tokens (`{ text, role }[]`) that the formatter styles at render time. The plain (non-TTY), markdown, and JSON paths join tokens unstyled — layout and brackets carry all semantics without color, which is what agents actually receive.

Same roles apply to the leaf OPTIONS table left column (flag yellow, placeholder muted) and to the `Usage:` line.

### 2.4 Fix required/values rendering in leaf descriptions

`(required)` is its own trailing parenthetical, never inside the values list:

```text
--plan.api-bot-settings.api-key-reference.kind <value>
                            plan.api_bot_settings.api_key_reference.kind
                            (values: client_secret_supplied, internal_keystore, none) (required)
```

### 2.5 Required-first ordering in leaf OPTIONS

Leaf OPTIONS table lists positionals first, then required flags, then optional flags. Within each band, existing schema order is preserved. An agent reads the table top-down and stops when required ends to build a minimal call.

### 2.6 Drop echo descriptions

When a description is exactly the name (case/space/underscore-insensitive: `whoami`/`Whoami`, `create-api-bot`/`Create Api Bot`, `--plan.handle`/`plan.handle`), render an empty description. Applies to command rows and leaf option rows.

### 2.7 Group descriptions

Group rows take descriptions from the OpenAPI tag description when the group was generated from a tag and has no explicit description. Empty stays empty — no synthesized text.

### 2.8 Drill-down footer

Group help ends with a muted footer line after Options:

```text
Run poe-agent-tools <command> --help for full options.
```

## 3. Scope

- `packages/toolcraft-design` — `help-formatter.ts` (left-cell wrapping, token-role styling, footer), `text.ts` untouched (roles already exist).
- `packages/toolcraft` — `cli.ts` (`formatCommandRowName` → structured tokens, collapse rule, required-first ordering, echo-description suppression, required/values parenthetical split).
- `packages/toolcraft-openapi` — tag description → group description mapping.
- Snapshot tests per docs/SNAPSHOT_TESTING.md; verify visually with `npm run screenshot -- poe-agent-tools --help`.

## 4. Non-goals

- No change to which rows appear (owned by [toolcraft-help-detail.md](toolcraft-help-detail.md)).
- No change to MCP tool description generation.
- No new user-facing flags.
- No rewriting of OpenAPI-sourced descriptions beyond echo suppression.
- No README changes.
