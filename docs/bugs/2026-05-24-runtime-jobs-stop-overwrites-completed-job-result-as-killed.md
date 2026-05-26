# Runtime jobs stop overwrites a completed job result as killed

## Summary

The `runtime jobs stop` command accepts an explicitly named detached job even when its saved status is already `exited`. It still sends a stop operation and unconditionally rewrites the completed record to `status: "killed"` with `exit_code: 130`, destroying the actual previously recorded exit outcome.

## Reproduction

1. From the repository root, run this disposable CLI probe. It seeds a completed Docker job with exit code `7` and uses fake engine binaries to record commands:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-stop-exited-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin"
   cat > "$probe/home/.poe-code/state/jobs/job-exited.json" <<EOF
   {
     "id": "job-exited",
     "env_id": "container-finished",
     "env_kind": "docker",
     "tool": "codex",
     "argv": ["codex", "task"],
     "cwd": "$probe/project",
     "started_at": "2026-05-24T00:00:00.000Z",
     "status": "exited",
     "exit_code": 7,
     "exited_at": "2026-05-24T00:01:00.000Z"
   }
   EOF
   : > "$probe/calls.log"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then exit 0; fi
   if [ "$1" = "wait" ]; then printf '7\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs stop job-exited

   cat "$probe/calls.log"
   cat "$probe/home/.poe-code/state/jobs/job-exited.json"
   ```

## Observed Behavior

The command reports a stop, sends a stop request to an already completed job, and replaces its real exit code with the synthetic killed value:

```text
◆  Stopped runtime job job-exited.
docker --version
docker stop container-finished
docker wait container-finished
```

```json
{
  "id": "job-exited",
  "status": "killed",
  "exit_code": 130
}
```

`src/cli/commands/runtime/jobs/shared.ts:25` through `src/cli/commands/runtime/jobs/shared.ts:41` permit exited jobs for pullable operations and do not validate an explicitly supplied job ID against the command intent. `src/cli/commands/runtime/jobs/stop.ts:42` through `src/cli/commands/runtime/jobs/stop.ts:50` then run stop logic and unconditionally persist `killed` with exit code `130`, regardless of the entry's prior completed state.

## Expected Behavior

`runtime jobs stop` should operate only on running jobs. If a user explicitly selects an already exited job, the command should preserve its recorded completion result and either refuse the stop request or restrict the action to an explicitly requested post-exit sync/close operation.

## Impact

Users can erase genuine agent exit results and misclassify completed work as interrupted simply by stopping a named job after it has already completed, undermining auditability and automation built on stored runtime outcomes.
