# Dry-run launch rm deletes managed process state and logs

## Summary

Running `launch rm` with `--dry-run` still deletes a managed process state directory and its logs. The destructive cleanup happens while the CLI advertises dry-run mode as simulation without writes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, seed temporary launch state and invoke removal in dry-run mode:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/launch/api/logs" "$probe/project"
printf '{"id":"api"}\n' > "$probe/home/.poe-code/launch/api/state.json"
printf 'hello\n' > "$probe/home/.poe-code/launch/api/logs/stdout.log"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run launch rm api
)

find "$probe/home/.poe-code/launch" -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

Before the command runs, the temporary launch state contains both `state.json` and `logs/stdout.log`. After `--dry-run launch rm api`, the entire `.poe-code/launch/api` directory has been removed.

## Expected Behavior

With `--dry-run`, `launch rm` must retain all managed process state and logs, and only report that the launch record would be removed.

## Impact

- Previewing launch cleanup destroys operational state and diagnostic logs.
- Users can lose evidence needed to debug a failed managed process.
- Automation cannot safely determine what `launch rm` would affect without executing deletion.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `launch rm` action in `src/cli/commands/launch.ts` calls `removeLaunch` directly without resolving or checking dry-run flags; the SDK removal path deletes the managed-process directory.

## Suspected Area

Launch mutation subcommands need global execution flags propagated into their actions, with `rm` short-circuiting before `removeLaunch` in dry-run mode.
