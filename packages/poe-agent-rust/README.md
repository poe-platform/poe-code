# Poe Agent Rust

Resolve plugin-provided models with an independent Rust core and no npm runtime dependencies. Providers register through plugins; matching runs in order and stops at the first supported model.

- Collect provider registrations and report name collisions with both contributors.
- Preserve provider/callback identity and opaque plugin options.
- Wrap support-check failures with the model, provider names and original cause.
- Validate tool names with an ASCII scanner, without a regular-expression engine.
- Register frozen tool snapshots and select model-visible tools by skill/namespace.
- Save/load conversation records with Rust role/content validation and injectable storage.

```typescript
import { collectProviders, resolveProvider } from "@poe-code/poe-agent-rust";

const providers = collectProviders(plugins);
const provider = resolveProvider(providers, "openai/gpt-5");
const model = await provider.createModel("openai/gpt-5", context);
```

This private experimental package currently provides runtime foundations. Agent builders, built-in plugins and session adapters are still being implemented. Existing consumers retain `@poe-code/poe-agent`. Shipped declarations describe supported APIs and their structural contracts only. Native artifact checks currently cover macOS arm64; additional platforms and Python bindings remain pending. Small Node-to-Rust calls can be slower than the original TypeScript implementation.

```typescript
import { createAgentSessionStore } from "@poe-code/poe-agent-rust";

const store = createAgentSessionStore();
await store.save(session);
const restored = await store.load(session.threadId);
```

Conversation records live under `~/.poe-code/sessions` by default. Set `homeDir` or inject an `fs` implementation to choose storage. Loaded records require version 1, conversation metadata and supported message/tool-result content. Missing records return `undefined`; unsafe thread paths, invalid messages and unsupported versions are rejected. Session files currently share the Rust parser's 16 MiB/depth-128/262,144-value limits, so unrestricted file interoperability remains incomplete. Saving uses standard JavaScript serialization and keeps its hook/error behavior.

Use `createMemorySessionStore(id)` for isolated entry snapshots, or `await createJsonlSessionStore(id, directory, { fs })` for ordered persistent history. Replay preserves valid records and ignores an incomplete final JSON line; malformed complete lines and invalid entries report context. A failed append also rejects subsequent writes, replay and disposal. Memory-store disposal releases entries and permits reuse. JSONL records and memory snapshots share the parser limits above; an oversized final record is rejected rather than silently discarded.

`ToolRegistry` registers tools, resolves names, lists all tools and selects active tools. Model tools are always visible; internal tools remain hidden; skill tools use exact names or dot/underscore namespace selectors. Invocations preserve synchronous results, promises, streaming generators and original failure causes. Registry copies share normalized snapshots within the same implementation. Like the original private-field registry, `copyFrom` does not accept registries from a different implementation.

`createResolvedAgentConfig` snapshots and freezes plugin configuration while
retaining callbacks. Tool input schemas receive independent recursive copies.
MCP server snapshots own argument/environment values. `resolvePluginSetupOrder`
normalizes both dependency aliases, rejects duplicate/unknown/self/cyclic
dependencies and keeps stable order. Its Rust planner uses iterative frames;
JavaScript getters are evaluated only when the corresponding plugin is visited.
These foundations support the pending agent builder and execution rewrite.

`runPluginSetup(plugins, context)` registers tools, prompt transforms and hooks
before each plugin's setup callback, then waits for queued MCP discovery. Completed
plugins dispose in reverse order. Setup, discovery and disposal failures retain
their causes, including multiple concurrent failures.

`PluginApiImpl` adds and looks up tools and discovers stdio MCP servers. Discovered
tools use server namespaces and retain multimodal content, tool signals and
structured errors. Discovery rejects repeated cursors and continuations beyond
128 pages. The Rust MCP client and OAuth implementation are embedded in the same
addon, with no npm runtime dependencies. Node supplies subprocesses, streams and
plugin callbacks. Built-in plugins and higher-level session adapters remain pending.

`createFileAwarenessTracker(cwd)` records normalized file reads and writes in
ordered, deduplicated Rust sets. Snapshots return independent JavaScript Sets.
`recordToolFileAwareness` recognizes `read_file`, `write_file` and `edit`,
ignoring missing/blank paths and other tools without changing their arguments.

`HookRegistry` runs all callbacks in registration order and returns the first
defined decision, including callbacks added during a run. Hook decisions support
blocking, argument rewrites, result patches, input transforms/handled responses,
event-specific skipping and abort disposal. Context factories preserve caller
references. Abort errors retain disposal causes; legacy rejection warns once.
Rust owns callback ordering and staged decision policy, while Node executes
callbacks, property effects and disposal. `copyFrom` accepts registries from the
same implementation, matching the original private-field restriction.

`PromptRegistry` compiles sequential prompt transforms while retaining opaque
metadata, extension properties and callbacks. The supplied user prompt is restored
after every transform. Registrations made during compilation are included; copies
share callbacks within the same implementation. Rust owns live callback ordering
and Node retains callback execution and object spread effects.

`createRunContext` supplies isolated tools, prompts, hooks, conversation/session
state, file awareness and child-run tracking. Disposal aborts the context and runs
cleanup callbacks in reverse order, logs failures and retries only failed callbacks.
Concurrent disposal calls share the ongoing attempt; successful disposal is
idempotent. Public collections retain their normal JavaScript mutation behavior.
Rust owns disposal ordering and failed-hook retirement. Successful callback
references are released after each completed attempt, including failed attempts.

Structured tool-result helpers preserve text, image and error parts, array identity,
and host serialization/fallback behavior. Rust validates fields in observable
short-circuit order, including changing/inherited getters, and formats image
labels without changing UTF-16. Sparse arrays follow JavaScript array traversal.
These small binding calls remain slower than TypeScript in current benchmarks.

`collectBranch`, `findHead` and `buildMessages` reconstruct session conversations,
including tool calls/results and compaction summaries. Branches keep original entry
references and use the latest duplicate ID. Parent properties are read only on the
selected branch. Rust owns identity lookup, traversal and staged entry-kind
classification; Node retains serialization and opaque message content. Repeated
branch IDs reject as cycles, protecting against unbounded traversal. This also
rejects a changing parent getter that deliberately revisits an ID before ending.

`mapAcpEventToSessionUpdates(event)` builds ACP replay updates in Rust while
preserving opaque tool payloads. `createTranscriptWriter({ logPath, fs })` appends
one JSON line per update, creates the directory once and rejects symlink paths.
Serialization hooks and filesystem failures preserve their original causes; a
failed append or serialization permits a later write. Closing has no persistent
file handle to release and permits subsequent writes.

The runtime's model-stream collector assembles text, signed thinking, opaque
reasoning payloads and interleaved tool calls in Rust. It keeps exact raw argument
strings, emits an early intent once valid JSON arrives and preserves final usage
and stop snapshots. Superseded snapshots and parsed early-intent payloads release
their GC roots during collection. Node supplies async iteration, JSON parsing and
callbacks. The execution loop uses this collector; current per-event napi benchmarks are
slower than the TypeScript collector.

`runAcpCore({ prompt, runContext, host, model })` streams one agent run. It runs
lifecycle/iteration/tool hooks, compiles prompts, calls the model, awaits host
tool acknowledgements and records assistant/tool history. It preserves multimodal
results, reasoning and raw arguments in follow-up requests. Run limits, failed
model stops and cancellation produce one terminal error. Stop hooks precede
disposal; a failed disposal can retry on the error path. Rust owns FIFO queue
admission, terminal/stop/disposal state, iteration numbering and message layouts.
Node schedules asynchronous operations and performs callback, spread, serialization
and AbortSignal effects. This remains a hybrid runtime; small mocked runs are
currently slower than TypeScript.

`AgentHost` executes plugin tools, forwards progress/text yields and dispatches
notification hooks. Forks copy tools, prompts and hooks into isolated child contexts
while tracking child runs and linking parent cancellation. `spawn(prompt)` consumes
an injected ACP client, collects text chunks and disposes the client after success
or failure. Spawn cancellation is independent of the parent, matching the original.
Rust owns invocation close admission, fork numbering, event layouts and UTF16 spawn
output. Node owns generators, clients and callbacks. Pass `createSpawnSession` in
the constructor; process/in-memory spawn factories are still being implemented.
