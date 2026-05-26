# Runtime jobs sync --close leaves a destroyed sandbox selectable for future sync

## Summary

`runtime jobs sync <id> --close` downloads the workspace and destroys the associated sandbox/container, but it leaves the persisted job record unchanged as an `exited` pullable job. A later sync of the same still-listed job reattaches to an environment that the first command explicitly destroyed and fails at runtime.

## Reproduction

1. From the repository root, run this disposable CLI probe. It provides a fake Docker engine that records removal on the first `sync --close` and rejects subsequent access to the removed container:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-sync-close-stale-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin" "$probe/remote"
   printf 'remote\n' > "$probe/remote/result.txt"
   tar -cf "$probe/archive.tar" -C "$probe/remote" .
   cat > "$probe/home/.poe-code/state/jobs/job-exited.json" <<EOF
   {
     "id": "job-exited",
     "env_id": "container-done",
     "env_kind": "docker",
     "tool": "codex",
     "argv": ["codex", "task"],
     "cwd": "$probe/project",
     "started_at": "2026-05-24T00:00:00.000Z",
     "status": "exited",
     "exit_code": 0,
     "exited_at": "2026-05-24T00:01:00.000Z"
   }
   EOF
   : > "$probe/calls.log"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then exit 0; fi
   if [ -f "$REMOVED" ]; then printf 'removed container\n' >&2; exit 125; fi
   if [ "$1" = "exec" ]; then exit 0; fi
   if [ "$1" = "cp" ]; then cp "$ARCHIVE" "$3"; exit 0; fi
   if [ "$1" = "rm" ]; then : > "$REMOVED"; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" ARCHIVE="$probe/archive.tar" REMOVED="$probe/removed" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs sync job-exited --close

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" ARCHIVE="$probe/archive.tar" REMOVED="$probe/removed" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs sync job-exited || true

   cat "$probe/calls.log"
   cat "$probe/home/.poe-code/state/jobs/job-exited.json"
   ```

## Observed Behavior

The first synchronization succeeds and removes the container. The same saved job remains selectable, and the second synchronization attempts to address the already removed environment and fails:

```text
◆  Synced runtime job job-exited.
■  Error: Command failed with exit code 125: docker exec container-done ...
│  removed container
```

```text
docker --version
docker exec container-done sh -c tar -cf /tmp/poe-workspace-download.tar ...
docker cp container-done:/tmp/poe-workspace-download.tar ...
docker rm -f container-done
docker --version
docker exec container-done sh -c tar -cf /tmp/poe-workspace-download.tar ...
```

The job JSON remains unchanged with `"status": "exited"`. `src/cli/commands/runtime/jobs/sync.ts:27` through `src/cli/commands/runtime/jobs/sync.ts:43` performs sync and reports success without changing/removing saved state. `syncJob()` closes the attached environment in `src/cli/commands/runtime/jobs/shared.ts:86` through `src/cli/commands/runtime/jobs/shared.ts:100`, while `resolveJob()` continues to accept explicitly named saved jobs without checking whether their environment was closed in `src/cli/commands/runtime/jobs/shared.ts:25` through `src/cli/commands/runtime/jobs/shared.ts:42`.

## Expected Behavior

After `runtime jobs sync --close` destroys a job's sandbox, its persisted record should be removed or transitioned to a non-attachable terminal state so subsequent sync/attach/stop operations cannot target an environment that no longer exists.

## Impact

Users receive a successful close operation yet retain stale actionable job entries. Job listings advertise dead sandboxes, and routine subsequent synchronization fails against resources that poe-code itself deliberately removed.
