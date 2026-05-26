# Launch start process id path traversal writes state outside launch directory

## Summary

The `poe-code launch start <id>` command accepts path traversal segments in the managed process id. Starting a harmless command as `../victim` creates `spec.json`, `state.json`, and `meta.json` in `.poe-code/victim` instead of containing managed state beneath `.poe-code/launch`.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME`, disposable working directory, and `/usr/bin/true` as the harmless managed command

## Reproduction

From the repository root, launch an immediately exiting harmless process using a traversal id in a disposable home:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home" "$project"

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" --yes launch start ../victim -- /usr/bin/true
)

find "$home/.poe-code" -maxdepth 4 -type f -print | sort
test -e "$home/.poe-code/victim/spec.json" && echo victim_spec=yes || echo victim_spec=no
test -e "$home/.poe-code/launch/victim/spec.json" && echo launch_victim=yes || echo launch_victim=no
```

## Observed Behavior

The start command succeeds, and all persisted process records are written through the traversal id outside the launch state directory:

```text
.../home/.poe-code/victim/meta.json
.../home/.poe-code/victim/spec.json
.../home/.poe-code/victim/state.json
victim_spec=yes
launch_victim=no
```

## Expected Behavior

`launch start` should reject process ids containing path separators or traversal segments, or otherwise constrain all persisted process metadata below `.poe-code/launch`. A start request for `../victim` must not create `.poe-code/victim` files.

## Impact

- A crafted process id can create or overwrite managed-process JSON files in sibling directories under `.poe-code` rather than the dedicated launch storage area.
- This can corrupt unrelated user state and establishes files that other traversing launch operations can subsequently read, execute, signal, or delete.
- Storage isolation promised by a launch-specific state directory is not enforced at process creation time.

## Supporting Evidence

In `src/cli/commands/launch.ts`, `resolveProcessId()` returns any non-empty trimmed identifier and `launch start` forwards it as `spec.id` into `startLaunch()`. `src/sdk/launch.ts` forwards the spec to `startManagedProcess()`. In `packages/process-launcher/src/launcher.ts`, `resolveProcessDir(baseDir, id)` uses `path.join(baseDir, id)` and the startup path writes `spec.json`, `state.json`, and `meta.json` there without validating the identifier or checking containment beneath `baseDir`.

## Suspected Area

Process identifiers should be validated as safe single-segment names at the CLI and SDK boundaries, and the process-launcher package should defensively reject any resolved storage path outside its configured base directory.
