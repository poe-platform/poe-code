---
kind: pipeline
version: 1
tasks:
  - id: runtime-types
    title: Define internal runtime types and barrel
    prompt: >
      Create `packages/poe-agent/src/runtime/types.ts` and

      `packages/poe-agent/src/runtime/index.ts` (barrel).


      `AcpEvent` is the canonical event type used everywhere — not to be confused with

      the wire protocol `SessionUpdate` in `@poe-code/poe-acp-client`. The old rendering

      `AcpEvent` in `@poe-code/agent-spawn` is replaced by this.


      **AcpEvent** — the poe-agent runtime event stream:

      - `{ type: "message.delta"; content: string }`

      - `{ type: "tool.intent"; intentId: string; tool: string; args: unknown }`

      - `{ type: "tool.result"; intentId: string; result: unknown }`

      - `{ type: "tool.error"; intentId: string; error: string }`

      - `{ type: "fork.start"; forkId: string; prompt: string }`

      - `{ type: "fork.complete"; forkId: string; result: ForkResult }`

      - `{ type: "fork.error"; forkId: string; error: string }`

      - `{ type: "progress"; message: string }`

      - `{ type: "session.complete"; result: RunResult }`

      - `{ type: "session.error"; error: Error }`


      **AcpHost** — single extension point between core and execution modes:

      ```ts

      type AcpHost = {
        handle(intent: ToolIntent): Promise<ToolAckResult>;
        fork(request: ForkRequest): Promise<ForkResult>;
        spawn(prompt: string): Promise<RunOutput>;
      };

      type ToolIntent = { intentId: string; tool: string; args: unknown };

      type ToolAckResult = { status: "success" | "error"; result: unknown };

      ```


      **Fork types** — fork is mid-run (parent-child, abort cascades):

      ```ts

      type ForkRequest = { forkId: string; prompt: string; context: RunContextSnapshot };

      type ForkResult = { output: string; messages: ChatMessage[] };

      ```


      **ToolContext** — passed to every tool `call()`:

      ```ts

      type ToolContext = {
        fork(prompt: string): Promise<ForkResult>;
        spawn(prompt: string): Promise<RunOutput>;
        signal: AbortSignal;
      };

      ```


      **Tool / NormalizedTool**:

      ```ts

      type Tool = {
        name: string;
        description?: string;
        inputSchema?: unknown;
        visibility?: "model" | "skill" | "internal";
        call(args: unknown, ctx: ToolContext): unknown | Promise<unknown> | AsyncGenerator<ToolEvent, unknown, void>;
      };

      type NormalizedTool = {
        name: string;
        description?: string;
        inputSchema?: unknown;
        visibility: "model" | "skill" | "internal";
        invoke(args: unknown, ctx: ToolContext): AsyncGenerator<ToolEvent, unknown, void>;
      };

      ```


      Also define `RunResult`, `RunOutput`, `RunContextSnapshot`, `ChatMessage`,

      `ToolCallRecord` (keep minimal — expand as needed).


      Export everything from the barrel. These are internal — do not re-export from

      the package's main `index.ts` yet.
    status:
      implement: done
      refactor: done
      test: done
  - id: plugin-types
    title: Define AgentPlugin, PluginApi, and hook/prompt types
    prompt: |
      Create `packages/poe-agent/src/runtime/plugin-types.ts`.

      **AgentPlugin** — Vite-style, hooks are named methods:
      ```ts
      type AgentPlugin = {
        name: string;
        tools?: Tool[];
        prompt?(ctx: PromptContext): PromptContext | Promise<PromptContext>;
        hooks?: {
          preToolUse?(ctx: ToolUseContext): HookDecision | void | Promise<HookDecision | void>;
          postToolUse?(ctx: ToolUseContext): HookDecision | void | Promise<HookDecision | void>;
          preIteration?(ctx: IterationContext): HookDecision | void | Promise<HookDecision | void>;
          postIteration?(ctx: IterationContext): HookDecision | void | Promise<HookDecision | void>;
        };
        setup?(api: PluginApi): void | Promise<void>;
        dispose?(): void | Promise<void>;
      };
      ```

      **PluginApi** — run-scoped, intentionally minimal. MCP is a first-class primitive
      via `api.addMcp()`, not a capability:
      ```ts
      type McpServerConfig = {
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
        visibility?: "model" | "skill";
      };
      type PluginApi = {
        addTool(tool: Tool): void;
        addMcp(config: McpServerConfig): void;
      };
      ```

      **Hook context and decision types**:
      ```ts
      type ToolUseContext = {
        tool: string; args: unknown; intentId: string;
        result?: unknown; error?: string;
        messages: ChatMessage[]; signal: AbortSignal;
      };
      type IterationContext = {
        iterationNumber: number; tokenCount: number;
        messages: ChatMessage[]; signal: AbortSignal;
        fork(prompt: string): Promise<ForkResult>;
      };
      type HookDecision = "skip" | "abort" | { reject: string } | void;
      ```

      **PromptContext**:
      ```ts
      type PromptContext = {
        baseSystemPrompt?: string;
        system?: string;
        userPrompt: string;
        metadata?: Record<string, unknown>;
      };
      ```

      **Runtime errors** — create `packages/poe-agent/src/runtime/errors.ts`:
      - `DuplicateToolError` — thrown during tool registration on name collision
      - `PluginSetupError` — wraps original error, names the failing plugin
      - `PromptTransformError` — wraps original error, names the failing plugin
    status:
      implement: done
      refactor: done
      test: done
  - id: commit-types
    title: Commit runtime types and plugin types
    prompt: |
      Commit all work from Phases 1–2:
      - AcpEvent, AcpHost, fork/tool types and runtime barrel
      - AgentPlugin, PluginApi (addTool, addMcp), hook types, PromptContext
      - Runtime error types (DuplicateToolError, PluginSetupError, PromptTransformError)

      All types compile. All tests pass.
    status:
      commit: done
  - id: tool-registry
    title: Implement ToolRegistry with normalization and visibility
    prompt: |
      Create `packages/poe-agent/src/runtime/tools.ts`.

      **Normalization** — `normalizeTool(tool: Tool): NormalizedTool`:
      - Sync `call()` → async generator (yields nothing, returns result)
      - Async `call()` → async generator (yields nothing, returns awaited result)
      - Async generator → used directly

      **ToolRegistry**:
      ```ts
      class ToolRegistry {
        register(tool: Tool): void;          // normalizes; throws DuplicateToolError on collision
        get(name: string): NormalizedTool | undefined;
        getAll(): NormalizedTool[];
        getActiveTools(activeSkills?: string[]): NormalizedTool[];
      }
      ```

      `getActiveTools` computes the per-run model-visible view:
      - `"model"` (default): always visible
      - `"skill"`: visible only when a matching skill activates it
      - `"internal"`: never visible to model, callable by plugins via `get()`

      MCP tools retain their namespace prefix (`server.tool`) which avoids collisions.
    status:
      implement: done
      refactor: done
      test: done
  - id: prompt-pipeline
    title: Implement prompt transform pipeline
    prompt: |
      Create `packages/poe-agent/src/runtime/prompts.ts`.

      ```ts
      class PromptRegistry {
        addTransform(fn: PromptTransform): void;
        async compile(userPrompt: string, baseSystemPrompt?: string): Promise<PromptContext>;
      }
      ```

      `compile` builds initial `PromptContext` then chains all registered `prompt()`
      transforms in registration order. `userPrompt` must never be merged early — stays
      explicit through the entire pipeline.
    status:
      implement: done
      refactor: done
      test: done
  - id: hook-system
    title: Implement hook registry, context builders, and decision dispatch
    prompt: |
      Create `packages/poe-agent/src/runtime/hooks.ts`.

      **HookRegistry**:
      ```ts
      class HookRegistry {
        add(plugin: AgentPlugin): void;
        async run(event: HookEvent, ctx: HookContext): Promise<HookDecision>;
      }
      ```

      Execution semantics:
      - Multiple hooks on the same event run in registration order
      - All hooks run even after a non-continue decision (they observe)
      - First non-continue decision wins
      - `void`/`undefined` means `"continue"`

      Add factory functions that build `HookContext` for each hook point. Context is
      mutable — hooks can modify `args`, `messages` directly.

      **Decision dispatch** — `applyHookDecision(event, decision, ctx)`:
      - `"skip"` on pre-hooks: skips the operation; no-op on post-hooks
      - `{ reject: msg }` on `preToolUse`: returns error to model as tool error (model can recover)
      - `"abort"`: triggers run disposal and `AbortError`
    status:
      implement: done
      refactor: done
      test: done
  - id: run-context-and-setup
    title: Implement RunContext, PluginApi, and plugin setup orchestration
    prompt: |
      Create `packages/poe-agent/src/runtime/run-context.ts` and
      `packages/poe-agent/src/runtime/plugin-api-impl.ts` and
      `packages/poe-agent/src/runtime/plugin-setup.ts`.

      **RunContext** — all mutable state for a single run:
      - Conversation history, ToolRegistry, PromptRegistry, HookRegistry
      - Active skills list, AbortController, child-run bookkeeping
      - Fresh per `.run()` call — never shared between runs

      **Disposal** — hooks run in reverse registration order:
      - If a hook throws, log and continue; after all hooks, throw `AggregateError`
      - `setup()` failure triggers disposal for already-setup plugins (reverse order)
      - Idempotent — calling dispose twice is safe

      **PluginApi** — thin facade over RunContext registries:
      - `addTool` → ToolRegistry
      - `addMcp(config)` → creates `StdioTransport` internally via `@poe-code/tiny-mcp-client`,
        calls `new McpClient({ transport })`, discovers tools during `setup()`, namespaces
        them as `{config.name}.{tool.name}`, disposes client at run end

      **Plugin setup orchestration** (`runPluginSetup`) — runs in registration order:
      1. For each plugin: register static `tools`, register `prompt` transform, call `setup(api)`
      2. On failure: wrap in `PluginSetupError`, dispose already-setup plugins in reverse order
    status:
      implement: done
      refactor: done
      test: done
  - id: commit-registries-and-runtime
    title: Commit registries, hooks, run context, and plugin setup
    prompt: |
      Commit all work from Phases 3–8:
      - Tool registry with normalization and visibility
      - Prompt transform pipeline
      - Hook registry, context builders, decision application
      - RunContext with disposal
      - PluginApi implementation (addTool, addMcp)
      - Plugin setup orchestration (registration order)

      All tests pass. `npm run test && npm run lint`.
    status:
      commit: done
  - id: acp-core
    title: Implement ACP core model loop and event stream
    prompt: |
      Create `packages/poe-agent/src/runtime/acp-core.ts`.

      The ACP core always operates in intent mode — it never executes tools directly.
      The core only proposes; the host decides.

      **Intent emission** — for each model tool call:
      1. Run `preToolUse` hooks — if skip/reject, handle accordingly
      2. Emit `tool.intent` to host via `AcpHost.handle(intent)`
      3. Suspend — wait for `ToolAckResult`
      4. Run `postToolUse` hooks
      5. Inject result into conversation history

      **Iteration loop**:
      ```
      while not done:
        preIteration hooks
        compile prompt from PromptRegistry
        preIteration (if not skipped) → send to model
        for each tool call in model response:
          preToolUse → emit intent → wait for ack → postToolUse
        postIteration hooks
        if model produced final response (no tool calls) → session.complete
      ```

      Emit `message.delta` as tokens stream, `session.complete` on finish,
      `session.error` on unrecoverable errors. Respect the run's `AbortSignal`.

      **Event stream** — expose as `AsyncIterable<AcpEvent>` (public API contract):
      ```
      message.delta* → tool.intent → tool.result → message.delta* → ... → session.complete
      ```
      Exactly one terminal event. Stream ends after terminal. Consumable via `for await...of`.
    status:
      implement: done
      refactor: done
      test: done
  - id: agent-host
    title: Implement AgentHost with direct execution, fork, and spawn
    prompt: |
      Create `packages/poe-agent/src/runtime/agent-host.ts`.

      **AgentHost** — the simplest `AcpHost`. Both `.run()` and `.stream()` use this.

      When receiving a `ToolIntent`:
      1. Look up `NormalizedTool` by name
      2. If not found → `{ status: "error", result: "Unknown tool: <name>" }`
      3. Execute `tool.invoke(args, ctx)` consuming the async generator
      4. Catch errors → `{ status: "error", result: errorMessage }`
      5. Return `{ status: "success", result }`

      **fork()** — clones live run state:
      - What gets cloned: full conversation history, all tools, capabilities, prompt pipeline
      - What is new: new prompt, derived `AbortController` (aborting parent aborts children),
        new event stream, new model loop turn
      - Emits `fork.start`/`fork.complete`/`fork.error` on parent's event stream

      **spawn()** — starts a fresh independent agent instance via `AcpClient`:
      ```ts
      import { AcpClient } from "@poe-code/poe-acp-client";

      // In-process (poe-agent session):
      const transport = createInMemoryAcpTransport(/* new poe-agent session */);
      const client = new AcpClient({ transport });

      // External agent (Claude Code, Codex, etc.):
      const client = new AcpClient({ command: binaryName, args: spawnArgs, cwd });
      ```

      Spawn does NOT propagate the parent `AbortSignal` — independent run.
      Spawn does NOT emit fork events — it is a tool call like any other.

      Reference: `src/providers/poe-agent.ts` for the existing in-memory transport pattern.
    status:
      implement: done
      refactor: done
      test: done
  - id: commit-acp-core
    title: Commit ACP core, agent host, fork, and spawn
    prompt: |
      Commit all work from Phases 9–10:
      - ACP core with intent emission, iteration loop, event stream
      - AgentHost with direct tool execution
      - Fork mechanism with context cloning and abort cascading
      - Spawn via AcpClient (in-process + external modes)

      All tests pass. `npm run test && npm run lint`.
    status:
      commit: done
  - id: builder
    title: Implement immutable AgentBuilder with .run() and .stream()
    prompt: >
      Create `packages/poe-agent/src/runtime/config.ts` and `packages/poe-agent/src/agent.ts`.


      **ResolvedAgentConfig** — frozen snapshot the builder produces:

      ```ts

      type ResolvedAgentConfig = {
        model?: string;
        plugins: AgentPlugin[];
        mcpServers: McpServerConfig[];
      };

      ```


      **AgentBuilder** — every method returns a new builder:

      ```ts

      function agent(): AgentBuilder;

      // .model(model) — new builder with model set

      // .use(plugin) — defensively clones, returns new builder

      // .mcp(...configs) — shorthand for registering MCP servers without writing a plugin

      ```


      Reusing a builder must not leak state:

      ```ts

      const base = agent().model("gpt-5").use(memory());

      const researcher = base.use(web());    // base unchanged

      const writer = base.use(docTools());   // base still unchanged

      ```


      **`.run(prompt, options?)`** — full lifecycle:

      1. Create fresh RunContext with AbortController

      2. Validate dependencies, compute topological order

      3. Run plugin setup (via PluginApi); `.mcp()` configs added as if plugins

      4. Compile prompt from PromptRegistry

      5. Compute active tools; inject resume messages if `options.resume`

      6. Create AgentHost wired to ToolRegistry

      7. Run ACP core model loop

      8. Dispose RunContext (always, even on error)

      9. Return `RunResult = { output: string; messages: ChatMessage[]; toolCalls: ToolCallRecord[]
      }`


      **`.stream(prompt, options?)`** — same AgentHost, yields `AcpEvent` as `AsyncIterable`

      instead of collecting internally.
    status:
      implement: done
      refactor: done
      test: done
  - id: execution-modes
    title: Implement .acp() execution mode, resume support, and abort propagation
    prompt: |
      Add `.acp()`, resume, and cancellation to `AgentBuilder`.

      **`.acp(prompt, options?)`** — exposes ACP core directly; caller is the host:
      ```ts
      type AcpSession = {
        events: AsyncIterable<AcpEvent>;
        acknowledge(intentId: string, result: ToolAckResult): void;
        dispose(): Promise<void>;
      };
      ```
      Every `tool.intent` flows to the caller; caller must `acknowledge()` each.
      Like `.run()`, `.acp()` is async because plugin `setup()` runs first.

      **Resume** — `RunOptions = { signal?: AbortSignal; skills?: string[]; resume?: RunResult }`:
      - Injects previous run's message history before the model loop starts
      - Caller owns the result and passes it back explicitly — no hidden persistent state
      ```ts
      const r1 = await agent().use(memory()).run("Read the test file");
      const r2 = await agent().use(memory()).run("Now fix it", { resume: r1 });
      ```

      **Abort propagation** — each run owns an `AbortController`; signal propagates to:
      - Every tool invocation via `ctx.signal`
      - MCP client calls
      - Child runs via `ctx.fork()` (derived controller — aborting parent aborts children)
      - Async-generator tools via `.return()` when signal fires

      On abort: model loop stops, in-flight tools receive signal, disposal hooks run in
      reverse, run rejects with `AbortError`.
    status:
      implement: done
      refactor: done
      test: done
  - id: commit-builder-and-modes
    title: Commit builder, execution modes, resume, and cancellation
    prompt: |
      Commit all work from Phases 11–12:
      - ResolvedAgentConfig
      - Immutable AgentBuilder with .model(), .use(), .mcp()
      - .run() end-to-end lifecycle
      - .stream() async iterable
      - .acp() session mode
      - Resume support
      - Abort signal propagation and cleanup lifecycle

      All tests pass. `npm run test && npm run lint`.
    status:
      commit: done
  - id: builtin-plugins
    title: Create built-in plugins and remove DefaultToolExecutor
    prompt: >
      Extract all built-in tools from `DefaultToolExecutor` into declarative plugins.


      Create these files (each `export default` factory, no internal types exported):

      - `packages/poe-agent/src/plugins/poe-agent-plugin-system-prompt.ts`

      - `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts`

      - `packages/poe-agent/src/plugins/poe-agent-plugin-shell.ts`

      - `packages/poe-agent/src/plugins/poe-agent-plugin-web.ts`


      ```ts

      const systemPromptPlugin = (): AgentPlugin => ({
        name: "poe-agent-plugin-system-prompt",
        prompt(ctx) {
          return { ...ctx, system: [loadSystemPromptContent(), ctx.system].filter(Boolean).join("\n") };
        },
      });

      export default systemPromptPlugin;

      ```


      Each tool plugin follows the same pattern:

      ```ts

      const fileTools = (): AgentPlugin => ({
        name: "poe-agent-plugin-files",
        tools: [readFileTool, editFileTool, listFilesTool],
      });

      export default fileTools;

      ```


      Same names, schemas, and behavior as current tools — no semantic changes.


      After all tools are plugins, remove the hardcoded `switch` routing from

      `packages/poe-agent/src/tool-executor.ts`. Either delete or reduce to a thin adapter.
    status:
      implement: done
      refactor: done
      test: done
  - id: mcp-plugin-pattern
    title: Implement MCP server plugin pattern via api.addMcp()
    prompt: >
      An MCP server plugin is a plain `AgentPlugin` — same shape as `spawn`. It calls

      `api.addMcp()` with plain config; the runtime creates the transport internally.

      No transport import required in plugin code.


      ```ts

      import type { AgentPlugin } from "../runtime/plugin-types.js";


      interface MyServerOptions {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }


      const myServer = (options: MyServerOptions): AgentPlugin => ({
        name: "my-server-mcp",
        setup(api) {
          api.addMcp({ name: "my-server", command: options.command, args: options.args, env: options.env });
        },
      });

      export default myServer;

      ```


      `McpServerConfig` matches `McpSpawnServer` from `@poe-code/agent-spawn` — callers

      already know this shape. Runtime creates `StdioTransport` internally, calls

      `new McpClient({ transport })`, discovers tools, namespaces as `{name}.{tool}`,

      disposes at run end.


      Any plugin or skill can call `api.addMcp()`. Do not ship pre-built server plugins

      for specific services — document the pattern, let callers write their own.


      For testing, use `createInMemoryTransportPair` from `@poe-code/tiny-mcp-client`.
    status:
      implement: done
      refactor: done
      test: done
  - id: skills-and-spawn-plugins
    title: Implement skills and spawn plugins
    prompt: >
      Create `packages/poe-agent/src/plugins/poe-agent-plugin-skills.ts` and

      `packages/poe-agent/src/plugins/poe-agent-plugin-spawn.ts`.


      **Skills plugin** — activates hidden tools and injects usage guidance:

      1. Accepts skill definitions mapping skill names to tool names/tags

      2. Reads `options.skills` at run time to determine active skills

      3. Passes active skills to `ToolRegistry.getActiveTools()` to expose `skill`-visibility tools

      4. Injects prompt guidance for active skills


      Skills call `api.addMcp()` with `visibility: "skill"` to register tools hidden by default:

      ```ts

      setup(api) {
        api.addMcp({ name: "github", command: "uvx", args: ["mcp-server-github"], visibility: "skill" });
      }

      ```


      **Spawn plugin** — gives the model a tool that spawns a fresh sub-agent:

      ```ts

      const spawn = (): AgentPlugin => ({
        name: "spawn",
        tools: [{
          name: "spawn",
          description: "Spawn a fresh sub-agent to handle a sub-task",
          inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
          async call(args, ctx) {
            return ctx.spawn((args as { task: string }).task);
          },
        }],
      });

      export default spawn;

      ```


      Uses `ctx.spawn()` (not `ctx.fork()`). Independent run — parent abort does NOT cascade.

      Both files: `export default` factory only, no internal types exported.
    status:
      implement: done
      refactor: done
      test: done
  - id: migration
    title: Wire createAgentSession as adapter and export public API
    prompt: >
      **Session adapter** — refactor `packages/poe-agent/src/agent-session.ts`:

      ```ts

      export async function createAgentSession(options: CreateAgentSessionOptions) {
        const builder = agent()
          .model(resolveModel(options))
          .use(systemPromptPlugin())
          .use(fileTools())
          .use(shellTools())
          .use(webTools())
          .use(mcpPluginFromOptions(options));
        return adaptAcpToLegacySession(builder);
      }

      ```

      Public API must not change. Two surfaces depend on it:

      - `src/providers/poe-agent.ts` — adapts session into ACP lifecycle; use `.acp()` internally

      - `src/cli/commands/agent.ts` — CLI agent command


      **Public API exports** — update `packages/poe-agent/src/index.ts`:

      New exports: `agent()`, `AgentPlugin`, `AgentBuilder`, `PluginApi`, `Tool`, `ToolContext`,

      `PromptContext`, `AcpEvent`, `AcpHost`, `AcpSession`, `RunResult`, `RunOptions`,
      `HookDecision`


      Keep internal: `NormalizedTool`, all registries, `RunContext`, `AgentHost`, `PluginApiImpl`.


      Third-party plugins are ordinary npm packages:

      ```ts

      import type { AgentPlugin } from "@poe-code/poe-agent";

      export function jira(options: JiraOptions): AgentPlugin { ... }

      ```
    status:
      implement: done
      refactor: done
      test: done
  - id: e2e-core
    title: E2E tests - basic run, immutable builder, and streaming
    prompt: |
      Write e2e tests for the core runtime path. Use mock model/LLM per
      docs/SNAPSHOT_TESTING.md.

      **Basic run** — verify full lifecycle:
      ```ts
      const result = await agent()
        .model("test-model")
        .use(systemPromptPlugin()).use(fileTools()).use(shellTools())
        .run("Read the file at /tmp/test.txt");
      ```
      Verify: plugin setup → prompt compilation → model call → tool intent →
      host execution → tool result injection → final output → disposal.

      **Immutable builder** — prove state isolation:
      ```ts
      const base = agent().model("test-model").use(systemPromptPlugin()).use(fileTools());
      const researcher = base.use(webTools());
      const writer = base.use(shellTools());
      ```
      Verify: base unchanged, researcher has web but not shell, writer has shell but not web,
      no state leakage between runs.

      **Streaming** — verify event ordering:
      ```ts
      const events: AcpEvent[] = [];
      for await (const e of agent().use(tools()).stream("Do something")) { events.push(e); }
      ```
      Verify: `message.delta` events contain output, `tool.intent`/`tool.result` pairs
      match by `intentId`, exactly one `session.complete` at the end.
    status:
      implement: done
      refactor: done
      test: done
  - id: e2e-hooks
    title: E2E tests - hook-based guardrails and token budget
    prompt: |
      **Guardrails** — `preToolUse` hook blocks forbidden commands and returns rejection:
      ```ts
      const guardrails = (): AgentPlugin => ({
        name: "guardrails",
        hooks: {
          preToolUse(ctx) {
            if (ctx.tool === "run_command" && isForbidden(ctx.args)) {
              return { reject: "Blocked forbidden command" };
            }
          },
        },
      });
      ```
      Verify: forbidden command rejected, model receives error as tool result, model
      recovers with alternative, non-forbidden commands execute normally.

      **Token budget** — `postIteration` hook aborts when budget exceeded:
      ```ts
      const tokenBudget = (max: number): AgentPlugin => {
        let total = 0;
        return {
          name: "token-budget",
          hooks: {
            postIteration(ctx) {
              total += ctx.tokenCount;
              if (total > max) return "abort";
            },
          },
        };
      };
      ```
      Verify: run aborts when budget exceeded, disposal runs, error is AbortError,
      runs within budget complete normally.
    status:
      implement: done
      refactor: done
      test: done
  - id: e2e-fork-and-mcp
    title: E2E tests - spawn plugin and MCP server plugin
    prompt: |
      **Spawn** — use mock model that produces a `spawn` tool call:
      ```ts
      const result = await agent().model("test-model").use(spawn()).use(fileTools())
        .run("Investigate the regression");
      ```
      Verify: spawn tool call triggers a fresh independent agent run, child starts with
      clean state (not cloned), child completes and result flows back as tool result,
      parent continues after receiving spawn result.
      Also verify independence: aborting parent does NOT abort the spawned child.

      **MCP plugin** — use `createInMemoryTransportPair` to avoid spawning a real process:
      ```ts
      const result = await agent().model("test-model")
        .use(testMcpServer())  // plugin backed by in-memory MCP server
        .run("Use the tools");
      ```
      Verify: MCP tools discovered during `setup()`, registered with correct namespaced names,
      callable by the model, MCP client disposed when run ends.
    status:
      implement: done
      refactor: done
      test: done
  - id: e2e-control-flow
    title: E2E tests - ACP session, cancellation, and resume
    prompt: |
      **ACP session** — caller as host:
      ```ts
      const session = await agent().use(tools()).acp("Do something");
      for await (const event of session.events) {
        if (event.type === "tool.intent") {
          session.acknowledge(event.intentId, await executeLocally(event));
        }
      }
      await session.dispose();
      ```
      Verify: tool intents flow to caller, acknowledgments unblock model loop,
      session completes, dispose cleans up.

      **Cancellation** — external abort:
      ```ts
      const controller = new AbortController();
      const promise = agent().use(tools()).run("Long task", { signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow(/abort/i);
      ```
      Verify: signal propagates to in-flight tools, model loop stops, disposal runs,
      rejects with AbortError. Also test abort cascades to child forks.

      **Resume** — continuation across runs:
      ```ts
      const r1 = await agent().use(tools()).run("Read the test file");
      const r2 = await agent().use(tools()).run("Now fix the assertion", { resume: r1 });
      ```
      Verify: second run sees first run's conversation history, each run has independent
      disposal, no hidden persistent state.
    status:
      implement: done
      refactor: done
      test: done
  - id: e2e-provider-compat
    title: E2E test - provider and CLI compatibility verification
    prompt: |
      Run the full compatibility check to verify the refactor is transparent to consumers:

      1. `npm run test` — all unit tests pass (provider, session, chat, MCP tests)
      2. `npm run lint` — no lint errors
      3. `npm run e2e:verbose` — all existing e2e tests pass
      4. `npm run build` — package builds successfully

      Specifically verify `src/providers/poe-agent.ts` and `src/cli/commands/agent.ts`
      work without changes. The provider continues using `createAgentSession(...)` which
      now internally delegates to the new runtime.
    status:
      implement: done
      refactor: done
      test: done
  - id: remove-poe-agent-from-spawn
    title: Remove poe-agent from regular spawn path
    prompt: |
      Remove `poe-agent` as a spawnable agent from the regular spawn path.
      The poe-agent runtime should only be reachable via the ACP host interface
      from within a running agent session.

      Remove from `src/sdk/spawn.ts`:
      - The `if (service === "poe-agent")` branch
      - The `spawnPoeAgentWithAcp` import
      - Clean up surrounding dispatch logic if this was the only special-case branch

      Do NOT remove:
      - `src/providers/poe-agent.ts` — powers the ACP session host
      - `createAgentSession` — still the public entry point for poe-agent sessions

      Update any tests that rely on the removed spawn path.
    status:
      implement: done
      refactor: done
      test: done
  - id: commit-final
    title: Commit plugins, migration, public API, e2e tests, and poe-agent spawn removal
    prompt: |
      Commit all remaining work from Phases 13–17:
      - Built-in plugins (system prompt, file tools, shell, web)
      - DefaultToolExecutor removal
      - MCP server plugin pattern
      - Skills and spawn plugins
      - createAgentSession migration
      - Public API exports
      - All e2e tests
      - poe-agent removed from regular spawn path

      All tests pass. `npm run test && npm run lint && npm run e2e:verbose`.
    status:
      commit: done
  - id: example-plugins-simple
    title: "Example plugins: prompt transform, async context, and audit log"
    prompt: >
      Write three reference plugins (each `export default`, no internal types exported):


      **Environment** — simplest possible, just a prompt transform:

      ```ts

      const environment = (cwd: string): AgentPlugin => ({
        name: "environment",
        prompt(ctx) {
          return { ...ctx, system: [ctx.system, `Working directory: ${cwd}`, `Node: ${process.version}`]
            .filter(Boolean).join("\n") };
        },
      });

      export default environment;

      ```

      Unit test: call `plugin.prompt!({ userPrompt: "x" })`, verify returned `system` contains
      expected strings.


      **Git context** — async prompt transform:

      ```ts

      const gitContext = (cwd: string): AgentPlugin => ({
        name: "git-context",
        async prompt(ctx) {
          const [status, log] = await Promise.all([
            exec("git", ["status", "--short"], { cwd }).then(r => r.stdout).catch(() => ""),
            exec("git", ["log", "--oneline", "-5"], { cwd }).then(r => r.stdout).catch(() => ""),
          ]);
          return { ...ctx, system: [ctx.system, "## Git context", status, log].filter(Boolean).join("\n") };
        },
      });

      export default gitContext;

      ```

      Unit test: mock `exec`, verify `ctx.system` includes git status and log.


      **Audit log** — `postToolUse` hook, JSONL records per tool call:

      ```ts

      const auditLog = (logPath: string): AgentPlugin => ({
        name: "audit-log",
        hooks: {
          async postToolUse(ctx) {
            await appendFile(logPath, JSON.stringify({ ts: new Date().toISOString(), tool: ctx.tool }) + "\n");
          },
        },
      });

      export default auditLog;

      ```

      Unit test using `memfs`: mock run calling two tools; assert two JSONL records written.
    status:
      implement: done
      test: done
  - id: example-plugins-stateful
    title: "Example plugins: max-iterations abort and scratchpad"
    prompt: >
      Write two reference plugins (each `export default`, no internal types exported):


      **Max iterations** — stateful `preIteration` hook:

      ```ts

      const maxIterations = (limit: number): AgentPlugin => {
        let count = 0;
        return {
          name: "max-iterations",
          hooks: { preIteration() { if (++count > limit) return "abort"; } },
        };
      };

      export default maxIterations;

      ```

      Unit test: run with limit=2, mock model that always calls a tool, verify abort after 2
      iterations.


      **Scratchpad** — stateful tools with state in closure (no capability needed):

      ```ts

      const scratchpad = (): AgentPlugin => {
        const notes = new Map<string, string>();
        return {
          name: "scratchpad",
          tools: [
            {
              name: "write_note",
              call(args) {
                const { key, value } = args as { key: string; value: string };
                notes.set(key, value);
                return `Wrote '${key}'`;
              },
            },
            {
              name: "read_note",
              call(args) {
                return notes.get((args as { key: string }).key) ?? "(no note)";
              },
            },
          ],
        };
      };

      export default scratchpad;

      ```

      Unit test: call `write_note` then `read_note`, verify value roundtrips.

      Also verify two plugin instances produce independent scratchpads.
    status:
      implement: done
      test: done
---

# fluent plugin runtime

Archived local pipeline plan converted from YAML during docs cleanup.
