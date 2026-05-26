# Runtime configuration accepts negative E2B template resource values

## Summary

The E2B runtime configuration accepts `cpu` and `memory_mb` as arbitrary finite numbers without requiring positive resource values. Negative CPU and memory settings survive parsing and are passed to the E2B template build adapter as requested build resources.

## Reproduction

1. From the repository root, run this disposable probe to parse invalid negative resource settings:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-resource-parse-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { parseRuntime } from "${workspace}/packages/poe-code-config/src/runtime.ts";
   for (const config of [{ cpu: -1 }, { memory_mb: -128 }]) {
     console.log(JSON.stringify(parseRuntime({ type: "e2b", template_id: "tmpl", ...config })));
   }
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Both invalid resource requests are accepted as runtime configuration:

```text
{"build_args":{},"mounts":[],"type":"e2b","template_id":"tmpl","workspace_dir":"/workspace","cpu":-1,"preserve_after_exit_hours":24}
{"build_args":{},"mounts":[],"type":"e2b","template_id":"tmpl","workspace_dir":"/workspace","memory_mb":-128,"preserve_after_exit_hours":24}
```

`packages/poe-code-config/src/runtime.ts:152` through `packages/poe-code-config/src/runtime.ts:162` expose the options as parsed numbers, and `packages/poe-code-config/src/runtime.ts:231` through `packages/poe-code-config/src/runtime.ts:249` perform no positive-range validation for either value. The E2B builder forwards them directly as `cpu` and `memoryMb` in `packages/runner-e2b/src/template-build.ts:49` through `packages/runner-e2b/src/template-build.ts:58`, and the SDK wrapper maps them to E2B build parameters in `packages/runner-e2b/src/sdk.ts:126` through `packages/runner-e2b/src/sdk.ts:138`.

## Expected Behavior

E2B template resource settings should reject negative CPU and memory values during runtime configuration parsing, before any remote build request can be constructed.

## Impact

Users can save invalid E2B template resource configuration that causes delayed remote build failures or undefined backend behavior rather than clear local validation errors at configuration time.
