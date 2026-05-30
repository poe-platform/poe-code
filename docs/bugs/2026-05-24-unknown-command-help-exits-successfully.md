---
name: "Unknown commands followed by `--help` exit successfully"
---

# Unknown commands followed by `--help` exit successfully

## Summary

When an unknown command or subcommand is followed by `--help`, `poe-code` displays help for the nearest valid command and exits with status `0` instead of reporting that the command does not exist. This hides typos in manual use and makes scripts unable to distinguish invalid command paths from valid help requests.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run:

```sh
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts spwan --help
echo $?
```

The typo `spwan` is intentional.

The defect is also reproducible for nested command groups:

```sh
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts mcp nope --help
echo $?

npx tsx --import ./scripts/register-template-loader.mjs src/index.ts skill nope --help
echo $?
```

## Observed Behavior

- `spwan --help` renders the root `Poe - poe-code` help page and exits `0`.
- `mcp nope --help` renders the valid `Poe - mcp` help page and exits `0`.
- `skill nope --help` renders the valid `Poe - skill` help page and exits `0`.
- None of these invocations mention the invalid command token.

For comparison, omitting `--help` correctly rejects the invalid command:

```sh
npx tsx --import ./scripts/register-template-loader.mjs src/index.ts spwan
echo $?
```

This prints `Unknown command: spwan` and exits `1`.

## Expected Behavior

An invalid command path must remain an error even when `--help` is also present. Each reproduction above should report the unknown token and return a non-zero exit status, optionally suggesting the appropriate parent help command.

## Impact

- Mistyped help lookups look successful and provide misleading documentation.
- Shell scripts that validate available commands via `--help` treat nonexistent commands as installed features.
- Nested extension points such as `mcp` and `skill` cannot reliably validate requested subcommands.

## Evidence in Current Tests

Existing tests cover unknown commands without `--help` in `src/cli/commands/misc-commands.test.ts`, including the root and nested `mcp` paths. The reproductions above show that adding `--help` bypasses that error behavior.

## Suspected Area

The root command registers unknown-command handling in `src/cli/program.ts`, while Commander's help option is evaluated before the unknown argument is routed through that handler. Nested command groups exhibit the same precedence issue.
