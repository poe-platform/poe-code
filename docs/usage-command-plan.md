# Plan: Add `poe-code usage` Command

Add a `usage` command with two subcommands: `balance` and `list` to query the Poe Usage API.

## API Endpoints

- **Balance**: `GET https://api.poe.com/usage/current_balance`
  - Returns: `{ current_point_balance: number }`

- **History**: `GET https://api.poe.com/usage/points_history`
  - Query params: `limit` (max 100, default 20), `starting_after` (cursor)
  - Returns: `{ has_more: boolean, length: number, data: UsageEntry[] }`

## Files to Create/Modify

| File | Action |
|------|--------|
| `tests/usage-command.test.ts` | Create - TDD tests first |
| `src/cli/commands/usage.ts` | Create - Command implementation |
| `src/cli/program.ts` | Modify - Register command |

## Implementation Steps

### 1. Write Tests (`tests/usage-command.test.ts`)

Follow `query-command.test.ts` pattern with these test cases:

**Balance:**

- Fetches and displays current balance
- Outputs JSON when `--json` flag provided
- Throws error when no API key configured
- Logs dry run message when `--dry-run`

**List:**

- Fetches and displays usage history
- Respects `--limit` option
- Passes `--starting-after` for pagination
- Outputs JSON when `--json` flag provided

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
    .option("--json", "Output as JSON")
    .action(async function (this: Command) { ... });

  usage
    .command("list")
    .description("Get usage history.")
    .option("--limit <n>", "Entries to fetch (max 100)", "20")
    .option("--starting-after <cursor>", "Pagination cursor")
    .option("--json", "Output as JSON")
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

- **Minimal output** for human-readable mode (date, model, cost only)
- **Human-readable timestamps** formatted as `YYYY-MM-DD HH:mm`
- Full JSON response when `--json` is used

**Balance (human):**

```text
Current balance: 1,500 points
```

**List (human):**

```text
Usage History (20 entries)

DATE              MODEL               COST
2024-01-15 10:30  Claude-Sonnet-4.5    -50
2024-01-15 09:15  gpt-5.2              -30

More results available. Use --starting-after=<query_id>
```

**JSON modes:** Output raw API response as-is.

## Commit

After tests pass: `feat(cli): add usage command with balance and list subcommands`
