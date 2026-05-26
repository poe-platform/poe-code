# Dry-run runtime jobs logs executes a container command

## Summary

Running `runtime jobs logs` with root `--dry-run` still attaches to the recorded runtime and executes a container command to read log output.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable state directory and fake `docker`/`colima` executables

## Reproduction

From the repository root, create one disposable exited Docker job record and replace runtime binaries with local command recorders:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code/state/jobs" "$probe/project"
cat > "$probe/home/.poe-code/state/jobs/job-logs.json" <<EOF
{
  "id": "job-logs",
  "env_id": "env-logs",
  "env_kind": "docker",
  "tool": "codex",
  "argv": ["run"],
  "cwd": "$probe/project",
  "started_at": "2026-05-24T12:00:00.000Z",
  "status": "exited"
}
EOF

cat > "$probe/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "--version" ]; then
  printf '%s\n' 'Docker version fake'
elif [ "$1" = "exec" ]; then
  printf '%s\n' 'fake runtime log output'
fi
exit 0
EOF
cat > "$probe/bin/colima" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$probe/bin/docker" "$probe/bin/colima"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_DOCKER_LOG="$probe/docker.log" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run runtime jobs logs job-logs
)

cat "$probe/docker.log"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command prints `fake runtime log output`, proving it consumed data from the substituted runtime command.
- The fake engine records `exec env-logs sh -c test -f '/tmp/poe-jobs/job-logs.log' && tail -c +1 '/tmp/poe-jobs/job-logs.log' || true` while root `--dry-run` is active.

## Expected Behavior

With root `--dry-run`, `runtime jobs logs` must not attach to a runtime or execute commands in a sandbox. It should report the log-read action it would perform.

## Impact

- A preview operation executes arbitrary runtime commands in an existing container.
- Runtime access can trigger audit events, incur costs, or expose information from the sandbox.
- Users cannot safely verify job identifiers and log options with dry-run mode.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/runtime/jobs/logs.ts`, root flags are resolved but never consulted before `attachJob(entry)` and `streamJobLog(handle, ...)`. In `packages/process-runner/src/docker/docker-execution-env.ts`, a job log stream is implemented by an engine `exec` invocation that tails the runtime log file.

## Suspected Area

Runtime job inspection commands need dry-run handling before attaching to, or issuing commands within, external runtime environments.
