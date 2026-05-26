# Runtime jobs sync with an explicit pending id overwrites local files without a launched job

## Summary

`runtime jobs sync` is meant to download workspace contents from a running or exited detached job. Its resolver applies that pullable-status restriction only during implicit selection; if a user supplies a job ID, a `pending` entry with no sandbox ID is accepted. With `--force-sync`, the command then runs backend download operations against an empty environment identifier and can overwrite local project files even though no detached job was ever launched.

## Reproduction

1. From the repository root, run this disposable CLI probe. It seeds a pending Docker job with an empty `env_id`, prepares local content, and provides a fake engine that returns an arbitrary archive when asked to copy from the empty container reference:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-sync-pending-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin" "$probe/remote"
   printf 'local\n' > "$probe/project/result.txt"
   printf 'from-no-job\n' > "$probe/remote/result.txt"
   tar -cf "$probe/archive.tar" -C "$probe/remote" .
   cat > "$probe/home/.poe-code/state/jobs/job-pending.json" <<EOF
   {
     "id": "job-pending",
     "env_id": "",
     "env_kind": "docker",
     "tool": "codex",
     "argv": ["codex", "task"],
     "cwd": "$probe/project",
     "started_at": "",
     "status": "pending"
   }
   EOF
   : > "$probe/calls.log"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then exit 0; fi
   if [ "$1" = "exec" ]; then exit 0; fi
   if [ "$1" = "cp" ]; then cp "$ARCHIVE" "$3"; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" ARCHIVE="$probe/archive.tar" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs sync job-pending --force-sync

   cat "$probe/calls.log"
   cat "$probe/project/result.txt"
   ```

## Observed Behavior

The command reports successful synchronization, calls Docker operations with an empty container identifier, and overwrites the local file despite the record never having reached `running`:

```text
◆  Synced runtime job job-pending.
docker --version
docker exec  sh -c tar -cf /tmp/poe-workspace-download.tar -C '/tmp/.../project' .
docker cp :/tmp/poe-workspace-download.tar .../workspace.tar
from-no-job
```

`runtime jobs sync` requests a pullable job through `resolveJob(...)` in `src/cli/commands/runtime/jobs/sync.ts:27` through `src/cli/commands/runtime/jobs/sync.ts:43`. Pullable implicit selection allows only `running` or `exited`, but explicit IDs bypass all intent checks in `src/cli/commands/runtime/jobs/shared.ts:25` through `src/cli/commands/runtime/jobs/shared.ts:42`. `syncJob()` then attaches and extracts downloaded contents into the recorded local cwd in `src/cli/commands/runtime/jobs/shared.ts:86` through `src/cli/commands/runtime/jobs/shared.ts:100`.

## Expected Behavior

`runtime jobs sync <id>` should reject pending or otherwise non-pullable entries, including explicitly named ones, before performing any backend operation or local extraction. A pending entry with no sandbox ID must never be treated as a downloadable environment.

## Impact

Stale pending records left by failed launches can be turned into local file-overwrite operations through a command that claims to synchronize real detached job output. This produces misleading success, targets an invalid backend identifier, and can corrupt the local workspace without any launched remote job.
