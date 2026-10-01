# toolcraft-rust

An additive Rust implementation of Toolcraft for applications that need the
same Node API backed by native code. This private package is a work in progress;
keep existing applications on `toolcraft` until the complete API is available.

| Capability   | Current support                                                                  |
| ------------ | -------------------------------------------------------------------------------- |
| Suggestions  | UTF-16 typo distance, Node locale ordering, thresholds and result limits         |
| Diagnostics  | Log levels, filtering, function and object sinks                                 |
| Errors       | Toolcraft user/bug errors and HTTP status subclasses                             |
| Requirements | Authentication, numeric API version checks and async preconditions               |
| Secrets      | Required/optional environment values and missing-name suggestions                |
| Definitions  | Commands, groups, stream definitions, metadata inheritance and defaults          |
| Cloning      | Detached command trees, scope overrides, source locations and MCP proxy metadata |

```ts
import { suggest, createRuntimeLogger, createHttpError } from "toolcraft-rust";

suggest("widgts", ["widgets", "deploy"]); // ["widgets"]
const diagnostics = createRuntimeLogger({ level: "warn", logger: console.log });
diagnostics.emit({ level: "warn", message: "Retrying request" });
```

Define commands with existing schema objects and keep handler inference:

```ts
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "toolcraft-rust";

const greet = defineCommand({
  name: "greet",
  params: S.Object({ name: S.String() }),
  handler: ({ params }) => `Hello, ${params.name}`
});
const app = defineGroup({ name: "app", children: [greet], default: greet });
```

Rust computes edit distances, API version validation, log filtering, HTTP status
classification, metadata inheritance, secret precedence, rename/default checks
and source-frame parsing.
Node retains locale sorting, callback receivers, original event values, error
causes, subclass identity, symbol metadata and stack traces. Cloning preserves
schema and handler identity and supports trees from another Toolcraft bundle.
The native addon is included in the
package; it does not import the JavaScript Toolcraft implementation at runtime.

The schema DSL, SDK, CLI, managed streams, transports, approval runtime and
remaining subpaths are not yet available. Declarations currently use the existing
schema/design/config contract types; standalone type packaging and generic
stream-factory interchangeability remain pending. The migration and replacement
gates are tracked in the repository's Toolcraft Rust API parity plan.
