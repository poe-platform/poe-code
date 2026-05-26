# Dry-run runtime jobs attach streams runtime and syncs workspace on exit

## Summary

Running `runtime jobs attach --sync-on-exit` with root `--dry-run` still executes runtime log/status operations and extracts sandbox workspace files into the local project after the job is considered exited.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable project/state directory and fake `docker`/`colima` executables

## Reproduction

From the repository root, create one disposable running Docker job and substitute a fake engine that reports an exited job and returns controlled sync content:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code/state/jobs" "$probe/project"
cat > "$probe/home/.poe-code/state/jobs/job-attach.json" <<EOF
{
  "id": "job-attach",
  "env_id": "env-attach",
  "env_kind": "docker",
  "tool": "codex",
  "argv": ["run"],
  "cwd": "$probe/project",
  "started_at": "2026-05-24T12:00:00.000Z",
  "status": "running"
}
EOF

cat > "$probe/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "--version" ]; then
  printf '%s\n' 'Docker version fake'
elif [ "$1" = "inspect" ]; then
  printf '%s\n' 'exited'
elif [ "$1" = "cp" ]; then
  destination="$3"
  staging=$(mktemp -d)
  printf '%s\n' 'attach-synced-dry-run' > "$staging/from-attach.txt"
  tar -cf "$destination" -C "$staging" .
  rm -rf "$staging"
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
    /path/to/poe-code/src/index.ts --dry-run runtime jobs attach job-attach --sync-on-exit --force-sync
)

cat "$probe/docker.log"
cat "$probe/project/from-attach.txt"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The fake engine records a runtime log `exec` command and an `inspect` status query under root `--dry-run`.
- Once `inspect` reports the job exited, the command records archive/copy operations for workspace synchronization.
- The local project gains `from-attach.txt` containing `attach-synced-dry-run`.

## Expected Behavior

With root `--dry-run`, `runtime jobs attach` must not stream from a runtime, inspect live job state, or download workspace content. With `--sync-on-exit`, it should preview the conditional synchronization behavior only.

## Impact

- A preview can access live runtime logs/status and write downloaded files into the user's project.
- `--force-sync` may overwrite local content through an operation advertised as simulated.
- Users cannot safely check attach and sync-on-exit targeting in dry-run mode.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/runtime/jobs/attach.ts`, root flags are resolved but never checked before attaching, streaming, inspecting status, and optionally calling `syncJob`. The Docker execution environment in `packages/process-runner/src/docker/docker-execution-env.ts` implements these operations with engine `exec`, `inspect`, archive/copy, and local extraction actions.

## Suspected Area

Runtime attach workflows need a dry-run path that avoids runtime connections and disables any conditional workspace synchronization.
