# Runtime jobs stop does not sync the workspace back by default

## Summary

The detached-runtime design specifies that `runtime jobs stop <id>` kills the job and synchronizes its workspace back on exit. The implemented command instead performs synchronization only when the caller opts into `--sync` or `--force-sync`, so its default behavior discards the detached job's remote workspace changes after termination.

## Reproduction

1. From the repository root, run this disposable CLI probe. It seeds a running Docker job and provides fake engine binaries that record every requested operation:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-stop-nosync-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin"
   cat > "$probe/home/.poe-code/state/jobs/job-running.json" <<EOF
   {
     "id": "job-running",
     "env_id": "container-live",
     "env_kind": "docker",
     "tool": "codex",
     "argv": ["codex", "task"],
     "cwd": "$probe/project",
     "started_at": "2026-05-24T00:00:00.000Z",
     "status": "running"
   }
   EOF
   : > "$probe/calls.log"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then exit 0; fi
   if [ "$1" = "wait" ]; then printf '130\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs stop job-running

   cat "$probe/calls.log"
   ```

## Observed Behavior

The command reports success and terminates the job, but no download or extraction operation occurs:

```text
◆  Stopped runtime job job-running.
docker --version
docker stop container-live
docker wait container-live
```

There is no `docker cp` or local `tar` extraction request to synchronize remote files back. The intended contract states that `runtime jobs stop <id>` should “kill the job; sync workspace back on exit” in `docs/plans/archive/e2b-integration.md:714` through `docs/plans/archive/e2b-integration.md:718`, illustrates `killed. workspace synced back.` in `docs/plans/archive/e2b-integration.md:749` through `docs/plans/archive/e2b-integration.md:753`, and says detached downloads are triggered by `jobs stop` in `docs/plans/archive/e2b-integration.md:761` through `docs/plans/archive/e2b-integration.md:767`. However, `src/cli/commands/runtime/jobs/stop.ts:45` through `src/cli/commands/runtime/jobs/stop.ts:55` calls `syncJob(...)` only when `--sync` or `--force-sync` is explicitly passed.

## Expected Behavior

Running `runtime jobs stop <id>` should sync the stopped job's workspace back using the configured/default conflict policy, with an optional flag needed only to override conflict behavior rather than to enable the promised synchronization itself.

## Impact

Users following the documented detached-job workflow can stop a completed or in-progress remote job and silently lose files created or modified in its sandbox. The success message gives no indication that remote work was not downloaded before the stopped environment is later discarded.
