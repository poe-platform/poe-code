# toolcraft-rust

An additive Rust implementation of Toolcraft for applications that need the
same Node API backed by native code. This private package is a work in progress;
keep existing applications on `toolcraft` until the complete API is available.

| Capability       | Current support                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| Suggestions      | UTF-16 typo distance, Node locale ordering, thresholds and result limits         |
| Diagnostics      | Log levels, filtering, function and object sinks                                 |
| Redaction        | Sensitive field/header policies, JSON bodies, serializers and cyclic references  |
| Errors           | Toolcraft user/bug errors and HTTP status subclasses                             |
| Requirements     | Authentication, numeric API version checks and async preconditions               |
| Secrets          | Required/optional environment values and missing-name suggestions                |
| Definitions      | Commands, groups, stream definitions, metadata inheritance and defaults          |
| Cloning          | Detached command trees, scope overrides, source locations and MCP proxy metadata |
| Package metadata | Nearest package lookup, symlink resolution and optional entrypoint lookup        |
| MCP results      | Explicit result markers, shallow copy semantics and cross-bundle recognition     |
| Source snippets  | Context windows, line gutters, carets and terminal/Markdown/JSON styling          |
| Managed streams  | Lazy creation, event validation, status callbacks, cancellation and cleanup       |
| Schema scoping   | Recursive field/branch filtering, required scopes and original schema identity   |
| Member validation | Nested SDK/MCP name collisions, discriminator aliases and formatter callbacks   |
| Branch validation | Discriminator selection, exclusive-union matching and branch diagnostics         |
| Schemas          | Root DSL exports and `toolcraft-rust/schema`, backed by `toolcraft-schema-rust`     |

```ts
import { suggest, createRuntimeLogger, createHttpError } from "toolcraft-rust";

suggest("widgts", ["widgets", "deploy"]); // ["widgets"]
const diagnostics = createRuntimeLogger({ level: "warn", logger: console.log });
diagnostics.emit({ level: "warn", message: "Retrying request" });
```

Define commands with existing schema objects and keep handler inference:

```ts
import { S, defineCommand, defineGroup } from "toolcraft-rust";

const greet = defineCommand({
  name: "greet",
  params: S.Object({ name: S.String() }),
  handler: ({ params }) => `Hello, ${params.name}`
});
const app = defineGroup({ name: "app", children: [greet], default: greet });
```

Show a source location with surrounding lines:

```ts
import { renderSourceSnippet } from "toolcraft-rust/source-snippet";

console.error(renderSourceSnippet({
  source: "first line\nsecond line",
  filePath: "example.ts",
  line: 2,
  column: 4
}));
```

Rust computes edit distances, API version validation, log filtering, HTTP status
classification, metadata inheritance, secret precedence, rename/default checks
and source-frame parsing.
Rust also traverses redacted objects and controls serializer application and
cycle detection. Node retains array mapping and JSON parsing semantics, including
sparse arrays, custom array species, serializer receivers and thrown values.
Package lookup runs in Rust with Node filesystem and path capabilities, preserving
symlink resolution, missing-path fallbacks and the nearest package's parse errors.
MCP result validation and marker recognition run in Rust; Node performs property
access, object spread and symbol definition to retain getter order and descriptors.
Source windows, gutter alignment and row assembly run in Rust, preserving UTF-16
text and numeric edge cases. Styling uses `toolcraft-design-rust`; the Node adapter
retains option accessors, string operations and caller exceptions.
Node retains locale sorting, callback receivers, original event values, error
causes, subclass identity, symbol metadata and stack traces. Cloning preserves
schema and handler identity and supports trees from another Toolcraft bundle.
The native addon is included in the
package; it does not import the JavaScript Toolcraft implementation at runtime.

Managed streams use a Rust continuation engine and `toolcraft-schema-rust` event
validation. Node retains promises, iterator handles and AbortSignals, preserving
callback receivers, event identity, cleanup errors and cancellation promise identity.
The internal scope projector also runs in Rust, retaining Node spread semantics,
custom branch-array methods and original-schema identity through repeated filters.
Member collision validation uses native traversal and per-object name maps, with
Node iteration preserving callback errors and iterator cleanup.
Discriminator and union selection preserve caller values, normalized successful
branches and diagnostic order while the native runtime chooses the outcome.
Deep graph resource limits still require compatibility qualification before a swap.

The SDK, CLI, transports, approval runtime and
remaining subpaths are not yet available. Declarations currently use the existing
schema/design/config contract types; standalone type packaging and generic
stream-factory interchangeability remain pending. The migration and replacement
gates are tracked in the repository's Toolcraft Rust API parity plan.
