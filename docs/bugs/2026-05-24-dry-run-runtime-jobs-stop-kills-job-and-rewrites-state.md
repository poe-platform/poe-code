# Dry-run runtime jobs stop kills a job and rewrites saved state

## Summary

Running `runtime jobs stop` with root `--dry-run` still invokes the runtime stop operation and persists the job as killed in local state.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable state directory and fake `docker`/`colima` executables

## Reproduction

From the repository root, create one disposable running Docker job record and replace runtime binaries with safe command recorders:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code/state/jobs" "$probe/project"
cat > "$probe/home/.poe-code/state/jobs/job-stop.json" <<EOF
{
  "id": "job-stop",
  "env_id": "env-stop",
  "env_kind": "docker",
  "tool": "codex",
  "argv": ["run"],
  "cwd": "$probe/project",
  "started_at": "2026-05-24T12:00:00.000Z",
  "status": "running"
}
EOF
cp "$probe/home/.poe-code/state/jobs/job-stop.json" "$probe/before.json"

cat > "$probe/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "--version" ]; then
  printf '%s\n' 'Docker version fake'
elif [ "$1" = "wait" ]; then
  printf '%s\n' '0'
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
    /path/to/poe-code/src/index.ts --dry-run runtime jobs stop job-stop
)

cat "$probe/docker.log"
diff -u "$probe/before.json" "$probe/home/.poe-code/state/jobs/job-stop.json" || true
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The fake engine records `stop env-stop` and `wait env-stop` while root `--dry-run` is active.
- The command reports `Stopped runtime job job-stop.`
- The saved job JSON is rewritten from `"status": "running"` to `"status": "killed"` and gains `"exit_code": 130` plus an `"exited_at"` timestamp.

## Expected Behavior

With root `--dry-run`, `runtime jobs stop` must not stop a runtime job or rewrite saved job status. It should preview the intended stop and optional sync actions without executing them.

## Impact

- A preview command can terminate live runtime work.
- Local state is permanently rewritten to reflect an action users requested only to simulate.
- Users cannot safely inspect stop behavior or target selection through dry-run mode.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/runtime/jobs/stop.ts`, root flags are resolved but never checked before `waitForGracefulStop(handle)` and `state.jobs.update(...)`. In `packages/process-runner/src/docker/docker-execution-env.ts`, `kill()` executes the runtime stop command and `wait()` executes the runtime wait command.

## Suspected Area

Runtime job mutation commands need a dry-run branch before issuing job lifecycle operations or updating persisted runtime state.
