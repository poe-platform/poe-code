# Poe Agent Fluent Plugin Runtime

## README-Style UX

This is the target user experience for `poe-agent`.

### Basic usage

```ts
import { agent } from "@poe-code/poe-agent";
import { memory } from "@poe-code/poe-agent-plugin-memory";
import { web } from "@poe-code/poe-agent-plugin-web";

const result = await agent()
  .model("openai/gpt-5.2")
  .use(memory())
  .use(web())
  .run("Fix the failing tests");
```

The API should read like configuration first, execution second.

### Reusable base agent

```ts
const base = agent()
  .model("openai/gpt-5.2")
  .use(memory());

const researcher = base.use(web());
const writer = base.use(docTools());

await researcher.run("Research the bug");
await writer.run("Draft the fix summary");
```

This only works if the builder is immutable. Reusing `base` must not leak state
between runs or between derived agents.

### Prompt customization

```ts
const cautious = agent()
  .use({
    name: "cautious-prompt",
    prompt(ctx) {
      return {
        ...ctx,
        system: [ctx.system, "Prefer minimal diffs and validate changes."].filter(Boolean).join("\n"),
      };
    },
  });
```

Prompt changes should feel like a normal plugin contribution, not a special
case bolted onto the runtime.

### Fork as a core primitive with a plugin-provided tool

```ts
const result = await agent()
  .use(spawn())
  .run("Investigate the regression");
```

The `spawn` plugin registers a tool that calls into the core's spawn
mechanism. The tool is a plugin; the spawn operation is core.

```ts
const spawn = (): AgentPlugin => ({
  name: "spawn",
  tools: [
    {
      name: "spawn",
      description: "Spawn a fresh sub-agent to handle a sub-task",
      inputSchema: {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
      },
      async call(args, ctx) {
        return ctx.spawn((args as { task: string }).task);
      },
    },
  ],
});
export default spawn;
```

`ctx.spawn(prompt)` starts a fresh independent agent via `AcpClient`. For
in-process targets (another poe-agent session) it uses an injected in-memory
transport; for external agents (Claude Code, Codex, etc.) it uses the
process-based transport — same `AcpClient` API either way, back-channels
(permissions, fs, terminal) included. `ctx.fork(prompt)` clones the live run
context instead. Spawning uses `spawn` — a clean sub-agent, not a context clone.

### MCP server as a plain plugin

```ts
const base = agent()
  .mcp({ name: "github", command: "uvx", args: ["mcp-server-github"] })
  .mcp({ name: "fs", command: "uvx", args: ["mcp-server-filesystem", "/"] });

await base.run("Investigate this repo");
```

`.mcp(config)` is a first-class builder method — shorthand for registering MCP
servers without writing a plugin. Same config shape as `McpSpawnServer` in
`agent-spawn`, plus an optional `visibility` field. For more control (hooks,
capability provision), a plugin can call `api.addMcp()` in `setup()` instead.

### Third-party plugins as npm packages

```ts
import { jira } from "@acme/poe-agent-plugin-jira";

await agent()
  .use(jira({ baseUrl: process.env.JIRA_URL }))
  .run("Find the ticket linked to this branch");
```

Plugins should be normal npm packages with typed factories, standard semver, and
no custom marketplace requirement.

## Why

The current conversation points toward a runtime that is easier to compose,
safer to reuse, and friendlier to extension than a large hardcoded agent
surface. The biggest constraint is avoiding hidden mutable state while still
supporting async integrations like MCP, sub-agents, and skill-gated tools.

The design also needs to fit the repo's existing direction: declarative,
provider-driven, minimal branching, and no repeated provider-specific logic.

## Current Architecture Inventory

The current `poe-agent` is small enough to refactor incrementally. It is not a
large distributed system yet. The key is to preserve compatibility at the
`createAgentSession(...)` boundary while moving responsibilities behind it.

### Current public surface

`packages/poe-agent/src/index.ts` currently exports only:

- `createAgentSession`
- `AgentSession`
- `CreateAgentSessionOptions`
- MCP server definition types

That is useful for migration because we can add `agent()` alongside the current
API and keep the old session factory as a compatibility layer during the
transition.

### Current runtime composition root

`packages/poe-agent/src/agent-session.ts` currently does all of this in one
place:

- resolves model and API key
- loads the static system prompt
- constructs `DefaultToolExecutor`
- optionally constructs `McpToolExecutor` and tiny-mcp-client transports
- merges built-in and MCP tools into one array
- constructs `PoeChatService`
- maps tool lifecycle events into ACP session updates
- owns disposal

This file is the main seam. It already behaves like a composition root, so the
refactor should keep that role but make it compile a builder config into a run
context rather than manually wiring everything inline.

### Current chat loop

`packages/poe-agent/src/chat.ts` currently owns:

- conversation history
- system prompt injection
- request/response calls to Poe chat completions
- tool-call iteration loop
- tool argument parsing
- tool result injection back into history
- simple tool lifecycle callbacks

This is already the right place for the model loop, but it is too coupled to
the current tool shape and to the mutable conversation array it owns directly.
The code should be reused, not replaced, by moving it behind a run context and
a normalized tool runtime.

### Current built-in tools

`packages/poe-agent/src/tool-executor.ts` hardcodes five tools in one class:

- `read_file`
- `edit_file`
- `list_files`
- `run_command`
- `search_web`

The class has two responsibilities mixed together:

1. tool definitions and schemas
2. tool execution routing through a `switch`

This is the biggest mismatch with the target plugin model. The built-in tools
need to become declarative tool definitions provided by plugins rather than one
large executor with provider-style branching.

### Current MCP support

`packages/poe-agent/src/mcp-tool-executor.ts` is already a useful adaptation
layer:

- namespaced MCP tool names
- converts MCP tools to OpenAI tool schema
- routes tool calls to the correct MCP client
- disposes MCP clients

What it does not support yet:

- visibility levels
- skill-gated exposure
- MCP as a reusable capability for other plugins
- lazy or policy-driven tool exposure

That means the current MCP layer should be promoted into a generic capability
instead of discarded.

### Current prompt model

`packages/poe-agent/src/system-prompt.ts` just returns static prompt content from
`SYSTEM_PROMPT.md`.

This is simple, but it means:

- no prompt composition
- no plugin-based prompt injection
- no skills prompt section
- no run-specific prompt transforms

The current behavior should become one built-in prompt plugin, not a permanent
special case.

### Current external dependencies that must keep working

Two repo surfaces rely directly on `createAgentSession(...)` today:

- `src/providers/poe-agent.ts`
- `src/cli/commands/agent.ts`

The provider also adapts the session into ACP lifecycle methods, so the refactor
should not force a provider rewrite first. The safest migration is:

1. add the new builder/runtime internally
2. implement `createAgentSession(...)` as an adapter on top of it
3. keep provider and CLI behavior stable while internals move

### Current skills state

The repo has CLI support for skill directory configuration in
`src/cli/commands/skill.ts` and a separate `agent-skill-config` package, but
`poe-agent` itself does not currently discover or activate skills.

That matters for the refactor because skill activation belongs in the runtime,
while skill directory installation remains a CLI concern. The two should stay
separate.

## Core Decisions

### 1. Immutable builder, mutable run state

The builder should be immutable:

```ts
agent()
  .use(memory())
  .use(web())
  .mcp({ name: "github", command: "uvx", args: ["mcp-server-github"] })
  .mcp({ name: "fs", command: "uvx", args: ["mcp-server-filesystem", "/"] })
```

Each call returns a new builder with a new config snapshot.

`.mcp(config)` accepts a `McpServerConfig` — same shape as `McpSpawnServer` from
`agent-spawn`, plus optional `visibility`. Shorthand for registering MCP servers
without writing a plugin. The runtime creates a `StdioTransport` internally,
connects, discovers tools, and disposes at run end.

Enforcement rules:

- `.use()` defensively clones plugin config at registration time
- `.mcp()` stores the plain config; transport is created fresh per `.run()`
- plugin factories are called fresh per `.run()`, not once at builder time
- `setup()` receives a `PluginApi` scoped to the run, never to the builder
- the builder itself holds only serializable config; closures and mutable
  references live in the run context

This prevents shared-state leakage when deriving multiple agents from a common
base, even when plugin factories close over external state.

Execution state should be mutable and run-scoped:

- conversation history
- tool outputs
- active skills
- MCP connections
- cancellation state (owned `AbortController`)
- child-run bookkeeping

This split gives safe reuse without giving up normal runtime statefulness.

### 2. Plugins are the main extension mechanism

The primary API should be `.use(plugin)`.

Plugins may contribute:

- tools
- prompt fragments
- prompt transforms
- hooks
- capabilities
- async setup logic
- teardown hooks

Low-level escape hatches can still exist later, but the runtime should optimize
for plugins first.

### 3. Plugins are isolated — state lives in closures

Plugins do not reach into each other directly. Shared state is managed via
closures — each plugin factory call creates its own isolated instance.

```ts
const scratchpad = (): AgentPlugin => {
  const notes = new Map<string, string>();  // isolated per instance
  return {
    name: "scratchpad",
    tools: [
      { name: "write_note", call(args) { ... notes.set(...) ... } },
      { name: "read_note",  call(args) { return notes.get(...); } },
    ],
  };
};
```

MCP is a first-class primitive (`api.addMcp()`, `.mcp()` builder method) — not a
shared capability. There is no capability/dependency injection system.

### 4. Async all the way down at run start

Builder registration stays synchronous.
Runtime setup is asynchronous.

That means this is valid:

```ts
await agent()
  .use(memory())
  .use(mcp(...))
  .run(prompt);
```

But async work happens only when `.run(...)` starts:

- connect MCP clients
- start child processes
- discover tools
- register disposal hooks

### 5. Fork is a core runtime primitive

Fork is not a plugin — it is a core operation owned by the ACP layer. A fork
clones the entire live run context and starts a new turn with a new prompt.

What gets cloned:

- full conversation history up to the fork point
- all registered tools and their current state
- capabilities and their values
- prompt pipeline (fragments + transforms)
- the host binding (child uses the same host as parent)

What is new per fork:

- a new prompt (the child's task)
- a derived `AbortController` (aborting parent aborts all children)
- a new event stream (child events are separate)
- a new model loop turn

Fork is exposed to the model as a tool (provided by a plugin), but the fork
mechanism itself lives in the core because only the core has access to the live
run context mid-execution.

```text
Model loop (parent):
  1. Model requests tool call: spawn("investigate auth bug")
  2. Core emits fork intent to host
  3. Host creates a child run with cloned context + new prompt
  4. Child run executes its own model loop (same host)
  5. Child completes → result returned to parent as tool result
  6. Parent model loop continues
```

The `AcpHost` interface includes fork:

```ts
type AcpHost = {
  handle(intent: ToolIntent): Promise<ToolAckResult>;
  fork(request: ForkRequest): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
};

type ForkRequest = {
  forkId: string;
  prompt: string;
  context: RunContextSnapshot;
};

type ForkResult = {
  output: string;
  messages: ChatMessage[];
};
```

The agent host implements `fork` by creating a new ACP core run with the
cloned context. The ACP host (external) forwards the fork request to the
caller, who decides how to execute it (same process, different process,
different machine).

#### Fork vs resume

| | Fork | Resume |
|---|------|--------|
| When | Mid-run | After run completes |
| Context source | Live run state (cloned) | Previous run result (passed by caller) |
| Relationship | Parent-child (concurrent) | Sequential |
| Abort | Parent abort cascades to children | Independent runs |
| Who initiates | Model (via spawn tool) | Caller (via options) |

### 6. MCP is a plain plugin primitive

An MCP server plugin is a plain `AgentPlugin` using `@poe-code/tiny-mcp-client`
directly — same shape as `spawn`. No `McpCapability`, no `registerServer()`
indirection, no two-plugin setup. `api.addTool()` is the only hook needed for
dynamically discovered tools.

### 7. Tool registration is separate from tool visibility

The runtime should register tools first, then compute which of them are visible
to the model for a particular run.

Visibility levels:

- `model`: always visible to the model
- `skill`: hidden by default, visible when a skill activates it
- `internal`: never visible to the model

This is what makes hidden MCP viable without throwing away discoverability.

### 8. Tool name collisions throw

The runtime must throw during tool registration if a tool with the same name
already exists in the registry. No silent overwrite, no last-write-wins.

This applies equally to built-in tools, plugin-contributed tools, and MCP tools.
MCP tools retain their existing namespace prefix (`server_name.tool_name`) which
naturally avoids collisions with non-MCP tools, but two MCP servers registering
the same namespaced tool name should still throw.

### 9. Plugin setup runs in registration order

All plugin lifecycle methods run in registration order:

- `setup()` — registration order
- `prompt()` transforms — registration order
- `hooks` — registration order (first non-continue decision wins)

### 10. Tool authoring should be flexible, runtime execution should be uniform

Plugin authors should be allowed to expose tools as:

- sync functions
- async functions
- async generator functions

Internally, the runtime should normalize everything to one execution contract,
preferably async-generator-based, so progress events and cancellation work the
same way everywhere.

## Proposed API

### Builder

```ts
const a = agent()
  .model("openai/gpt-5.2")
  .use(memory())
  .use(web())
  .run("Fix the tests");
```

Potential builder surface:

```ts
agent()
  .model("openai/gpt-5.2")
  .use(plugin)
  .run(prompt, options?)
  .stream(prompt, options?)
```

Keep `.use(...)` as the center of gravity. If we later add sugar like
`.prompt(...)` or `.tool(...)`, it should compile down to the same plugin model.

### Plugin shape

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

- `tools` — declarative tool definitions
- `prompt` — async transform over the prompt context
- `hooks` — named lifecycle methods, matching Claude Code hook naming (`preToolUse`, `postToolUse`)
- `setup` — only for async init (MCP connections, dynamic tool discovery)
- `dispose` — cleanup, called after run completes or on abort

Most plugins only need `tools`, `prompt`, or `hooks`. `setup` is the escape hatch
for things that genuinely require async initialization.

### PluginApi

`PluginApi` is intentionally minimal. MCP is a first-class primitive, not a capability:

```ts
type McpServerConfig = {
  name: string;       // namespace prefix → "name.tool_name"
  command: string;
  args?: string[];
  env?: Record<string, string>;
  visibility?: "model" | "skill";  // default: "model"
};

type PluginApi = {
  addTool(tool: Tool): void;              // one-off dynamically constructed tools
  addMcp(config: McpServerConfig): void; // runtime creates StdioTransport, handles lifecycle
};
```

Same shape as `McpSpawnServer` in `agent-spawn`. The runtime creates a `StdioTransport`
internally — callers never import transport classes. Any plugin or skill can call it;
the runtime owns the `McpClient` lifecycle. Visibility is a `ToolRegistry` concern,
not a client concern — `tiny-mcp-client` requires no changes.

`setup` is only needed for dynamic tools (discovered at init time) and MCP. Hooks go
in `plugin.hooks`, prompt transforms in `plugin.prompt`, and cleanup in `plugin.dispose`.

#### Hooks

Hooks follow the same model as Claude Code hooks. There is one hook system,
not two. Every hook can observe, modify state, and control flow.

##### Hook points in the model loop

```text
┌─ PreIteration ────────────────────────────────────────┐
│                                                       │
│  compile prompt from registry                         │
│                                                       │
│  ┌─ PreModelCall ─────────────────────────────────┐   │
│  │  model call (send messages, receive response)  │   │
│  └─ PostModelCall ────────────────────────────────┘   │
│                                                       │
│  for each tool call in response:                      │
│    ┌─ PreToolCall ────────────────────────────────┐   │
│    │  emit intent → host ack → inject result      │   │
│    └─ PostToolCall ───────────────────────────────┘   │
│                                                       │
│  ┌─ PreFork ──────────────────────────────────────┐   │
│  │  (only when a tool calls ctx.fork())           │   │
│  └─ PostFork ─────────────────────────────────────┘   │
│                                                       │
└─ PostIteration ───────────────────────────────────────┘
```

##### Hook naming

Hooks match Claude Code's hook naming convention. Plugin hook methods are the
camelCase equivalents of the Claude Code hook names:

| Method | Claude Code equivalent |
|--------|----------------------|
| `preToolUse` | `PreToolUse` |
| `postToolUse` | `PostToolUse` |
| `preIteration` | — |
| `postIteration` | — |

##### Hook context

Every hook receives a context object with the state relevant to that hook
point. The context is mutable — hooks can modify messages, args, and results.

```ts
type HookContext = {
  // Always available
  event: HookEvent;
  iterationNumber: number;
  signal: AbortSignal;

  // Available on all hooks — mutable
  messages: ChatMessage[];
  tokenCount: number;

  // Available on PreModelCall / PostModelCall
  tools?: NormalizedTool[];         // read-only view of active tools
  response?: ChatMessage;           // PostModelCall only

  // Available on PreToolCall / PostToolCall
  tool?: string;
  args?: unknown;                   // mutable on PreToolCall
  intentId?: string;
  result?: unknown;                 // PostToolCall only
  error?: string;                   // PostToolCall only

  // Available on PreFork / PostFork
  forkId?: string;
  forkPrompt?: string;              // mutable on PreFork
  forkResult?: ForkResult;          // PostFork only

  // Core runtime methods
  fork(prompt: string): Promise<ForkResult>;
};
```

##### Hook decisions

Hooks return a decision to control flow. Returning nothing (or `undefined`)
means `"continue"`.

```ts
type HookDecision =
  | "continue"      // proceed normally (default)
  | "skip"          // skip this operation (PreModelCall: skip the call,
                    //   PreToolCall: skip this tool, PreFork: skip the fork)
  | "abort"         // abort the entire run — triggers disposal
  | { reject: string };  // reject with an error message — for PreToolCall,
                         //   the error is returned to the model as a tool error
                         //   so it can recover. For other hooks, aborts the run.
  | { modify: Partial<HookContext> };  // apply modifications to context
                                       //   (alternative to mutating ctx directly)
```

Decision behavior by hook point:

| Decision | Pre hooks | Post hooks |
|----------|-----------|------------|
| `"continue"` | Proceed to operation | Continue to next iteration/tool |
| `"skip"` | Skip the operation entirely | No effect (operation already ran) |
| `"abort"` | Abort the run | Abort the run |
| `{ reject }` | Return error to model (tool) or abort (other) | Abort the run |
| `{ modify }` | Apply changes before operation | Apply changes before next step |

##### Registration

Hooks are named methods directly on the plugin object, not registered via
`api.addHook()`. Multiple plugins with the same hook run in registration order.
The first non-continue decision wins; later plugins still run (they can observe).

##### Example: context compaction

```ts
const compaction = (opts: { maxTokens: number }): AgentPlugin => ({
  name: "context-compaction",
  hooks: {
    async preIteration(ctx) {
      if (ctx.tokenCount <= opts.maxTokens) return;
      const summary = await ctx.fork(
        "Summarize the conversation so far into a concise context. " +
        "Preserve all decisions, findings, and open questions."
      );
      ctx.messages.length = 0;
      ctx.messages.push({ role: "system", content: summary.output });
    },
  },
});
```

##### Example: guardrails — reject dangerous tool calls

```ts
const guardrails = (): AgentPlugin => ({
  name: "guardrails",
  hooks: {
    preToolUse(ctx) {
      if (ctx.tool === "run_command" && isForbidden(ctx.args)) {
        return { reject: `Blocked forbidden command: ${JSON.stringify(ctx.args)}` };
      }
    },
  },
});
```

The model receives the rejection as a tool error and can try a different approach.

##### Example: token budget — abort when exceeded

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

##### Example: logging — observe everything

```ts
const logging = (): AgentPlugin => ({
  name: "logging",
  hooks: {
    postToolUse(ctx) {
      logger.info(`${ctx.tool} [${ctx.intentId}]`, {
        args: ctx.args,
        result: ctx.result,
        error: ctx.error,
      });
    },
  },
});
```

##### Example: sandbox paths

```ts
const sandboxPaths = (root: string): AgentPlugin => ({
  name: "sandbox-paths",
  hooks: {
    preToolUse(ctx) {
      if (!["read_file", "edit_file", "list_files"].includes(ctx.tool)) return;
      const { path } = ctx.args as { path: string };
      if (!path.startsWith(root)) {
        return { reject: `Path ${path} is outside sandbox ${root}` };
      }
    },
  },
});
```

Capabilities are the internal contract. Tools should get the same lookup model:

```ts
type ToolContext = {
  fork(prompt: string): Promise<ForkResult>;    // clones live run state, parent-child
  spawn(prompt: string): Promise<RunOutput>;    // fresh agent, independent
  signal: AbortSignal;
};
```

### Prompt context

```ts
type PromptContext = {
  baseSystemPrompt?: string;
  userPrompt: string;
  system?: string;
  metadata?: Record<string, unknown>;
};
```

Start simple. Do not prematurely expose low-level message mutation unless the
runtime proves it is necessary.

**Prompt composition is a transform pipeline:**

All `prompt()` functions run in registration order over `PromptContext`. Each
transform receives the output of the previous one. Returning `{ ...ctx, system:
... }` is the idiomatic way to append or replace system content.

There is no separate static fragment collection phase. Static content is just a
`prompt()` that returns a modified context — the function handles both the static
and dynamic cases.

The important rule is that the initial user prompt should stay explicit in the
runtime model. It should not be collapsed into one opaque combined prompt
string too early.

The same should be true for the built-in `SYSTEM_PROMPT.md`. It should be
tracked explicitly as its own input rather than disappearing immediately into a
single merged system string.

### System prompt customization

System prompt customization should be explicit and plugin-based.

Current state:

- `poe-agent` always loads `SYSTEM_PROMPT.md`
- callers do not have a supported customization surface
- changing the prompt is effectively an internal code change

Target state:

- the built-in `SYSTEM_PROMPT.md` becomes an explicit default runtime input
- a built-in plugin can contribute it, but the runtime should still track it as
  `baseSystemPrompt`
- callers can append, replace, or transform the system prompt through normal
  plugins
- prompt customization composes in registration order
- `createAgentSession(...)` preserves current behavior by including the default
  system prompt plugin unless explicitly overridden by future options

Recommended behavior:

```ts
agent()
  .use(systemPrompt())
  .use({
    name: "team-policy",
    prompt(ctx) {
      return { ...ctx, system: [ctx.system, "Always explain risky commands before running them."].filter(Boolean).join("\n") };
    },
  })
```

For full rewrite cases:

```ts
agent()
  .use(systemPrompt())
  .use({
    name: "replace-system-prompt",
    prompt(ctx) {
      return {
        ...ctx,
        system: "You are a narrow-purpose release automation agent.",
      };
    },
  })
```

Important compatibility rule:

The default `createAgentSession(...)` path should continue to inject the current
`SYSTEM_PROMPT.md` content unless the repo deliberately introduces a new
override/config surface. That prevents silent behavioral drift in the provider,
CLI, and snapshot-based tests while the runtime is being refactored.

Recommended internal shape:

```ts
type PromptContext = {
  baseSystemPrompt?: string;
  system?: string;
  userPrompt: string;
  metadata?: Record<string, unknown>;
};
```

Where:

- `baseSystemPrompt` is the explicit content loaded from `SYSTEM_PROMPT.md`
- `system` is the composed result after plugin contributions and transforms
- `userPrompt` is the caller's actual task input

That makes it possible to reason about prompt provenance instead of losing track
of whether an instruction came from the built-in default, a plugin, a skill, or
the caller.

### Initial prompt should be explicit

The runtime should model the initial task prompt explicitly rather than treating
it as an unstructured string that gets merged immediately with system prompt
material.

Recommended semantics:

- the built-in `SYSTEM_PROMPT.md` remains explicit as `baseSystemPrompt`
- system prompt contributions are composed into `system`
- the task input remains in `userPrompt`
- prompt plugins can read and transform both intentionally
- final chat messages are compiled from explicit fields late in the pipeline

Recommended canonical run form:

```ts
await agent()
  .use(memory())
  .run({
    prompt: "Fix the failing tests",
  });
```

Ergonomic sugar can still exist:

```ts
await agent()
  .use(memory())
  .run("Fix the failing tests");
```

But internally that should normalize to:

```ts
{
  userPrompt: "Fix the failing tests"
}
```

This matters for later features:

- skill activation
- prompt transforms
- auditing and observability
- retries and forks
- structured run options

If we collapse everything into one combined prompt string too early, it becomes
hard to reason about what came from:

- the built-in `SYSTEM_PROMPT.md`
- active plugins
- active skills
- the caller's actual task input

The same rule should apply to `createAgentSession(...).sendMessage(...)` during
the migration: preserve the explicit user message as a separate input, then
compile system and user content into the final model request as late as
possible.

### Tool shape

```ts
type ToolCallResult =
  | unknown
  | Promise<unknown>
  | AsyncGenerator<ToolEvent, unknown, void>;

type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility?: "model" | "skill" | "internal";
  call(args: unknown, ctx: ToolContext): ToolCallResult;
};
```

This is the only canonical `Tool` type. There is no `mediation` property
because the ACP core always emits intents. The host decides whether to call
`tool.call()` (agent host) or execute externally (ACP host). The tool itself
does not know or care.

Internal normalization target:

```ts
type NormalizedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  visibility: "model" | "skill" | "internal";
  invoke(args: unknown, ctx: ToolContext): AsyncGenerator<ToolEvent, unknown, void>;
};
```

The agent host uses `NormalizedTool.invoke()` to execute tools. The ACP host
ignores it entirely — the tool's `call()` function only matters when a local
host is wired in.

## Runtime Model

### High-level flow

```text
builder
  -> resolve config
  -> create fresh run context
  -> resolve plugin dependencies
  -> initialize plugins async
  -> register capabilities/tools/prompts
  -> compute active tool view from visibility + skills
  -> execute model loop
  -> dispose run resources
```

### Important rule

The builder is immutable.
The registry is built fresh per run.
The active tool view is computed per run.

That prevents cross-run contamination and avoids permanent visibility mutation.

### Error model

Errors are categorized by where they occur in the runtime lifecycle:

**Composition time (at `.run()`, before any `setup()` executes):**

- Duplicate tool name → throw `DuplicateToolError` with both the existing and
  conflicting plugin names

**Plugin setup time (during async `setup()` execution):**

- Plugin `setup()` throws → abort the run, call `onDispose` for any plugins
  that already completed setup (in reverse registration order), then propagate
  the original error wrapped in `PluginSetupError` identifying the failing
  plugin
- Plugin `setup()` hangs → the run-scoped `AbortSignal` applies; if the caller
  provided a timeout, setup is aborted after the deadline

**Run time (during model loop execution):**

- Tool `call()` throws → the error is captured and returned to the model as a
  tool error result (same as current behavior); the run continues
- Tool `call()` hangs → governed by `ctx.signal`; the model loop can abort the
  tool via the run's `AbortController`
- Prompt transform throws → abort the run with `PromptTransformError`
  identifying the failing plugin; run disposal

**Disposal time:**

- `onDispose` hook throws → log the error, continue disposing remaining hooks
  (do not abort disposal midway), then throw an `AggregateError` if any
  disposal hooks failed

### Cancellation and abort

Each run owns an `AbortController`. The controller's signal propagates to:

- every tool invocation via `ctx.signal`
- MCP client calls (passed as the fetch/transport abort signal)
- child runs spawned via `ctx.fork()` (each child gets a derived controller
  so aborting the parent aborts all children)
- async-generator tools via standard `.return()` on the generator, triggered
  when the signal fires

Callers can abort a run from outside:

```ts
const controller = new AbortController();
const result = agent()
  .use(memory())
  .run("Fix the tests", { signal: controller.signal });

// later
controller.abort();
```

When aborted:

1. the model loop stops after the current iteration
2. in-flight tool calls receive the abort signal
3. async-generator tools are returned (`.return()`)
4. disposal hooks run in reverse registration order
5. the run rejects with an `AbortError`

## Execution Layers

The runtime is organized into three layers. ACP is the core execution model.
All caller-facing modes are adapters on top of it.

```text
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Execution Mode Adapters                        │
│  .run()  .stream()  .acp()                               │
│  Each provides a different host implementation           │
├──────────────────────────────────────────────────────────┤
│  Layer 2: ACP Core                                       │
│  Model loop emits intents, receives acknowledgments      │
│  All tool execution is intent-based                      │
│  Host interface is the single extension point            │
├──────────────────────────────────────────────────────────┤
│  Layer 1: Builder + Plugin Registry                      │
│  Immutable config, plugin resolution, capability wiring  │
└──────────────────────────────────────────────────────────┘
```

### Layer 1: Builder and plugin registry

The immutable configuration layer. It owns:

- plugin registration and dependency resolution
- capability key validation
- model selection
- config snapshots

No I/O happens here. No state is created. The builder produces a frozen config
that higher layers consume.

### Layer 2: ACP core

The ACP core is the execution engine. It always operates in intent mode:

- creates a fresh run context from the builder config
- runs plugin `setup()` in dependency-topological order
- builds the tool registry, prompt registry, and capability registry
- computes the active tool view from visibility and skills
- runs the model loop
- when the model requests a tool call, the core **emits an intent** and
  **suspends** until the host acknowledges with a result
- the core never executes tools directly

This is the fundamental design rule: **the core only proposes, the host
decides.**

```text
Model loop:
  1. Compile prompt from registry
  2. Send to model
  3. Model responds with tool calls
  4. For each tool call:
     a. Emit intent to host
     b. Suspend — wait for host acknowledgment
     c. Inject host result into conversation
  5. Repeat until model produces final response
  6. Emit session complete
```

#### ACP event stream

The core emits a typed `AcpEvent` stream. This is the **canonical event type**
used across the entire system — not to be confused with the ACP wire protocol
`SessionUpdate` types in `@poe-code/poe-acp-client`. The old rendering `AcpEvent`
in `@poe-code/agent-spawn` (`tool_start`, `tool_complete`, etc.) is replaced by
this unified type.

`AcpEvent` is a **public API** — it is the contract between the runtime and all
consumers (execution mode adapters, event hooks, external integrations).

```ts
type AcpEvent =
  | { type: "message.delta"; content: string }
  | { type: "tool.intent"; intentId: string; tool: string; args: unknown }
  | { type: "tool.result"; intentId: string; result: unknown }
  | { type: "tool.error"; intentId: string; error: string }
  | { type: "fork.start"; forkId: string; prompt: string }
  | { type: "fork.complete"; forkId: string; result: ForkResult }
  | { type: "fork.error"; forkId: string; error: string }
  | { type: "progress"; message: string }
  | { type: "session.complete"; result: RunResult }
  | { type: "session.error"; error: Error };
```

#### Event lifecycle for a single tool call

Every tool call produces exactly this event sequence:

```text
tool.intent  →  (host processes)  →  tool.result | tool.error
```

1. `tool.intent` — the core emits this when the model requests a tool call.
   The core suspends and waits for the host.
2. `tool.result` — emitted after the host acknowledges successfully. The
   result is injected into the model conversation.
3. `tool.error` — emitted if the host returns an error or the tool fails.
   The error is injected into the model conversation as a tool error result.

There is always exactly one `tool.result` or `tool.error` for each
`tool.intent`. The `intentId` links them.

#### Event lifecycle for a full run

```text
message.delta*  →  tool.intent  →  tool.result  →  message.delta*  →  ...  →  session.complete
```

- `message.delta` events stream model token output. Zero or more per model
  response.
- `tool.intent` / `tool.result` pairs occur whenever the model calls tools.
  Multiple tool calls can occur in sequence within a single run.
- `progress` events can appear at any point for status updates.
- Exactly one terminal event: `session.complete` or `session.error`.

#### How execution modes consume events

| Event | `.run()` | `.stream()` | `.acp()` |
|-------|----------|-------------|----------|
| `message.delta` | Collected into `output` | Yielded to caller | Yielded to caller |
| `tool.intent` | Local host handles immediately | Local host handles, event yielded | Yielded — caller must acknowledge |
| `tool.result` | Collected into `toolCalls` | Yielded to caller | Yielded to caller |
| `tool.error` | Collected into `toolCalls` | Yielded to caller | Yielded to caller |
| `progress` | Ignored | Yielded to caller | Yielded to caller |
| `session.complete` | Resolves the `Promise<RunResult>` | Yielded, iteration ends | Yielded, iteration ends |
| `session.error` | Rejects the promise | Yielded, iteration ends | Yielded, iteration ends |

#### Host interface

The host is the single extension point for tool execution and fork/spawn.
The core depends on one interface:

```ts
type AcpHost = {
  handle(intent: ToolIntent): Promise<ToolAckResult>;
  fork(request: ForkRequest): Promise<ForkResult>;
  spawn(prompt: string): Promise<RunOutput>;
};

type ToolIntent = {
  intentId: string;
  tool: string;
  args: unknown;
};

type ToolAckResult = {
  status: "success" | "error";
  result: unknown;
};
```

Every execution mode provides its own `AcpHost` implementation. That is the
only thing that varies between `.run()`, `.stream()`, and `.acp()`.

### Layer 3: Execution mode adapters

All three modes are adapters. Each one wires a different `AcpHost` into the
ACP core and exposes the event stream in a different shape.

#### `.run(prompt, options?): Promise<RunResult>`

Provides a **agent host** that executes tool `call()` functions directly inside
the process. Collects the full event stream internally. Returns the final
result when the model loop completes.

```ts
// Internal: the agent host (local execution)
const localHost: AcpHost = {
  async handle(intent) {
    const tool = registry.get(intent.tool);
    const result = await tool.call(intent.args, ctx);
    return { status: "success", result };
  },
  fork: (request) => { /* clone context, run child, return result */ },
  spawn: (prompt) => { /* fresh AcpClient session */ },
};
```

```ts
type RunResult = {
  output: string;
  messages: ChatMessage[];
  toolCalls: ToolCallRecord[];
};
```

This is the simplest integration point. Good for scripts, tests, and
single-shot automation.

#### `.stream(prompt, options?): AsyncIterable<AcpEvent>`

Same **agent host** as `.run()` — tools execute directly inside the process.
The difference is that the ACP event stream is exposed to the caller as an
async iterable instead of being collected internally.

```ts
const events = agent()
  .use(memory())
  .stream("Fix the tests");

for await (const event of events) {
  if (event.type === "message.delta") process.stdout.write(event.content);
  if (event.type === "tool.intent") console.log(`Calling ${event.tool}...`);
}
```

Good for CLI rendering, live UIs, and logging pipelines.

Note: even though the agent host handles intents immediately, the caller still
sees `tool.intent` and `tool.result` events in the stream. The event stream is
always the full ACP event sequence regardless of host.

#### `.acp(): AcpSession`

Exposes the ACP core directly. The caller **is** the host. No built-in tool
execution happens — every intent flows outward and the caller must acknowledge.

```ts
type AcpSession = {
  events: AsyncIterable<AcpEvent>;
  acknowledge(intentId: string, result: ToolAckResult): void;
  dispose(): Promise<void>;
};
```

```ts
const session = await agent().use(memory()).acp("Fix the tests");

for await (const event of session.events) {
  if (event.type === "tool.intent") {
    const result = await hostExecute(event);
    session.acknowledge(event.intentId, result);
  }
}
```

Like `.run()` and `.stream()`, `.acp()` is single-turn — the prompt is passed
at creation time. For continuation, use resume:

```ts
const session2 = await agent()
  .use(memory())
  .acp("Now fix the assertion", { resume: previousResult });
```

This is what the provider uses. The host controls all side effects: file
writes, process execution, permission checks, sandboxing, audit logging.

#### `.acp()` is async

Because plugin `setup()` is async (MCP connections, child processes, etc.),
`.acp()` must be async. Setup runs once when the session is created, not lazily
on first `sendMessage()`.

```ts
const session = await agent().use(mcp(...)).acp();
// plugins are initialized, MCP connections established
// session is ready for messages
```

`.run()` and `.stream()` are also async for the same reason — setup happens
before the model loop starts.

#### Single-turn execution with resume

All three modes are single-turn: one prompt in, one result out. There is no
multi-turn conversation within a single session.

For continuation, the runtime should support **resume** — the ability to start
a new run that inherits conversation history from a previous run's result.

```ts
const result1 = await agent().use(memory()).run("Read the test file");

// Resume with the previous conversation as context
const result2 = await agent()
  .use(memory())
  .run("Now fix the failing assertion", { resume: result1 });
```

Resume works by injecting the previous run's message history into the prompt
pipeline before the model loop starts. The runtime does not hold persistent
state between runs — the caller owns the result and passes it back explicitly.

This keeps runs stateless and composable while still supporting iterative
workflows. It also avoids the complexity of long-lived mutable sessions.

#### How the current provider maps to ACP

`src/providers/poe-agent.ts` currently adapts `createAgentSession(...)` into
the provider interface. That adapter is already doing ACP-like work:

- mapping tool lifecycle events to session updates
- managing session state
- exposing message-based interaction

The refactor should formalize this by making the provider use `.acp()` directly
instead of manually wiring event translation. The provider becomes a thin host
that receives intents and returns acknowledgments.

#### Why ACP as core, not as adapter

If ACP were an adapter on top of a direct-execution core, the runtime would
need two execution paths: one that calls tools directly (core) and one that
emits intents (ACP adapter). That means:

- two code paths to test and maintain
- the intent path is always second-class
- mediation policy becomes a per-tool branching concern
- the provider integration is always an afterthought

With ACP as core:

- one execution path: intents and acknowledgments
- `.run()` and `.stream()` are trivial: they just provide a agent host
- the provider integration uses the same path as everything else
- there is no "direct vs mediated" branching — only different hosts
- testing is simpler: mock the host, verify intents

The `mediation` property on tools is no longer needed. All tools emit intents.
The host decides how to handle them. A agent host calls `tool.call()`. An
external host does whatever it wants.

## Refactor Strategy From Current Code

This refactor should be staged. Rewriting `poe-agent` in one pass would add too
much risk to the provider integration and to the current MCP tests.

### Principle: preserve `createAgentSession(...)` until the end

The current repo already routes both the CLI and provider through
`createAgentSession(...)`. That should remain the stable compatibility API while
the internals change.

Target transition:

```ts
export async function createAgentSession(options: CreateAgentSessionOptions) {
  const runtime = agent()
    .model(resolveModel(options))
    .use(systemPromptPlugin())
    .use(builtinToolsPlugin(options))
    .use(mcpPluginFromOptions(options))
    .toSession();

  return runtime;
}
```

The exact API may differ, but the idea should stay the same: the old session
factory becomes a thin adapter over the new runtime.

### Step 1: split config assembly from runtime execution

Refactor `packages/poe-agent/src/agent-session.ts` first, but do not change its
public contract yet.

Extract:

- option normalization
- resolved config assembly
- run-scoped resource creation
- disposal registry

This creates the first internal line between:

- immutable config
- mutable run state

That is the foundation the fluent builder needs.

### Step 2: introduce internal registries before exposing `agent()`

Before adding any new public fluent API, introduce internal runtime types:

- `ResolvedAgentConfig`
- `RunContext`
- `ToolRegistry`
- `PromptRegistry`
- `HookRegistry`

The current `createAgentSession(...)` should build these registries internally
even if the caller still knows nothing about them.

This keeps the migration safe because tests for the existing API continue to
exercise the new internals.

### Step 3: convert built-in tools from switch routing to plugin definitions

`DefaultToolExecutor` should be the first major class to disappear as a primary
abstraction.

Refactor path:

1. extract each tool definition into its own declarative tool object
2. keep the same names, schemas, and behavior
3. register them through a built-in plugin such as `builtinFileTools()`,
   `builtinShellTools()`, and `builtinWebTools()`
4. keep a temporary adapter that can still answer `executeTool(name, args)` for
   compatibility with the current chat loop

This preserves behavior while removing the hardcoded `switch`.

### Step 4: move system prompt loading into a plugin

Replace direct `loadSystemPrompt()` usage in `createAgentSession(...)` with a
built-in prompt plugin.

This should be the first prompt contribution in the registry and should preserve
current behavior exactly:

- same `SYSTEM_PROMPT.md`
- same injection into the model loop
- same default output for existing tests

Once this is done, prompt transforms and skill prompt sections can layer on top
of a normal prompt pipeline instead of special-casing the static prompt.

### Step 5: turn MCP from a sidecar executor into a first-class primitive

`McpToolExecutor` should not be thrown away. Its useful parts should be split
like this:

- MCP client lifecycle and server registry -> moved into `PluginApi.addMcp()`
- MCP tool schema conversion -> MCP tool adapter helpers
- tool visibility policy -> runtime tool registry

Recommended sequence:

1. keep current namespacing and tool conversion helpers
2. rewrite as a plain `AgentPlugin` that calls `api.addMcp({ name, command, args })`
3. runtime handles connect, discovery, and disposal via `@poe-code/tiny-mcp-client`
4. add visibility metadata instead of always exposing all MCP tools

This is where hidden MCP becomes possible without another architecture rewrite.

### Step 6: normalize the chat loop around a tool runtime

`PoeChatService` should keep owning the model loop, but it should stop knowing
about concrete executors.

Instead of:

- `Tool[]` plus `ToolExecutor`

it should depend on something closer to:

- exposed tool descriptors for the model
- normalized tool invoker for execution
- prompt compiled from the prompt registry

The existing conversation loop, completion requests, and tool-result message
injection are all reusable. The main refactor is at the boundaries:

- input prompt compilation
- tool lookup and invocation
- emitted runtime events

### Step 7: add skill activation after visibility exists

Do not build skills into the runtime before the tool registry supports
visibility.

Once visibility exists:

1. add skill discovery and activation inputs
2. allow skills to reference stable tool ids or tags
3. compute per-run active tool views
4. inject skill usage guidance through prompt plugins

That keeps skill logic declarative and avoids mixing skill discovery into MCP or
tool registration.

### Step 8: add the public fluent builder

Only after the internals are registry-based should `agent()` become public.

At that point the builder is mostly a thin immutable front-end over the config
assembly logic already used by `createAgentSession(...)`.

That sequencing matters because otherwise we would expose a new public API while
the internals are still unstable.

## File-by-File Migration Map

### Keep and adapt

- `packages/poe-agent/src/agent-session.ts`
  Keep as the compatibility layer. Change its job from manual wiring to
  translating old options into the new runtime builder/config.
- `packages/poe-agent/src/chat.ts`
  Keep as the model loop implementation, but change its inputs to use prompt and
  tool registries instead of a raw `ToolExecutor`.
- `packages/poe-agent/src/mcp-tool-executor.ts`
  Keep the pure MCP conversion helpers. Move client ownership behavior into an
  MCP capability/plugin layer.
- `packages/poe-agent/src/system-prompt.ts`
  Keep temporarily, then reduce to an implementation detail used by the default
  system prompt plugin.

### Break apart

- `packages/poe-agent/src/tool-executor.ts`
  Break into built-in plugin/tool modules. This file currently hides the most
  important architectural shift because it centralizes tool definitions and
  routing in one imperative class.

### Add

Suggested new internal modules:

- `packages/poe-agent/src/agent.ts`
  Public immutable builder entry point.
- `packages/poe-agent/src/runtime/acp-core.ts`
  ACP core: model loop, intent emission, host delegation.
- `packages/poe-agent/src/runtime/types.ts`
  `AcpEvent`, `AcpHost`, `ToolIntent`, `ToolAckResult`, `ForkRequest`, `ForkResult` types.
- `packages/poe-agent/src/runtime/agent-host.ts`
  Local `AcpHost` that executes tool `call()` directly.
- `packages/poe-agent/src/runtime/config.ts`
  Resolved config model assembled from builder calls.
- `packages/poe-agent/src/runtime/run-context.ts`
  Mutable run state and disposal registry.
- `packages/poe-agent/src/runtime/tools.ts`
  Tool registry, visibility model, and handler normalization.
- `packages/poe-agent/src/runtime/prompts.ts`
  Prompt fragments, transforms, and compilation.
- `packages/poe-agent/src/plugins/system-prompt.ts`
  Built-in plugin for the existing `SYSTEM_PROMPT.md`.
- `packages/poe-agent/src/plugins/builtin-files.ts`
  `read_file`, `edit_file`, `list_files`.
- `packages/poe-agent/src/plugins/builtin-shell.ts`
  `run_command`.
- `packages/poe-agent/src/plugins/builtin-web.ts`
  `search_web`.
- `packages/poe-agent/src/plugins/mcp.ts`
  Generic MCP capability, server registration, and default exposure policy.
- `packages/poe-agent/src/plugins/skills.ts`
  Skill discovery, activation, and prompt integration.
- `packages/poe-agent/src/plugins/spawn.ts`
  Spawn tool plugin that calls `ctx.spawn()` to start fresh child agents.

These names do not need to be final, but the separation of concerns should be.

## Compatibility Plan

### Provider compatibility

`src/providers/poe-agent.ts` should keep calling `createAgentSession(...)` until
the runtime is proven stable.

That gives three benefits:

- no ACP integration rewrite during the core refactor
- existing provider tests continue to protect behavior
- the new runtime can mature behind one compatibility boundary

Only after the new runtime is stable should the provider decide whether it wants
to use richer streaming/builder APIs directly.

### CLI compatibility

`src/cli/commands/agent.ts` should also continue to rely on
`createAgentSession(...)` for the same reason. There is no user benefit in
switching the CLI command earlier.

### Test compatibility

Current tests are already well positioned for this refactor:

- `packages/poe-agent/src/agent-session.test.ts`
- `packages/poe-agent/src/chat.test.ts`
- `packages/poe-agent/src/tool-executor.test.ts`
- `packages/poe-agent/src/mcp-tool-executor.test.ts`
- `packages/poe-agent/src/mcp-integration.test.ts`
- `src/providers/poe-agent.test.ts`

Migration rule:

1. keep compatibility tests for existing behavior
2. add new builder/runtime tests beside them
3. only delete old executor-specific tests once equivalent plugin/runtime tests
   exist

That avoids a refactor that is only "green" because the original coverage was
removed.

## Recommended Refactor Order

1. Introduce `AcpEvent` types (including fork), `AcpHost` interface, and `ToolContext` with `fork()` as internal contracts. `AcpEvent` is the single canonical event type replacing the old rendering `AcpEvent` from `@poe-code/agent-spawn`.
2. Introduce internal runtime registries (ToolRegistry, PromptRegistry, HookRegistry) and disposal management behind `createAgentSession(...)`.
3. Refactor the model loop to emit `AcpEvent`s and delegate tool execution through `AcpHost`.
4. Implement the agent host (direct tool execution + fork via child runs) so existing behavior is preserved.
5. Move the system prompt into a built-in prompt plugin without changing behavior.
6. Split `DefaultToolExecutor` into built-in tool plugins while preserving current tool names and schemas.
7. Add plugin event hooks (`onEvent`).
8. Promote MCP client ownership into a capability and keep existing MCP conversion helpers.
9. Add tool visibility levels and per-run active tool computation.
10. Add skills on top of visibility and prompt plugins.
11. Add the public immutable `agent()` builder with `.run()`, `.stream()`, and `.acp()`.
12. Keep `createAgentSession(...)` as a stable adapter until provider and CLI migration is optional rather than required.

Steps 1-4 are the critical foundation. They introduce ACP as the core
execution model without changing any public API. After step 4, the existing
tests pass against the new internals via the agent host. This is the first
milestone where the architecture is proven.

## What Not To Do

- Do not replace `createAgentSession(...)` first. That would force provider and
  CLI churn too early.
- Do not add `fork`, skills, and MCP visibility in one step. Those depend on
  the registry model and should arrive after it.
- Do not preserve the `DefaultToolExecutor` switch as the long-term routing
  model. That would recreate provider-specific branching inside a new API.
- Do not couple skills directly to MCP discovery. Skills should gate exposure,
  not own client lifecycle.

## MCP and Skills

### MCP plugin pattern

An MCP server plugin is a plain `AgentPlugin` — same shape as `spawn`. It calls
`api.addMcp()` with plain config; the runtime creates the transport internally:

```ts
import type { AgentPlugin } from "../runtime/plugin-types.js";

const myServer = (options: { command: string; args?: string[] }): AgentPlugin => ({
  name: "my-server-mcp",
  setup(api) {
    api.addMcp({ name: "my-server", command: options.command, args: options.args });
  },
});
export default myServer;
```

`McpServerConfig` uses the same shape as `McpSpawnServer` from `@poe-code/agent-spawn` —
`{ command, args?, env? }`. No transport import required. The runtime creates a
`StdioTransport` internally, discovers tools, namespaces them, and disposes on run end.

For testing, use `createInMemoryTransportPair` from `@poe-code/tiny-mcp-client` via a
custom `addTool()` wrapper or a test-only setup hook.

Any plugin or skill can call `api.addMcp()`. Do not ship pre-built server plugins
for specific services — document the pattern, let callers write their own.

### Hidden MCP through skills

Skills call `api.addMcp()` with `visibility: "skill"` to register tools that are
only exposed when that skill is active:

```ts
setup(api) {
  api.addMcp({
    name: "my-server",
    command: "uvx",
    args: ["mcp-server-my-service"],
    visibility: "skill",
  });
}
```

1. MCP tools are registered with `skill` visibility.
2. A run activates skills via `options.skills`.
3. The runtime exposes matching tools for that run only.

## Third-Party Plugin Model

Third-party plugins should be ordinary npm packages:

- explicit imports
- typed factories
- semver compatibility
- `peerDependencies` on `@poe-code/poe-agent` or the stable plugin API package
- package names prefixed with `poe-agent-plugin-` after the npm scope, for example `@poe-code/poe-agent-plugin-memory`

Example:

```ts
import type { AgentPlugin } from "@poe-code/poe-agent";

function jira(options: JiraOptions): AgentPlugin {
  return {
    name: "@acme/poe-agent-plugin-jira",
    async setup(api) {
      // register tools and capabilities
    },
  };
}
export default jira;
```

This is enough for v1. A custom registry or plugin installer can come later if
it proves necessary.

## Risks and Trade-Offs

### Too much API surface too early

Risk:
Adding too many builder methods will create overlapping extension points.

Mitigation:
Keep `.use(...)` primary and make any extra builder methods thin sugar over the
same plugin contract.

### Capability sprawl

Risk:
Capabilities become an unstructured service locator.

Mitigation:
Keep capability keys typed and documented. Add them only for real shared runtime
services.

### Hidden tool behavior becomes opaque

Risk:
Skills, MCP visibility, and prompt guidance drift apart.

Mitigation:
Use stable tool ids, deterministic activation rules, and explicit visibility
levels.

### Third-party plugins are arbitrary code execution

Risk:
npm-based plugins have the same trust model as any Node plugin ecosystem.

Mitigation:
Be explicit about the trust model now. Leave room for later permission metadata
without blocking the initial design.

## Proposed Implementation Phases

### Phase 1: ACP core, agent host, and fork

- Define `AcpEvent` types (including fork) and `AcpHost` interface. `AcpEvent` is the
  unified canonical event type replacing the old rendering events in `@poe-code/agent-spawn`.
- Refactor the model loop to emit intents and consume acknowledgments
- Implement the agent host for direct tool execution, fork, and spawn
- Implement core fork: context cloning, child run creation, abort cascading
- Existing behavior preserved — `createAgentSession(...)` uses the agent host
- This phase proves the architecture and delivers the first testable milestone

### Phase 2: Builder and plugin registry

- Introduce the immutable builder and resolved `AgentConfig`
- Make `.use(...)` the primary extension point
- Separate builder config from run context
- Add async setup (registration order) and disposal hooks
- No capability system — plugins share state via closures

### Phase 3: Prompt pipeline and event hooks

- Add prompt fragments and prompt transforms (two-phase pipeline)
- Add plugin event hooks (`onEvent`)
- Move system prompt into a built-in plugin

### Phase 4: Tool runtime

- Split built-in tools into plugin definitions
- Add visibility-aware tool registry
- Normalize sync, async, and async-generator handlers

### Phase 5: MCP

- Add generic MCP capability and lifecycle management
- Add server registration plugins
- Add default MCP tool exposure with visibility control

### Phase 6: Skills integration

- Add skill-driven activation of `skill` visibility tools
- Inject prompt guidance for active skills
- Keep registry immutable and compute active tool views per run

### Phase 7: Execution mode adapters and public API

- Add `.run()`, `.stream()`, `.acp()` as public builder methods
- Add resume support
- Freeze the public `AcpEvent` type and `AgentPlugin` contract

### Phase 8: Third-party plugin package

- Document third-party plugin authoring
- Publish first-party examples as npm packages

## Recommendation

The right direction for `poe-agent` is:

- ACP as the core execution model — intents and hosts, not direct execution
- `AcpEvent` as the unified canonical event type across the whole system
- immutable fluent builder for ergonomics
- plugin-first architecture — state in closures, no capability injection
- async run initialization
- single-turn runs with resume for continuation
- plugin event hooks for observability
- fork as a plugin capability
- generic MCP integration
- skill-gated hidden tools
- normalized tool execution

That keeps the UX simple while giving the runtime room to grow without turning
into a hardcoded matrix of providers, tools, and special cases. ACP as core
means the provider integration and the local CLI share the same execution
model — the only difference is who acts as host.
