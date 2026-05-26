# Dry-run launch start executes the managed command

## Summary

Running `launch start` with `--dry-run` still creates managed-launch state and executes the supplied command. This converts preview mode into real process execution with arbitrary side effects.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, use a temporary command that writes a marker file:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

cat > "$probe/project/write-marker.sh" <<EOF
#!/bin/sh
printf started > "$probe/marker.txt"
EOF
chmod +x "$probe/project/write-marker.sh"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes launch start probe \
    --restart never -- "$probe/project/write-marker.sh"
)

for attempt in $(seq 1 50); do
  test -f "$probe/marker.txt" && break
  sleep 0.1
done

cat "$probe/marker.txt"
find "$probe/home/.poe-code/launch/probe" -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- After briefly waiting for the asynchronously launched child, the marker file exists and contains `started`, proving the provided command executed.
- Managed-process files are created under `.poe-code/launch/probe/`, including `spec.json`, `state.json`, and `meta.json`.
- The recorded state shows that the process actually started and stopped.

## Expected Behavior

With `--dry-run`, `launch start` must not execute the requested command, start a daemon, or create managed-process state. It should only display the launch specification that would be used.

## Impact

- Arbitrary user commands execute when users explicitly request a no-write simulation.
- Destructive or expensive managed workloads can run unintentionally.
- Process state and daemon metadata are created during preview operations.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `launch start` action in `src/cli/commands/launch.ts` resolves a launch specification and immediately calls `startLaunch` without checking `flags.dryRun`.

## Suspected Area

Launch lifecycle commands need explicit dry-run handling before invoking SDK operations that spawn, signal, restart, or remove managed processes.
