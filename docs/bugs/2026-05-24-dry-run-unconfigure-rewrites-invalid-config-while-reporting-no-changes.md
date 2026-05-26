# Dry-run unconfigure rewrites invalid config while reporting no filesystem changes

## Summary

Running `unconfigure codex` with `--dry-run` rewrites malformed global configuration while determining current configuration state, then reports `# no filesystem changes`. The invalid input is replaced with `{}` and preserved in a backup file despite the dry-run assurance.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable home containing malformed Poe configuration and preview Codex unconfiguration:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code" "$probe/project"
printf '{ invalid json\n' > "$probe/home/.poe-code/config.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run unconfigure codex
)

find "$probe/home/.poe-code" -maxdepth 1 -type f -print -exec cat {} \;
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The command output includes:

```text
Dry run: would remove Codex configuration.
# no filesystem changes
```

However, the disposable home is changed on disk:

- `.poe-code/config.json` is replaced with `{}`.
- `.poe-code/config.json.invalid-<timestamp>.json` is created containing the original malformed input.

## Expected Behavior

With `--dry-run`, unconfiguration must not repair, overwrite, or back up configuration files. It must also not report that no filesystem changes occurred after persistence has taken place.

## Impact

- Users receive false dry-run output while their config is altered.
- Previewing removal of one tool configuration can replace the whole malformed Poe configuration file.
- Automation cannot safely use dry-run unconfiguration for inspection or change previews.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/unconfigure.ts` loads configured services for its payload before finalizing dry-run output, while invalid configuration recovery in `packages/poe-code-config/src/store.ts` writes the replacement and backup outside the command-context dry-run recorder.

## Suspected Area

Dry-run unconfiguration needs non-mutating configuration reads, and filesystem-change reporting must not omit writes performed by automatic recovery paths.
