# poe-code-config-rust

Scoped agent configuration with a reusable Rust policy core and a self-contained
Node addon. The package is additive and has no npm runtime dependencies.

- Define typed scopes and resolve file values, environment overrides and defaults.
- Read global/project configuration with extension chains and read-only access.
- Write scopes atomically and recover invalid documents with exclusive backups.
- Merge runtime settings recursively while preserving other nested value identities.
- Inspect environment overrides, initialize project configuration and select edit targets.
- Parse host/container runtime settings, memory options and provider base URLs.
- Compose pipeline, experiment and loop callbacks.

```ts
import { createConfigStore, defineScope } from "@poe-code/poe-code-config-rust";
import { promises as fs } from "node:fs";

const scope = defineScope("agent", {
  timeout: { type: "number", default: 30, env: "AGENT_TIMEOUT", doc: "Timeout" }
});
const settings = createConfigStore({ fs, filePath: "/home/user/.poe-code/config.json" });
await settings.scope(scope).set("timeout", 60);
console.log(await settings.scope(scope).getAll());
```

Plain data records use one native document operation with opaque references to
selected values. Accessors, proxies or changed host intrinsics use the observable
callback path; neither path clones unchanged branches.

Rust owns scope/document normalization, runtime merge policy and primitive
coercion. Owned layered-document parsing/resolution is embedded in the same addon.
Node retains filesystem access, atomic writes/recovery, custom JSON parsers,
object identities, callbacks, default cloning and the runtime/memory/provider
adapters. Runtime merges reject recursion beyond 512 levels. Numeric strings use
ECMAScript whitespace and decimal/hexadecimal/binary/octal admission; non-finite
results are ignored.

This first surface does not yet expose configured-service migration, state/job/
template registries or TypeScript schema compilation. It is not a full replacement
for the original package. Existing production imports remain unchanged. Native
artifacts have currently been validated on macOS arm64; performance and broader
platform acceptance remain under review.
