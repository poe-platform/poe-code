# Dry-run superintendent install writes skill and plan directory

## Summary

Running `superintendent install` with the root `--dry-run` option still installs the local skill file and creates the shared plan directory. The command reports installation as completed rather than rendering a non-mutating preview.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run the forwarded installer in a clean disposable project:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run superintendent install claude-code --scope local
)

find "$probe/project" -maxdepth 5 -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and reports `Installed Superintendent skill for claude-code (local).` and `Created: docs/plans`.
- The command creates `.claude/skills/poe-code-superintendent-plan/SKILL.md` in the disposable project.
- The command creates `docs/plans` in the disposable project.

## Expected Behavior

With root `--dry-run`, `superintendent install` must not write the skill file or create directories. It should only describe the files and directories that would be installed.

## Impact

- Users cannot safely preview superintendent installation changes.
- Running an advertised non-mutating mode introduces new tracked or untracked project content.
- Automation that uses root dry-run as a safety gate still installs workflow assets.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `superintendent` is registered as a forwarded Toolcraft command in that file, while `packages/superintendent/src/commands/install.ts` performs `installSkill` and `mkdir` writes without accepting or checking a dry-run parameter.

## Suspected Area

Forwarded Toolcraft commands need root execution flags propagated to command handlers, and mutating superintendent actions need explicit dry-run handling.
