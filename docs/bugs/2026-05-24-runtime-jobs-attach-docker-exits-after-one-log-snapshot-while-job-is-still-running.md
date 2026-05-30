---
name: "Runtime jobs attach for Docker exits after one log snapshot while the job is still running"
---

# Runtime jobs attach for Docker exits after one log snapshot while the job is still running

## Summary

`runtime jobs attach` is intended to resume a running detached job's live log stream until it exits or the user detaches. The Docker detached-job implementation exposes `stream()` as a one-shot generator that reads current log bytes and then completes. The attach helper treats iterator completion as final and exits immediately without checking that the Docker job is still running or reopening the stream for new output.

## Reproduction

1. From the repository root, run this disposable CLI probe with a saved running Docker job and a fake engine that returns one current log chunk while the container remains running:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-runtime-docker-attach-follow-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin"
   cat > "$probe/home/.poe-code/state/jobs/job-live.json" <<EOF
   {
     "id": "job-live",
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
   if [ "$1" = "exec" ]; then printf 'first log\n'; exit 0; fi
   if [ "$1" = "inspect" ]; then printf 'running\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs attach job-live

   cat "$probe/calls.log"
   ```

## Observed Behavior

The attach command prints the initial log data and exits successfully immediately, without asking whether the job remains running and without polling for later output:

```text
●  first log
docker --version
docker exec container-live sh -c test -f '/tmp/poe-jobs/job-live.log' && tail -c +1 '/tmp/poe-jobs/job-live.log' || true
```

The fake engine's `inspect` branch is never invoked. `runtime jobs attach` requests following output through `streamJobLog(..., { follow: true })` in `src/cli/commands/runtime/jobs/attach.ts:38` through `src/cli/commands/runtime/jobs/attach.ts:60`. The Docker job handle's `stream()` implementation reads at most one tail command and returns after its optional single yield in `packages/process-runner/src/docker/docker-execution-env.ts:460` through `packages/process-runner/src/docker/docker-execution-env.ts:479`. `streamJobLog()` breaks unconditionally when the iterator reports `done` in `src/cli/commands/runtime/jobs/shared.ts:127` through `src/cli/commands/runtime/jobs/shared.ts:154`, even in follow mode.

## Expected Behavior

When `runtime jobs attach` follows a running Docker job, it should continue polling or otherwise stream new log data until the job exits or the user detaches with Ctrl-C, matching the command's documented live-attachment semantics.

## Impact

Docker users cannot reliably monitor detached jobs: attach displays only output already present at the instant of attachment, then silently returns while the job continues running. Later failures, progress updates, and completion output are omitted unless users repeatedly invoke separate log reads.
