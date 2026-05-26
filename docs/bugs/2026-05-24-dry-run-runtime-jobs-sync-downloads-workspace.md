# Dry-run runtime jobs sync downloads and extracts workspace content

## Summary

Running `runtime jobs sync` with root `--dry-run` still downloads the selected sandbox workspace and writes its files into the local project directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable project/state directory and fake `docker`/`colima` executables

## Reproduction

From the repository root, create one disposable exited Docker job record and use a fake Docker executable that returns a controlled workspace tar archive:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/bin" "$probe/home/.poe-code/state/jobs" "$probe/project"
cat > "$probe/home/.poe-code/state/jobs/job-sync.json" <<EOF
{
  "id": "job-sync",
  "env_id": "env-sync",
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
  exit 0
fi
if [ "$1" = "cp" ]; then
  destination="$3"
  staging=$(mktemp -d)
  printf '%s\n' 'synced-under-dry-run' > "$staging/from-sandbox.txt"
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
    /path/to/poe-code/src/index.ts --dry-run runtime jobs sync job-sync --force-sync
)

cat "$probe/docker.log"
cat "$probe/project/from-sandbox.txt"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The fake engine records the sandbox archive creation command and the workspace copy operation while root `--dry-run` is active.
- The CLI reports `Synced runtime job job-sync.`
- The previously empty local project gains `from-sandbox.txt` containing `synced-under-dry-run`.

## Expected Behavior

With root `--dry-run`, `runtime jobs sync` must not execute sandbox copy commands or extract files into the local project. It should preview the download/conflict policy and close behavior only.

## Impact

- A preview command can overwrite or introduce local project files when `--force-sync` is supplied.
- It performs runtime data transfer and filesystem writes users explicitly requested to simulate only.
- Users cannot safely validate synchronization targeting or conflict-policy options through dry-run mode.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/runtime/jobs/sync.ts`, root flags are resolved but not checked before `syncJob(entry, ...)`. In `src/cli/commands/runtime/jobs/shared.ts`, `syncJob` calls `env.downloadWorkspace(...)`, and `packages/process-runner/src/docker/docker-execution-env.ts` implements this by executing archive/copy operations and extracting the archive into `input.spec.cwd`.

## Suspected Area

Runtime workspace synchronization needs a dry-run branch before any remote/runtime transfer or local extraction operation.
