# Launch restart process id path traversal executes command from sibling spec

## Summary

The user-facing `poe-code launch restart <id>` command accepts path traversal segments in the managed process id. Supplying `../victim` causes it to locate and execute a crafted stopped process specification from `.poe-code/victim/spec.json`, outside the intended `.poe-code/launch` directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME`, disposable working directory, and `/usr/bin/touch` as a harmless proof-of-execution command

## Reproduction

From the repository root, create a stopped process record in a sibling directory of launch state, then restart it using a traversal id:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home/.poe-code/victim" "$project"
cat > "$home/.poe-code/victim/spec.json" <<EOF_SPEC
{
  "id": "../victim",
  "command": "/usr/bin/touch",
  "args": ["$probe/restarted-marker"],
  "restart": "never"
}
EOF_SPEC
cat > "$home/.poe-code/victim/state.json" <<'EOF_STATE'
{
  "id": "../victim",
  "pid": null,
  "status": "stopped",
  "runtime": "host",
  "restartCount": 0,
  "lastExitCode": 0,
  "lastStartedAt": null,
  "lastStoppedAt": null,
  "command": "/usr/bin/touch",
  "args": []
}
EOF_STATE

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" launch restart ../victim
)

test -e "$probe/restarted-marker" && echo executed=yes || echo executed=no
find "$home/.poe-code/victim" -maxdepth 2 -type f -print | sort
```

## Observed Behavior

The command exits successfully and executes the command loaded from the sibling process specification:

```text
executed=yes
.../home/.poe-code/victim/meta.json
.../home/.poe-code/victim/spec.json
.../home/.poe-code/victim/state.json
```

## Expected Behavior

`launch restart` should reject process ids containing path separators or traversal segments, or otherwise constrain process lookup and restart execution beneath `.poe-code/launch`. It must not execute a process specification from `.poe-code/victim`.

## Impact

- The normal user-facing restart command can execute commands from crafted process records outside launch storage.
- An attacker or faulty script that can place sibling state files can trigger execution by passing a traversal id, without using the hidden daemon subcommand directly.
- The operation also continues to read and rewrite process metadata outside the dedicated launch state root.

## Supporting Evidence

In `src/cli/commands/launch.ts`, `launch restart` forwards its user-controlled `<id>` directly to `restartLaunch()`. `src/sdk/launch.ts` forwards the id into `restartManagedProcess()`. In `packages/process-launcher/src/launcher.ts`, restart first reads `path.join(baseDir, id, "spec.json")`, then reuses the loaded spec in `startManagedProcess()`, which launches the daemon and executes `spec.command`; neither stage validates the id or enforces base-directory containment.

## Suspected Area

Restart should validate identifiers before any state lookup and only load/relaunch process records whose canonical storage path is inside the configured launch directory.
