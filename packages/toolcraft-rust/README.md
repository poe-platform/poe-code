# toolcraft-rust

An additive Rust implementation of Toolcraft for applications that need the
same Node API backed by native code. This private package is a work in progress;
keep existing applications on `toolcraft` until the complete API is available.

| Capability       | Current support                                                                  |
| ---------------- | -------------------------------------------------------------------------------- |
| Suggestions      | UTF-16 typo distance, live source methods, Node locale ordering and result limits |
| Diagnostics      | Log levels, filtering, function and object sinks                                 |
| Redaction        | Sensitive field/header policies, JSON bodies, serializers and cyclic references  |
| Errors           | Toolcraft user/bug errors and HTTP status subclasses                             |
| Requirements     | Authentication, numeric API version checks and async preconditions               |
| Secrets          | Required/optional environment values and missing-name suggestions                |
| Definitions      | Commands, groups, stream definitions, metadata inheritance and defaults          |
| Cloning          | Detached command trees, scope overrides, source locations and MCP proxy metadata |
| Package metadata | Nearest package lookup, symlink resolution and optional entrypoint lookup        |
| MCP results      | Explicit result markers, shallow copy semantics and cross-bundle recognition     |
| MCP metadata     | Native tool names, parameter descriptions, examples and tool allowlists; public server still pending |
| Stack diagnostics | Native framework-frame summaries, nested cause sections and raw stack preservation |
| Result rendering | Native rich cards, tables, Markdown/JSON, custom hooks and MCP error routing |
| CLI snapshots    | Native command-tree assembly, scope filtering, defaults and option metadata |
| CLI arguments    | Native comma-separated array scanning, negative-number option normalization and output/debug selection |
| CLI values       | Native scalar/array admission, nullable values, bounds, patterns, enum choices and JSON diagnostics |
| JSON locations   | Native parse-error precedence, UTF-16 source offsets and file diagnostics with source snippets |
| CLI options      | Native alias grouping, global-flag collision policies, boolean negation and array parser setup with existing Commander options |
| CLI consumption  | Native inline/next-token selection, boolean presets, variadic arrays and collected field validation errors |
| Dynamic CLI paths | Native dotted-flag matching, object/record/indexed-array traversal and qualified path diagnostics |
| Dynamic CLI values | Native object/record assembly, contiguous indexed arrays, cloned defaults and nested validation errors |
| Dynamic CLI arguments | Native dotted-flag parsing, negated booleans, repeated values, positionals and nested own-property writes |
| CLI preparation | Native command/alias/default selection, short option clusters, help routing and dynamic flag normalization |
| CLI command trees | Native scoped construction, hidden defaults, lazy field loading, global options and async action wiring through Commander |
| CLI field prompts | Native enum/boolean/text routing, loaded choices, defaults, cancellation and result parsing with native design prompts |
| CLI variants | Native active-branch selection, cloned defaults, required-field prompts and inactive-branch diagnostics |
| CLI presets | Native nested file-value routing, scalar/dynamic validation, defaults and read/JSON diagnostics |
| CLI parameters | Native positional/option/preset precedence, root defaults, missing-value callbacks, prompts, variants and combined validation |
| CLI fixtures | Native scenario loading, request matching, service proxies, fetch/filesystem fixtures and runtime selection |
| Public CLI | `toolcraft-rust/cli`: standalone and invocation-local commands, help, diagnostics and proxy cleanup |
| CLI execution | Native handler/approval routing, requirements, embedded validation, confirmation, managed streams and output/error handling |
| Generated help | Native group/leaf help, aliases, hidden defaults, scoped command lists, global options, examples, secrets and rich/Markdown/JSON output |
| Source snippets  | Context windows, line gutters, carets and terminal/Markdown/JSON styling          |
| Design           | `toolcraft-rust/design` and 72 flat helper paths backed by the native design package |
| File changes     | `toolcraft-rust/file-changes`: native status summaries and unified diffs through standard renderers |
| Managed streams  | Lazy creation, event validation, status callbacks, cancellation and cleanup       |
| Schema scoping   | Recursive field/branch filtering, required scopes and original schema identity   |
| Member validation | Nested SDK/MCP name collisions, discriminator aliases and formatter callbacks   |
| Branch validation | Discriminator selection, exclusive-union matching and branch diagnostics         |
| Applied defaults | Canonical cloned defaults, original-schema validation and ordered diagnostics     |
| Numeric validation | Shared Rust bounds and integer checks, live Number predicates and matching SDK diagnostics |
| SDK arguments    | Native casing, nested validation, defaults, aliases and JSON-schema normalization |
| SDK              | `toolcraft-rust/sdk`: native member trees, invocation routing, streams and deferred MCP discovery |
| Runtime wiring   | Reserved service names, injected I/O and approval runtime admission              |
| Approval plans   | Canonical traversal, JSON admission, cycle rejection and hash verification         |
| Approval execution | Native gate continuations, persisted tasks, cancellation and detached runner launch |
| Queued approvals | Native claim/execute transitions, stored-plan checks and recorded handler outcomes |
| Approval runtime | `toolcraft-rust/human-in-loop`: providers, list/show/run, state filters and runtime factory |
| HTTP summaries   | REST/GraphQL errors, request IDs, retry hints and redacted error envelopes         |
| Error reports    | Secret-aware rendering, cause chains, project discovery and confined report writes |
| Schema conversion | JSON-schema projections, recursive references, composition and upstream metadata |
| MCP proxies      | Cached discovery, tool renaming, hot native clients and explicit disposal         |
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

// Create a typed SDK with the same command and parameter inference.
const { createSDK } = await import("toolcraft-rust/sdk");
await createSDK(app).greet({ name: "World" });

// Run the same command tree from a terminal.
const { runCLI } = await import("toolcraft-rust/cli");
await runCLI(app, { argv: ["node", "app", "greet", "--name", "World"] });
```

Use a human approval provider with the SDK:

```ts
import { createHumanInLoop, osascriptProvider } from "toolcraft-rust/human-in-loop";

const humanInLoop = createHumanInLoop({ provider: osascriptProvider() });
// Pass { humanInLoop } when creating the SDK for commands with humanInLoop config.
```

Import terminal design helpers through the same Toolcraft paths:

```ts
import { renderMarkdown } from "toolcraft-rust/design/render-markdown";
import { renderTable, type TableColumn } from "toolcraft-rust/design/render-table";
import { createDashboard } from "toolcraft-rust/design/create-dashboard";
```

These entry points share the native design package's function, theme and
cancellation identities. They retain its current compatibility and performance
limitations; JavaScript remains the default for existing applications.

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
Applied-default validation uses the native schema dependency, preserves fields
hidden by scope projection and avoids inserting unused nested defaults.
The internal SDK argument engine now handles camel-case mapping, all canonical
schema kinds and native JSON-schema input normalization. Node retains property
descriptors, getter order, Unicode casing, array methods and diagnostic formatting.
Runtime service admission and approval wiring use Rust policies. Filesystem
promises, environment access and supplied runtime callbacks retain Node identity.
HTTP summary policies run in Rust and reuse native redaction, preserving REST and
GraphQL field precedence, nested validation paths and structured error envelopes.
Error reports use native redaction policy, argument handling, cause-chain traversal,
filename generation and directory checks. Node preserves filesystem promises,
symlink resolution and report text formatting. Commander supplies its existing
error constructor so help/version exceptions keep their original identity.
JSON-schema conversion uses Rust for reference traversal, schema selection,
composition, nullability and metadata rules. It retains the native schema engine
for validation and preserves JavaScript property descriptors and default identity.
MCP proxy policies run in Rust and connect through `tiny-mcp-client-rust`. Cached
discovery preserves atomic writes, symlink checks and tree rollback. Node retains
filesystem promises, abort signals and connection-promise identity.
SDK assembly and invocation policies run in Rust, including cased member trees,
scope filtering, runtime routing, typed MCP failures and deferred discovery retries.
Node retains async boundaries, context objects and callback receivers. The SDK
preserves lazy streams and awaits error-report persistence before rejecting.
Approval-plan validation and normalization use Rust policies with Node JSON
serialization and SHA-256. Sparse arrays, array subclasses, getter order and
shared references follow the existing approval runtime's behavior.
Approval gates and task admission use Rust policies with `@poe-code/task-list-rust`
storage. They preserve synchronous approval, async pending markers, plan checks,
cancellation boundaries, list caches, collision retries and stored-payload access.
The queued approval runner now verifies stored prompts and plans, claims tasks,
resolves command paths and records outcomes through Rust continuations. Storage
failure handling preserves the reference's catch boundaries and promise timing.
Approval built-ins now use native admission, deduplication, missing-error and
render-record policies. The runtime factory copies options and connects the native
gate and built-ins. Node retains async iteration, rendering callbacks and text/JSON
operations. The public `human-in-loop` entrypoint now uses
`@poe-code/agent-human-in-loop-rust` for macOS provider rules and preserves lazy
per-module default-provider selection. Node executes the generated AppleScript;
table primitives remain caller supplied.
File-change renderers use the native design dependency. The factory remains a
Node adapter for stdout, lazy options and unchanged JSON result identity:

```ts
import { createFileChangeRenderers } from 'toolcraft-rust/file-changes';

const renderers = createFileChangeRenderers({ mode: 'diff' });
// Use renderers as a command's render option; supply changes in its result.
```

Deep graph resource limits still require compatibility qualification before a swap.
Result rendering uses the own Rust YAML codec; YAML-library Document/node inputs
remain under qualification. Public CLI parsing, prompting, rendering and errors
are available, with existing Commander still supplying the parser objects.

Transports and remaining subpaths are not yet available. The native CLI is
currently slower than the JavaScript implementation; it is not a performance upgrade. Declarations currently use the existing
schema/design/config contract types; standalone type packaging and generic
stream-factory interchangeability remain pending. The migration and replacement
gates are tracked in the repository's Toolcraft Rust API parity plan.
