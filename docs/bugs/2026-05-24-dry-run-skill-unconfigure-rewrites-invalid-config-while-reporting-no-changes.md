# Dry-run skill unconfigure rewrites invalid config while reporting no changes

## Summary

Running `skill unconfigure` with `--dry-run`, no explicit agent, and malformed global configuration rewrites the configuration during agent selection, then reports `# no filesystem changes` after the user selects an agent.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint in a terminal

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview local skill removal:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run skill unconfigure --local
)
```

Select the initially highlighted `claude-code` option, then inspect the temporary home:

```sh
find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command opens the agent selector, previews removal for `claude-code`, and prints `# no filesystem changes`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, skill unconfiguration must not persist configuration repairs while selecting an agent or rendering removal previews.

## Impact

- An apparently safe removal preview silently mutates global configuration.
- Output directly contradicts the filesystem mutation.
- Users can lose malformed configuration at its original path before selecting whether to remove any skill files.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/skill.ts` calls `resolveDefaultAgent` before presenting the agent selector when no argument is supplied, and invalid-document recovery reached through shared config resolution in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Skill unconfigure previews need side-effect-free default-agent lookup, and dry-run reporting must include configuration recovery effects.
