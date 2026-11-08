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
- Track template images and runtime jobs with serialized atomic mutations.
- Save configured services, migrate legacy credentials and remove global/project layers with rollback.
- Compile static typed scopes into JSON Schema from source maps or file entry points.

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

Stored plain JSON parses and normalizes in one native call; deep valid JSON and
changed host intrinsics retain the observable parser path.

Rust owns scope/document normalization, runtime merge policy and primitive
coercion. Owned layered-document parsing/resolution is embedded in the same addon.
Node retains filesystem access, atomic writes/recovery, custom JSON parsers,
object identities, callbacks, default cloning and the runtime/memory/provider
adapters. Runtime merges reject recursion beyond 512 levels. Numeric strings use
ECMAScript whitespace and decimal/hexadecimal/binary/octal admission; non-finite
results are ignored.

Rust also owns job/template validation, accepted job statuses, integer exit-code
checks, safe job identifiers and template hash admission. Node retains registry
I/O, mutation promises, inherited/getter behavior, array hooks, dates and locale
ordering.

Rust owns stable file deduplication, optional primitive text normalization and
API shape admission. The owned provider/agent catalogs share the same addon. Node
retains service metadata hooks, I/O, layered migration and rollback.

The compiler uses an owned static TypeScript lexer and scope extractor, with
primitive fields and the original schema diagnostics. It accepts both original
and additive scope imports. Node retains module-path resolution, source access
and document metadata hooks; no TypeScript compiler or schema library ships at
runtime. Limits are 16 Mi UTF16 units per source, one million tokens, 512 delimiter
levels, 128 literal/template levels and 2048 files / 64 Mi units per graph.
Malformed-source recovery and JSX-like input are not full AST-parser parity.

All current runtime exports are present and all eight original test files pass.
This remains short of full replacement acceptance. Existing production imports remain unchanged. Native
artifacts have currently been validated on macOS arm64; performance and broader
platform acceptance remain under review.
