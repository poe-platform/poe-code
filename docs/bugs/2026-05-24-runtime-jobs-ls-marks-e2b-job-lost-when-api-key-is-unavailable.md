---
name: "Runtime jobs ls marks an E2B job lost when its API key is unavailable"
---

# Runtime jobs ls marks an E2B job lost when its API key is unavailable

## Summary

`runtime jobs ls` reconciles persisted running jobs by attaching to each runtime and querying status. It catches every attachment error and permanently updates the job to `lost`. For E2B, merely running the listing without access to the API key is therefore treated as proof that a potentially still-running sandbox has been lost.

## Reproduction

1. From the repository root, run this disposable CLI probe. It seeds a running E2B job record but supplies no E2B credential in the environment, project, or isolated home directory:

   ```sh
   repo=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-ls-auth-lost-probe.XXXXXX)
   mkdir -p "$probe/home/.poe-code/state/jobs" "$probe/project"
   cat > "$probe/home/.poe-code/state/jobs/job-live.json" <<EOF
   {
     "id": "job-live",
     "env_id": "sb_still_live",
     "env_kind": "e2b",
     "tool": "codex",
     "argv": ["codex", "task"],
     "cwd": "$probe/project",
     "started_at": "2026-05-24T00:00:00.000Z",
     "status": "running"
   }
   EOF

   env -u E2B_API_KEY HOME="$probe/home" \
     "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
     "$repo/src/index.ts" runtime jobs ls

   cat "$probe/home/.poe-code/state/jobs/job-live.json"
   ```

## Observed Behavior

The listing exits successfully, renders the job as `lost`, and mutates its saved status even though no sandbox status query could occur without authentication:

```text
│ job-live │ codex │ e2b │ lost │ 2026-05-24T00:00:00.000Z │ sb_still_live │
```

```json
{
  "id": "job-live",
  "env_id": "sb_still_live",
  "env_kind": "e2b",
  "status": "lost"
}
```

`src/cli/commands/runtime/jobs/ls.ts:41` through `src/cli/commands/runtime/jobs/ls.ts:63` convert any exception thrown while attaching or checking a running job into a persisted `lost` state. E2B attachment requires resolving a credential before connecting in `packages/runner-e2b/src/factory.ts:39` through `packages/runner-e2b/src/factory.ts:42`, and missing credentials throw from `packages/runner-e2b/src/auth-scope.ts:28` through `packages/runner-e2b/src/auth-scope.ts:43` without proving anything about sandbox existence.

## Expected Behavior

A status listing should mark an E2B job lost only after a successful authenticated status check proves that the sandbox or process no longer exists. Credential, network, or other attachment failures should be surfaced as errors or non-destructive unknown/unreachable states.

## Impact

Users who list detached jobs from a shell without the required E2B credential can permanently corrupt their local job tracking, removing a live sandbox from commands that operate only on running or pullable jobs and obscuring recoverable work.
