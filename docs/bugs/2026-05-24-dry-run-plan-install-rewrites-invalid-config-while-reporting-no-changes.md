# Dry-run plan install rewrites invalid config while reporting no changes

## Summary

Running `plan install` with `--dry-run --yes` and no explicit agent rewrites malformed global configuration while resolving the default agent, then reports `# no filesystem changes`. The invalid config is replaced with `{}` and copied to a backup file.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home with malformed configuration and preview local plan-skill installation:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes plan install --local
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command previews creation of `.claude/skills/poe-code-plan/SKILL.md` and prints:

```text
# no filesystem changes
```

However, the disposable home is changed:

- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original invalid input.

## Expected Behavior

With `--dry-run`, plan skill installation must not rewrite configuration while resolving defaults, and it must not claim no filesystem changes after any persisted recovery write.

## Impact

- Users receive false assurance while their global configuration is altered.
- Previewing a local skill install can replace malformed config before explicit repair consent.
- Automation cannot safely rely on dry-run install output to prove a clean home directory.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/plan.ts` resolves the install agent using `resolveDefaultAgent` when `--agent` is omitted, and invalid-document recovery in `packages/poe-code-config/src/store.ts` writes replacement and backup files during that read.

## Suspected Area

Dry-run installer default resolution needs read-only configuration handling, and reported filesystem operations must include recovery side effects.
