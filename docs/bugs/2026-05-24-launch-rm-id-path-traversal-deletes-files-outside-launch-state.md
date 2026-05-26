# Launch rm process id path traversal deletes files outside launch state

## Summary

The `poe-code launch rm <id>` command accepts path traversal segments in the managed process id. Supplying `../victim` causes it to recursively delete `.poe-code/victim` instead of restricting deletion to `.poe-code/launch/<id>`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME` and disposable working directory; no external command execution or network access

## Reproduction

From the repository root, create a harmless sibling directory beside launch state in a disposable home, then remove a crafted launch id:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home/.poe-code/launch" "$home/.poe-code/victim" "$project"
printf 'do-not-delete' > "$home/.poe-code/victim/marker.txt"

printf 'before='; find "$home/.poe-code" -maxdepth 3 -type f -print | sort
(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" launch rm ../victim
)
printf 'after='; find "$home/.poe-code" -maxdepth 3 -type f -print | sort
test -e "$home/.poe-code/victim/marker.txt" && echo present || echo missing
```

## Observed Behavior

The command exits successfully and deletes the sibling directory content addressed through traversal:

```text
before=.../home/.poe-code/victim/marker.txt
after=
missing
```

The victim directory was not a managed launch record and was outside the intended `.poe-code/launch` state directory.

## Expected Behavior

`launch rm` should reject process ids containing path separators or traversal segments, or otherwise constrain the resolved removal target beneath `.poe-code/launch`. The sibling file `.poe-code/victim/marker.txt` should remain present.

## Impact

- A crafted process id can delete arbitrary files and directories reachable relative to the user's `.poe-code/launch` directory.
- This can destroy unrelated poe-code state, credentials/config-adjacent artifacts, plans, logs, or other user-managed files under `.poe-code`.
- The command reports success despite operating on a path that was never a managed launch process.

## Supporting Evidence

In `src/cli/commands/launch.ts`, the `rm` subcommand forwards its user-controlled `<id>` directly to `removeLaunch()`. In `src/sdk/launch.ts`, `removeLaunch()` forwards the id into `removeManagedProcess()`. In `packages/process-launcher/src/state/state-store.ts`, `remove(id)` recursively deletes `path.join(stateDir, id)` without validating that the id is a single safe identifier or that the resulting path remains under `stateDir`. With `stateDir` set to `.poe-code/launch`, `id=../victim` resolves to `.poe-code/victim`.

## Suspected Area

All launch entrypoints that accept process identifiers should enforce a safe id format before performing reads, writes, log access, daemon execution, or recursive removal; destructive operations should additionally verify containment beneath the launch state root.
