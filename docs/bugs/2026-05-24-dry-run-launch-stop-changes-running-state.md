# Dry-run launch stop changes running process state

## Summary

Running `launch stop` with `--dry-run` still changes persisted launch state from `running` to `stopped`. The command mutates managed-process state despite the global dry-run promise not to write changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, start a disposable sleeping process in an isolated temporary home, then attempt to stop it in dry-run mode:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

cat > "$probe/project/sleeper.sh" <<EOF
#!/bin/sh
printf 'started\n' >> "$probe/events.txt"
sleep 30
EOF
chmod +x "$probe/project/sleeper.sh"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --yes launch start stop-probe \
    --restart never -- "$probe/project/sleeper.sh"
)

rg '"status"' "$probe/home/.poe-code/launch/stop-probe/state.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run launch stop stop-probe
)

rg '"status"' "$probe/home/.poe-code/launch/stop-probe/state.json"
```

Replace `/path/to/poe-code` with the repository checkout path. Terminate any disposable sleeper process after the reproduction if it is still present.

## Observed Behavior

Before the dry-run command, the state file contains:

```json
"status": "running"
```

After `--dry-run launch stop stop-probe`, the same state file contains:

```json
"status": "stopped"
```

## Expected Behavior

With `--dry-run`, `launch stop` must not send stop actions or update the persisted state of the managed process. It should only report that the process would be stopped.

## Impact

- Previewing process shutdown changes persisted lifecycle state.
- Subsequent `launch status`, restart, or removal behavior can operate on an altered state record.
- Users cannot safely inspect shutdown operations before applying them.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `launch stop` action in `src/cli/commands/launch.ts` calls `stopLaunch` directly without consulting dry-run flags, and the managed-process stop path persists stopped state.

## Suspected Area

Launch lifecycle actions need a dry-run short-circuit before sending stop signals or persisting lifecycle transitions.
