# Runtime jobs stop with an explicit pending id marks a never-launched job as killed

## Summary

`runtime jobs stop` should operate on running detached jobs. Because explicit IDs bypass the resolver's intent filtering, a persisted `pending` entry with no environment ID is accepted. The command sends stop/wait operations against an empty backend identifier and rewrites a job that never launched as `killed` with exit code `130`.

## Reproduction

1. From the repository root, run this disposable CLI probe with a pending Docker job record and fake engine binaries that record the addressed container ID:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-stop-pending-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin"
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
   if [ "$1" = "stop" ]; then exit 0; fi
   if [ "$1" = "wait" ]; then printf '0\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs stop job-pending

   cat "$probe/calls.log"
   cat "$probe/home/.poe-code/state/jobs/job-pending.json"
   ```

## Observed Behavior

The command claims to stop a job that never acquired a sandbox, invokes Docker with an empty target, and persists it as killed:

```text
◆  Stopped runtime job job-pending.
docker --version
docker stop 
docker wait 
```

```json
{
  "env_id": "",
  "started_at": "",
  "status": "killed",
  "exit_code": 130
}
```

`runtime jobs stop` uses a pullable intent in `src/cli/commands/runtime/jobs/stop.ts:33` through `src/cli/commands/runtime/jobs/stop.ts:56`. While implicit pullable selection permits only running or exited jobs, `resolveJob()` returns explicitly named entries without applying the intent in `src/cli/commands/runtime/jobs/shared.ts:25` through `src/cli/commands/runtime/jobs/shared.ts:55`. Stop then attaches through the empty `env_id`, calls termination, and unconditionally updates the entry to killed.

## Expected Behavior

`runtime jobs stop <id>` should reject pending entries and any record without a valid launched environment before contacting a backend or rewriting state. A never-started job cannot truthfully be reported as killed.

## Impact

Failed launch artifacts can be converted into false termination records, corrupting job history and causing invalid backend operations. Users lose the distinction between “never launched” and “actively stopped,” which undermines debugging and automation based on runtime state.
