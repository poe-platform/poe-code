# Dry-run logout rewrites invalid config while reporting no filesystem changes

## Summary

Running `logout` with `--dry-run` rewrites a malformed global configuration file while determining configured services, then reports `# no filesystem changes`. The invalid config is replaced with `{}` and backed up despite the preview message claiming nothing changed.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home containing malformed Poe configuration and preview logout:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run logout
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The dry-run output includes both:

```text
Dry run: would delete config at .../.poe-code/config.json.
# no filesystem changes
```

However, the isolated home changes on disk:

- `.poe-code/config.json` is overwritten with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, logout must not write configuration or claim no filesystem changes when reads have persisted recovery files. It should keep invalid-config handling read-only during preview execution.

## Impact

- Users receive a false assurance that their filesystem was unchanged.
- Previewing credential/config removal replaces malformed configuration before consent to repair or delete it.
- Scripts relying on dry-run output cannot trust the reported mutation status.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/logout.ts` loads configured services before its dry-run deletion guard, while invalid configuration recovery in `packages/poe-code-config/src/store.ts` persists the replacement file and backup outside the command-context dry-run recorder.

## Suspected Area

Config-loading recovery should be non-mutating during dry-run, and the dry-run operation reporter must account for any writes that can occur outside its filesystem proxy.
