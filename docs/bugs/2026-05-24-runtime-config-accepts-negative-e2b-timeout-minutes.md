# Runtime configuration accepts negative E2B timeout minutes

## Summary

The E2B runtime configuration accepts `timeout_minutes` through the shared numeric parser but applies no range validation. A negative timeout value is therefore accepted as valid runtime configuration and is subsequently converted into negative milliseconds for E2B sandbox creation.

## Reproduction

1. From the repository root, run this disposable probe to parse a negative E2B timeout and show the duration forwarded by the E2B SDK adapter:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-negative-timeout-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { parseRuntime } from "${workspace}/packages/poe-code-config/src/runtime.ts";
   const runtime = parseRuntime({ type: "e2b", template_id: "tmpl", timeout_minutes: -1 });
   console.log(JSON.stringify(runtime));
   console.log("timeoutMs=" + ((runtime as any).timeout_minutes * 60_000));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The negative timeout is accepted and maps to a negative sandbox timeout duration:

```text
{"build_args":{},"mounts":[],"type":"e2b","template_id":"tmpl","workspace_dir":"/workspace","timeout_minutes":-1,"preserve_after_exit_hours":24}
timeoutMs=-60000
```

`packages/poe-code-config/src/runtime.ts:164` through `packages/poe-code-config/src/runtime.ts:168` define the option as a parsed number, and `packages/poe-code-config/src/runtime.ts:231` through `packages/poe-code-config/src/runtime.ts:249` validate `preserve_after_exit_hours` but not `timeout_minutes`. The E2B SDK wrapper converts this accepted option directly to milliseconds for `Sandbox.create()` in `packages/runner-e2b/src/sdk.ts:114` through `packages/runner-e2b/src/sdk.ts:119`.

## Expected Behavior

`timeout_minutes` should reject negative values during runtime configuration parsing, using a clear range error before any sandbox request is constructed.

## Impact

Users can persist or pass invalid E2B timeout configuration that fails only during runtime launch or is interpreted unpredictably by the backend API, instead of receiving immediate configuration validation feedback.
