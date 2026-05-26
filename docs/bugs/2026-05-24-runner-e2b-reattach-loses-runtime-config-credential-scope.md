# E2B reattach loses the runtime-config credential scope used to create a sandbox

## Summary

E2B environment creation resolves its API key from `OpenSpec.runtimeCwd`, allowing a command workspace to use E2B credentials configured in a separate runtime-config project. Detached job persistence stores only the command working directory. On later reattachment, `e2bExecutionEnvFactory.attach()` resolves credentials from that command directory instead of the original runtime-config directory, so a valid detached sandbox cannot be reconnected when its credential exists only in the configured runtime scope.

## Reproduction

1. From the repository root, run this disposable probe. It places an E2B key only in a separate runtime-config project while keeping the command worktree and home configuration credential-free:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-attach-auth-scope-probe.XXXXXX)
   mkdir -p "$probe/home" "$probe/worktree" "$probe/runtime-config/.poe-code"
   printf '%s\n' '{"e2b":{"api_key":"runtime_scoped_key"}}' > "$probe/runtime-config/.poe-code/config.json"
   cat > "$probe/repro.mts" <<EOF
   import { resolveE2bApiKey } from "${workspace}/packages/runner-e2b/src/auth-scope.ts";
   import { e2bExecutionEnvFactory } from "${workspace}/packages/runner-e2b/src/factory.ts";
   console.log("launchKey=" + await resolveE2bApiKey({ cwd: "${probe}/runtime-config", env: {} }));
   try {
     await e2bExecutionEnvFactory.attach("sb_existing", {
       jobId: "job-1", tool: "node", argv: ["node"], cwd: "${probe}/worktree"
     });
   } catch (error) {
     console.log("attachError=" + (error as Error).message);
   }
   EOF

   env -u E2B_API_KEY HOME="$probe/home" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The configured runtime project successfully resolves the API key that can be used during launch, but attaching the persisted job from its command workspace rejects before reconnecting:

```text
launchKey=runtime_scoped_key
attachError=No E2B API key. Set E2B_API_KEY or e2b.api_key in ~/.poe-code/config.json.
```

`packages/agent-harness-tools/src/poe-command-execution.ts:49` through `packages/agent-harness-tools/src/poe-command-execution.ts:63` preserve the separately configured `runtimeConfigCwd` as `OpenSpec.runtimeCwd`. `packages/runner-e2b/src/factory.ts:12` through `packages/runner-e2b/src/factory.ts:37` use that value to resolve credentials when opening a sandbox. For reattachment, `packages/runner-e2b/src/factory.ts:39` through `packages/runner-e2b/src/factory.ts:42` resolve credentials only from `context.cwd`, and the persisted job record has no runtime-config directory field in `packages/poe-code-config/src/state/jobs.ts:7` through `packages/poe-code-config/src/state/jobs.ts:19`.

## Expected Behavior

A detached E2B job should retain enough runtime configuration scope to resolve the same API credential during reattachment that was available when the sandbox was created.

## Impact

Users who execute in one worktree while sourcing E2B runtime configuration and credentials from another project can successfully launch detached sandboxes but later cannot attach, sync, stop, or close them through poe-code.
