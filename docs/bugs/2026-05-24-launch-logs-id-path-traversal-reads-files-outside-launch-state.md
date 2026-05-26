# Launch logs process id path traversal reads files outside launch state

## Summary

The `poe-code launch logs <id>` command accepts path traversal segments in the managed process id. Supplying `../victim` makes it display a sibling `.poe-code/victim/logs/stdout.log` file instead of restricting log access to `.poe-code/launch/<id>/logs`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME` and disposable working directory; no external command execution or network access

## Reproduction

From the repository root, create a harmless log-like file beside launch state in a disposable home, then request logs using a crafted launch id:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home/.poe-code/launch" "$home/.poe-code/victim/logs" "$project"
printf 'sibling-secret-line\n' > "$home/.poe-code/victim/logs/stdout.log"

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" launch logs ../victim --lines 10
)
```

## Observed Behavior

The command exits successfully and prints content from outside the intended launch state directory:

```text
│
●  sibling-secret-line
```

The displayed file belonged to `.poe-code/victim/logs/stdout.log`, not to any managed process beneath `.poe-code/launch`.

## Expected Behavior

`launch logs` should reject process ids containing path separators or traversal segments, or otherwise constrain all resolved log paths beneath `.poe-code/launch`. It should not disclose contents of sibling paths addressed by `../victim`.

## Impact

- A crafted process id can read arbitrary log-named files reachable relative to the user's `.poe-code/launch` directory.
- Sensitive output stored in sibling directories can be disclosed through an apparently scoped launch log command.
- This read-only exploit complements the independently confirmed destructive traversal in `launch rm`, showing the unsafe identifier reaches multiple public operations.

## Supporting Evidence

In `src/cli/commands/launch.ts`, the `logs` subcommand forwards its user-controlled `<id>` directly to `readLaunchLogs()`. In `src/sdk/launch.ts`, `readLaunchLogs()` passes the id to `readManagedLogs()`. In `packages/process-launcher/src/launcher.ts`, log resolution constructs `path.join(baseDir, id, "logs")` without validating the id or enforcing containment below `baseDir`. With `baseDir` set to `.poe-code/launch`, `id=../victim` resolves the sibling `.poe-code/victim/logs` directory.

## Suspected Area

All launch entrypoints that accept process identifiers should enforce a safe id format before reading or mutating state, and every filesystem lookup should defensively verify containment beneath the configured launch state root.
