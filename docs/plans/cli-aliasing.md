# CLI Aliasing and Shorthand Commands

Add a `poe` top-level binary alias and single-letter command shorthands.

## Motivation

`poe-code` is verbose for daily use. short aliases are common in package managers — we want the same ergonomics.

## Binary alias: `poe`

Add `"poe": "dist/bin.cjs"` to `package.json` `bin` field.

Update `execution-context.ts`:

- `formatCliUsageCommand` global mode returns `"poe"` (not `"poe-code"`)
- `program.name("poe-code")` stays as-is internally for commander (backwards compat)
- The `formatHelpText` heading changes to `"Poe"` when invoked as `poe`

Decision: `poe-code` remains a valid binary (both work). `poe` is the short form, not a replacement.

## Command aliases

Use commander's built-in `.alias()` / `.aliases()` on each command.

### Alias map

| Command       | Alias(es) |
|---------------|-----------|
| install       | i         |
| configure     | c         |
| unconfigure   | uc        |
| spawn         | s         |
| wrap          | w         |
| models        | m         |
| usage         | u         |
| generate      | g         |

NOT aliased (low frequency, ambiguous, or compound): `login`, `logout`, `auth`, `mcp`, `skill`, `pipeline`, `ralph`, `utils`, `agent`, `research`.

### Implementation

Each `register*Command` already returns the `Command` object. Add `.alias()` call:

```typescript
// install.ts
return program
  .command("install")
  .alias("i")
  .description("Install tooling for a configured agent.")
  // ...
```

Commander handles alias resolution automatically — unknown command detection, help, and parsing all work.

## Help text changes

### Root help (`formatHelpText`)

Show alias inline with command name:

```
Commands:
  install, i       [agent]          Install tooling for a configured agent
  configure, c     [agent]          Configure a coding agent
  unconfigure, uc  <agent>          Remove a previously applied configuration
  spawn, s         <agent> [prompt] Launch a coding agent
  ...
```

Update `commandRows` to include an `aliases` field:

```typescript
const commandRows: Array<{
  name: string;
  aliases: string[];
  args: string;
  description: string;
}> = [
  { name: "install", aliases: ["i"], args: "[agent]", description: "..." },
  // ...
];
```

Render as `name, alias1, alias2` in the name column:

```typescript
const displayName = [row.name, ...row.aliases].join(", ");
```

### Subcommand help (`formatSubcommandHelp`)

Commander's `Help` class already renders aliases when `.alias()` is used. The `commandUsage()` output includes them. No custom work needed — verify with a screenshot.

### Command-not-found

`throwCommandNotFound` uses `showSuggestionAfterError(true)` — commander's built-in suggestion engine already considers aliases. No changes needed.

## Execution context

Update `formatCliUsageCommand` to prefer `poe` for global mode:

```typescript
case "global":
  return "poe";
```

This affects: help text, MCP server config output, error messages. All become shorter.

`poe-code` continues to work — it's still in `bin`. We just prefer `poe` in output.

## File changes

| File | Change |
|------|--------|
| `package.json` | Add `"poe": "dist/bin.cjs"` to `bin` |
| `src/cli/commands/install.ts` | Add `.alias("i")` |
| `src/cli/commands/configure.ts` | Add `.alias("c")` |
| `src/cli/commands/unconfigure.ts` | Add `.alias("uc")` |
| `src/cli/commands/spawn.ts` | Add `.alias("s")` |
| `src/cli/commands/wrap.ts` | Add `.alias("w")` |
| `src/cli/commands/models.ts` | Add `.alias("m")` |
| `src/cli/commands/usage.ts` | Add `.alias("u")` |
| `src/cli/commands/generate.ts` | Add `.alias("g")` |
| `src/cli/program.ts` | Update `formatHelpText` to show aliases inline |
| `src/utils/execution-context.ts` | Return `"poe"` for global mode |
| `src/cli/binary-aliases.ts` | No change (wrap binaries stay `poe-*`) |

## Testing

1. Unit tests for `formatHelpText` — verify alias display in command rows
2. Unit tests for `execution-context.ts` — verify `"poe"` output
3. Screenshot: `bun run screenshot-poe-code -- --help` — verify layout with aliases
4. Screenshot: `bun run screenshot-poe-code -- install --help` — verify subcommand alias display
5. Spot test: `bun run dev -- i codex` — verify alias resolution works

## Implementation order

1. Add `.alias()` to all command registrations (mechanical, one-liner each)
2. Update `formatHelpText` to render aliases inline
3. Add `"poe"` to `package.json` bin
4. Update `execution-context.ts` global mode to `"poe"`
5. Update affected tests
6. Screenshot verification
