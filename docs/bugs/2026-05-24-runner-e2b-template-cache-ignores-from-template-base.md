---
name: "E2B runtime template cache ignores the configured base template"
---

# E2B runtime template cache ignores the configured base template

## Summary

The E2B template builder passes `runtime.from_template` to the remote template build operation, so changing that option can change the resulting sandbox image. Its local cache hash excludes `from_template`, allowing two otherwise identical runtime configurations with different base templates to resolve to the same cached template ID.

## Reproduction

1. From the repository root, run this disposable probe. It requests two E2B builds with identical Dockerfile and context inputs but different configured `from_template` values, while a mock cache records the hash requested by each call:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-base-template-cache-probe.XXXXXX)
   mkdir -p "$probe/context"
   printf 'FROM scratch\n' > "$probe/Dockerfile"
   printf 'CONTEXT\n' > "$probe/context/file.txt"
   cat > "$probe/repro.mts" <<EOF
   import { buildE2bRuntimeTemplate } from "${workspace}/packages/runner-e2b/src/template-build.ts";
   const requestedHashes: string[] = [];
   const state = { templates: {
     async get(_backend: string, hash: string) {
       requestedHashes.push(hash);
       return { hash, template_id: "tmpl_cached", runtime_type: "e2b", dockerfile_path: "${probe}/Dockerfile", built_at: "2026-05-24T00:00:00.000Z" };
     },
     async put() {}, async remove() {}, async list() { return []; }
   }} as any;
   const first = await buildE2bRuntimeTemplate({
     apiKey: "unused",
     runtime: { type: "e2b", from_template: "base-alpha", build_args: {}, mounts: [] } as any,
     dockerfilePath: "${probe}/Dockerfile", buildContext: "${probe}/context", state
   });
   const second = await buildE2bRuntimeTemplate({
     apiKey: "unused",
     runtime: { type: "e2b", from_template: "base-beta", build_args: {}, mounts: [] } as any,
     dockerfilePath: "${probe}/Dockerfile", buildContext: "${probe}/context", state
   });
   console.log("first=" + JSON.stringify(first));
   console.log("second=" + JSON.stringify(second));
   console.log("sameHash=" + (requestedHashes[0] === requestedHashes[1]));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

Both configurations request the same cache hash and reuse the same cached template ID despite selecting different base templates:

```text
first={"backend":"e2b","hash":"a6acdbde8cf0ff4a51d433a323775262385d08883442a65ae67cb796854c8749","templateId":"tmpl_cached","cached":true}
second={"backend":"e2b","hash":"a6acdbde8cf0ff4a51d433a323775262385d08883442a65ae67cb796854c8749","templateId":"tmpl_cached","cached":true}
sameHash=true
```

`packages/runner-e2b/src/template-build.ts:29` through `packages/runner-e2b/src/template-build.ts:35` select cached templates using a hash computed from Dockerfile bytes, context files, and `runtime.build_args`. `packages/runner-e2b/src/template-build.ts:49` through `packages/runner-e2b/src/template-build.ts:58` pass `runtime.from_template` into actual builds, but `packages/runner-e2b/src/template-build.ts:85` through `packages/runner-e2b/src/template-build.ts:107` omit it from the identity calculation.

## Expected Behavior

Changing `runtime.from_template` should change the E2B template cache identity so that a template built from one base cannot be reused for a runtime explicitly configured to use a different base.

## Impact

Users can change the base E2B template to pick up new tooling, environment assumptions, or security fixes and still receive an older cached sandbox built from the previous base without any indication that the change was ignored.
