---
name: "Runtime jobs ls marks a Docker job lost when the container engine is unavailable"
---

# Runtime jobs ls marks a Docker job lost when the container engine is unavailable

## Summary

`runtime jobs ls` reconciles persisted running jobs by attaching to each runtime and querying status, but it converts every attachment exception into a persisted `lost` status. For Docker-backed jobs, a temporary failure to detect either Docker or Podman is therefore treated as proof that a potentially still-running container no longer exists.

## Reproduction

1. From the repository root, run this disposable CLI probe. It seeds a running Docker job record while fake `docker` and `podman` binaries simulate an unavailable container engine:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-docker-ls-engine-lost-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project" "$probe/bin"
   cat > "$probe/home/.poe-code/state/jobs/job-live.json" <<EOF
   {
     "id": "job-live",
     "env_id": "container-still-live",
     "env_kind": "docker",
     "tool": "codex",
     "argv": ["codex", "task"],
     "cwd": "$probe/project",
     "started_at": "2026-05-24T00:00:00.000Z",
     "status": "running"
   }
   EOF
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   exit 127
   EOF
   cat > "$probe/bin/podman" <<'EOF'
   #!/bin/sh
   exit 127
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/podman" "$probe/bin/colima"

   PATH="$probe/bin:$PATH" HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs ls

   cat "$probe/home/.poe-code/state/jobs/job-live.json"
   ```

## Observed Behavior

The listing exits successfully, renders the recorded Docker job as `lost`, and overwrites its saved status even though the only failure is that neither engine executable can currently be used:

```text
│ job-live │ codex │ docker │ lost │ 2026-05-24T00:00:00.000Z │ container-still-live │
```

```json
{
  "id": "job-live",
  "env_id": "container-still-live",
  "env_kind": "docker",
  "status": "lost"
}
```

`src/cli/commands/runtime/jobs/ls.ts:41` through `src/cli/commands/runtime/jobs/ls.ts:63` persist `lost` for any attach/status exception. Docker attachment selects an engine at reattach time in `packages/process-runner/src/docker/docker-execution-env.ts:95` through `packages/process-runner/src/docker/docker-execution-env.ts:104`, and `packages/process-runner/src/docker/engine.ts:4` through `packages/process-runner/src/docker/engine.ts:18` throw if neither local engine is currently detectable, without establishing whether the recorded container still exists in its original environment.

## Expected Behavior

A job listing should mark a Docker job lost only when a reachable matching container runtime proves the container no longer exists. Engine availability or connection failures should be surfaced as errors or non-destructive unknown/unreachable statuses.

## Impact

Users can permanently corrupt detached-job tracking simply by listing jobs while Docker Desktop, Colima, Podman, or the relevant engine socket is temporarily unavailable, hiding live containers from subsequent runtime job operations.
