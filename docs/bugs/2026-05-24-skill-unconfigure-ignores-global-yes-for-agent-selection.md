# Skill unconfigure ignores global yes for agent selection

## Summary

Running `skill unconfigure` with the root `--yes` option and an explicit scope still opens an interactive agent-selection prompt instead of accepting a default non-interactively.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint in a terminal

## Reproduction

From the repository root, run a dry-run removal preview in a disposable project while requesting default acceptance:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes skill unconfigure --local
)
```

Replace `/path/to/poe-code` with the repository checkout path. The prompt can be cancelled without making filesystem changes.

## Observed Behavior

The command blocks on an interactive prompt despite `--yes`:

```text
Select agent to unconfigure:
  claude-code
  codex
  gemini-cli
  opencode
  goose
```

## Expected Behavior

The root `--yes` option is documented as accepting defaults for prompts. With `--yes --local`, `skill unconfigure` should choose its default agent without prompting, or reject omission of the required agent non-interactively if removal has no safe default.

## Impact

- CI and scripts using `--yes` can hang waiting for terminal interaction.
- The configure and unconfigure skill experiences behave inconsistently under the same global flag.
- Dry-run automation cannot preview skill removal without explicitly supplying an agent.

## Supporting Evidence

The root CLI exposes `--yes` as `Accept defaults without prompting.` in `src/cli/program.ts`. In `src/cli/commands/skill.ts`, `skill configure` falls back to `claude-code` when `flags.assumeYes` is true, but `skill unconfigure` enters `select(...)` whenever no configured or explicit agent is present, without consulting `flags.assumeYes`.

## Suspected Area

Skill unconfiguration needs explicit non-interactive behavior for omitted agent and scope selection when global `--yes` is present.
