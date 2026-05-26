# Runtime jobs attach with an explicit id accepts already exited jobs

## Summary

`runtime jobs attach` is a live-follow command intended for running detached jobs, and its automatic job selection filters to `status: "running"`. When the user supplies a job ID explicitly, the shared resolver returns that record without applying the requested running-only intent. The command therefore attaches to completed jobs and accesses their runtime environment as though they were active.

## Reproduction

1. From the repository root, run this disposable CLI probe with a saved Docker job already recorded as exited and a fake engine that reports log access:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-attach-exited-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin"
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
   if [ "$1" = "exec" ]; then printf 'done logs\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs attach job-exited

   cat "$probe/calls.log"
   ```

## Observed Behavior

The live-attach command succeeds against a job already saved as exited and performs a runtime log command:

```text
●  done logs
docker --version
docker exec container-done sh -c test -f '/tmp/poe-jobs/job-exited.log' && tail -c +1 '/tmp/poe-jobs/job-exited.log' || true
```

`runtime jobs attach` requests a `"running"` intent from `resolveJob(...)` in `src/cli/commands/runtime/jobs/attach.ts:36` through `src/cli/commands/runtime/jobs/attach.ts:60`. For implicit selection, `resolveJob()` filters to running records, but for any explicit `jobId` it returns the record immediately without checking `intent` in `src/cli/commands/runtime/jobs/shared.ts:25` through `src/cli/commands/runtime/jobs/shared.ts:55`.

## Expected Behavior

`runtime jobs attach <id>` should reject a saved job that is not currently running, regardless of whether it was selected automatically or named explicitly. Completed-job log retrieval belongs to `runtime jobs logs`, not live attach.

## Impact

Users can invoke running-only operations against completed or stale environments simply by specifying IDs. This leads to inconsistent command behavior, unnecessary backend access, and failures when completed sandboxes have already expired or been closed.
