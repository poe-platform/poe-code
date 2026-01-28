# Plan: Add `poe-code usage` Command

Add a `usage` command with two subcommands: `balance` and `list` to query the Poe Usage API.

## Dependencies

- **[console-table-printer](https://www.npmjs.com/package/console-table-printer)** (~52 kB) - Table rendering
- **[@clack/prompts](https://www.npmjs.com/package/@clack/prompts)** (lightweight, 2.5M weekly downloads) - Interactive pagination prompt

## API Endpoints

- **Balance**: `GET https://api.poe.com/usage/current_balance`
  - Returns: `{ current_point_balance: number }`

- **History**: `GET https://api.poe.com/usage/points_history`
  - Query params: `limit` (max 100, default 20), `starting_after` (cursor)
  - Returns: `{ has_more: boolean, length: number, data: UsageEntry[] }`

## Files to Create/Modify

| File | Action |
|------|--------|
| `package.json` | Modify - Add `console-table-printer` and `@clack/prompts` |
| `tests/usage-command.test.ts` | Create - TDD tests first |
| `src/cli/commands/usage.ts` | Create - Command implementation |
| `src/cli/program.ts` | Modify - Register command |

## Implementation Steps

### 1. Write Tests (`tests/usage-command.test.ts`)

Follow `query-command.test.ts` pattern with these test cases:

**Balance:**

- Fetches and displays current balance
- Throws error when no API key configured
- Logs dry run message when `--dry-run`

**List:**

- Fetches and displays usage history (20 entries per page)
- Prompts "Load more?" when `has_more` is true (uses cursor internally)
- Filters results client-side when `--filter` provided (case-insensitive match on model name)

Use `container.httpClient` mock (passed via `createProgram({ httpClient })`).

### 2. Create Command (`src/cli/commands/usage.ts`)

```typescript
export function registerUsageCommand(
  program: Command,
  container: CliContainer
): void {
  const usage = program
    .command("usage")
    .description("View Poe API usage and balance.");

  usage
    .command("balance")
    .description("Get current point balance.")
    .action(async function (this: Command) { ... });

  usage
    .command("list")
    .description("Get usage history.")
    .option("--filter <text>", "Filter by model name (case-insensitive)")
    .action(async function (this: Command) { ... });
}
```

Key patterns:

- Use `loadCredentials()` for API key
- Use `container.httpClient` for HTTP calls
- Use `resolveCommandFlags()` + `createExecutionResources()` for flags/logger
- Support `--dry-run` by checking `flags.dryRun`

### 3. Register Command (`src/cli/program.ts`)

Add import and registration:

```typescript
import { registerUsageCommand } from "./commands/usage.js";
// ...
registerUsageCommand(program, container);
```

## Output Formats

- **Table rendering** via `console-table-printer`
- **Human-readable timestamps** formatted as `YYYY-MM-DD HH:mm`

**Balance (human):**

```text
Current balance: 1,500 points
```

**List (human, interactive):**

```text
Usage History (20 entries)

┌──────────────────┬───────────────────┬───────┐
│ Date             │ Model             │ Cost  │
├──────────────────┼───────────────────┼───────┤
│ 2024-01-15 10:30 │ Claude-Sonnet-4.5 │   -50 │
│ 2024-01-15 09:15 │ gpt-5.2           │   -30 │
└──────────────────┴───────────────────┴───────┘

◆ Load more entries? (y/n)
```

When user confirms, fetch next page using cursor and append to table.

**List with filter (`--filter claude`):**

```text
Usage History (2 of 20 entries match "claude")

┌──────────────────┬───────────────────┬───────┐
│ Date             │ Model             │ Cost  │
├──────────────────┼───────────────────┼───────┤
│ 2024-01-15 10:30 │ Claude-Sonnet-4.5 │   -50 │
│ 2024-01-14 14:22 │ Claude-3-Opus     │  -120 │
└──────────────────┴───────────────────┴───────┘
```

## Commit

After tests pass: `feat(cli): add usage command with balance and list subcommands`
