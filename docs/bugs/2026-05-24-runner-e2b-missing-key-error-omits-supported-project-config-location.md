# E2B missing-key error omits the supported project configuration location

## Summary

The E2B runner supports resolving `e2b.api_key` from project configuration at `<cwd>/.poe-code/config.json`, and its package documentation states that missing-key errors point users to both supported configuration locations. In practice, `resolveE2bApiKey()` only tells users to set the environment variable or global configuration file, omitting the supported project-scoped recovery path.

## Reproduction

1. From the repository root, run this disposable probe with empty project and home configuration directories and no `E2B_API_KEY` environment variable:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-auth-guidance-probe.XXXXXX)
   mkdir -p "$probe/home" "$probe/project/.poe-code"
   cat > "$probe/repro.mts" <<EOF
   import { resolveE2bApiKey } from "${workspace}/packages/runner-e2b/src/auth-scope.ts";
   try {
     await resolveE2bApiKey({ cwd: "${probe}/project", homeDir: "${probe}/home", env: {} });
   } catch (error) {
     console.log((error as Error).message);
   }
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The error message mentions the environment variable and only the global configuration location:

```text
No E2B API key. Set E2B_API_KEY or e2b.api_key in ~/.poe-code/config.json.
```

`packages/runner-e2b/src/auth-scope.ts:32` through `packages/runner-e2b/src/auth-scope.ts:37` merge and resolve both global and project configuration, but `packages/runner-e2b/src/auth-scope.ts:38` through `packages/runner-e2b/src/auth-scope.ts:41` emit guidance for only the global path. The package README explicitly documents project config as a supported source and states that missing-key errors point to both locations in `packages/runner-e2b/README.md:9` through `packages/runner-e2b/README.md:27`.

## Expected Behavior

When no E2B API key is resolved, the error should identify all supported configuration remedies, including `e2b.api_key` in `<cwd>/.poe-code/config.json`.

## Impact

Users intending to keep E2B credentials project-scoped receive incomplete remediation guidance and may unnecessarily place a secret in global configuration or believe project-scoped credentials are unsupported.
