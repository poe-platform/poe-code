# Dry-run launch restart restarts a running command

## Summary

Running `launch restart` with `--dry-run` still stops and relaunches a managed process. The restarted command executes again and the persisted launch state records a new start timestamp despite preview mode.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, start a disposable command that records each execution in an isolated temporary home, then request a dry-run restart:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

cat > "$probe/project/sleeper.sh" <<EOF
#!/bin/sh
printf 'started\n' >> "$probe/events.txt"
sleep 60
EOF
chmod +x "$probe/project/sleeper.sh"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --yes launch start restart-probe \
    --restart never -- "$probe/project/sleeper.sh"
)

while test "$(wc -l < "$probe/events.txt" | tr -d ' ')" != 1; do sleep 0.1; done
cat "$probe/home/.poe-code/launch/restart-probe/state.json"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run launch restart restart-probe
)

while test "$(wc -l < "$probe/events.txt" | tr -d ' ')" != 2; do sleep 0.1; done
cat "$probe/events.txt"
cat "$probe/home/.poe-code/launch/restart-probe/state.json"
```

Replace `/path/to/poe-code` with the repository checkout path. Stop or terminate the disposable managed process after reproduction.

## Observed Behavior

- Before the dry-run operation, `events.txt` contains one `started` line and state records a running process.
- After `--dry-run launch restart restart-probe`, `events.txt` contains two `started` lines, proving the command was launched again.
- The state file remains `running` but has a later `lastStartedAt` value after the dry-run operation.

## Expected Behavior

With `--dry-run`, `launch restart` must not stop or relaunch the managed process, execute its command again, or update persisted lifecycle state. It should only report that a restart would occur.

## Impact

- Previewing a restart can interrupt a live workload and execute it a second time.
- Managed commands with network, filesystem, or billing side effects run during a documented no-write simulation.
- Lifecycle state is rewritten, so subsequent management commands see a process transition that the user did not authorize.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `launch restart` action in `src/cli/commands/launch.ts` calls `restartLaunch` directly without consulting dry-run flags, and the SDK restart path starts a replacement managed process.

## Suspected Area

Launch lifecycle actions need a dry-run short-circuit before sending signals, spawning replacement commands, or persisting lifecycle transitions.
