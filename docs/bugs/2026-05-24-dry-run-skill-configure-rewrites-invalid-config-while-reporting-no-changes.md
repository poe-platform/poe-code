# Dry-run skill configure rewrites invalid config while reporting no changes

## Summary

Running `skill configure` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while resolving the default agent, then reports `# no filesystem changes`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview local skill configuration:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes skill configure --local
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command previews creating the skill directory and bundled skill files for `claude-code`, then prints `# no filesystem changes`.
- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the malformed original.

## Expected Behavior

With `--dry-run`, skill configuration previews must not persist repairs to global configuration while resolving default choices or listing proposed filesystem operations.

## Impact

- A skill installation preview silently mutates global configuration.
- The output directly contradicts the command's filesystem changes.
- Tooling that previews skill setup can alter user state unexpectedly.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/skill.ts` calls `resolveDefaultAgent` when the agent argument is omitted, before invoking dry-run-aware skill configuration, and invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files.

## Suspected Area

Skill previews need side-effect-free default-agent resolution, and dry-run mutation reporting must include configuration recovery paths.
