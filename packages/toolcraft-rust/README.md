# toolcraft-rust

An additive Rust implementation of Toolcraft for applications that need the
same Node API backed by native code. This private package is a work in progress;
keep existing applications on `toolcraft` until the complete API is available.

| Capability   | Current support                                                          |
| ------------ | ------------------------------------------------------------------------ |
| Suggestions  | UTF-16 typo distance, Node locale ordering, thresholds and result limits |
| Diagnostics  | Log levels, filtering, function and object sinks                         |
| Errors       | Toolcraft user/bug errors and HTTP status subclasses                     |
| Requirements | Authentication, numeric API version checks and async preconditions       |
| Secrets      | Required/optional environment values and missing-name suggestions        |

```ts
import { suggest, createRuntimeLogger, createHttpError } from "toolcraft-rust";

suggest("widgts", ["widgets", "deploy"]); // ["widgets"]
const diagnostics = createRuntimeLogger({ level: "warn", logger: console.log });
diagnostics.emit({ level: "warn", message: "Retrying request" });
```

Rust computes edit distances, API version validation, log filtering and HTTP status classification.
Node retains locale sorting, callback receivers, original event values, error
causes, subclass identity and stack traces. The native addon is included in the
package; it does not import the JavaScript Toolcraft implementation at runtime.

Command definitions, schema, SDK, CLI, transports, approvals and remaining
subpaths are not yet available. The migration and replacement gates are tracked
in the repository's Toolcraft Rust API parity plan.
