# Plan: Integrate tiny-mcp-client into poe-agent

## Context

The `poe-agent` package currently has 5 built-in tools (read_file, edit_file, list_files, run_command, search_web) hardwired through `DefaultToolExecutor`. There is no way to extend the agent with external tools from MCP servers.

The `tiny-mcp-client` package is a fully implemented MCP client with stdio/HTTP transports and comprehensive test utilities (in-memory test pairs, mock servers). It's not yet used by any other package.

This plan integrates them so that `poe-agent` can discover and call MCP tools alongside built-in tools, with MCP tool names namespaced as `mcp__<server>__<tool>` to avoid collisions.

---

## Step 1: Add dependencies to poe-agent

**File:** `packages/poe-agent/package.json`

- Add `"tiny-mcp-client": "*"` to `dependencies`
- Add `"tiny-stdio-mcp-test-server": "*"` to `devDependencies`

---

## Step 2: Pure conversion functions (TDD)

**New file:** `packages/poe-agent/src/mcp-tool-executor.ts`
**New file:** `packages/poe-agent/src/mcp-tool-executor.test.ts`

### Types

```typescript
export interface McpStdioServerDefinition {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerDefinition {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerDefinition = McpStdioServerDefinition | McpHttpServerDefinition;
```

### Conversion functions to implement (test-first)

**`namespaceMcpToolName(serverName, toolName) → string`**
- Returns `mcp__${serverName}__${toolName}`

**`mcpToolToOpenAiTool(serverName, mcpTool) → Tool`**
- Converts MCP `{ name, description, inputSchema }` to OpenAI `{ type: "function", function: { name: "mcp__server__tool", description, parameters } }`
- `inputSchema.properties` → `parameters.properties`
- `inputSchema.required` → `parameters.required`
- Missing description defaults to `""`
- Missing properties defaults to `{}`

**`callToolResultToString(result) → string`**
- TextContent → `item.text`
- ImageContent → `[image: mime]`
- AudioContent → `[audio: mime]`
- EmbeddedResource with text → `resource.text`
- EmbeddedResource with blob → `[blob: uri]`
- Multiple items joined with `\n`
- When `isError` is true → throws Error using extracted text

### Tests (pure, no I/O)
- Each conversion edge case above is a test case
- ~12 unit tests total

---

## Step 3: McpToolExecutor class (TDD)

**Same files as Step 2**

### Class design

```typescript
export class McpToolExecutor implements ToolExecutor {
  // Stores mapping from namespaced tool name → McpClient
  private readonly toolToClient: Map<string, { client: McpClient; originalName: string }>;
  private tools: Tool[];
  private readonly clients: McpClient[];

  async addServer(serverName: string, client: McpClient): Promise<void>
  // Calls client.listTools() (handling pagination via nextCursor loop)
  // For each MCP tool: namespaces the name, converts to OpenAI format, stores mapping

  getAvailableTools(): Tool[]
  // Returns all discovered tools in OpenAI format

  async executeTool(name: string, args: Record<string, unknown>): Promise<string>
  // Looks up client by namespaced name
  // Calls client.callTool({ name: originalName, arguments: args })
  // Converts result via callToolResultToString

  async dispose(): Promise<void>
  // Closes all clients via Promise.allSettled
}
```

Key: `addServer` takes an already-connected `McpClient`. This makes it trivially testable - tests use `createTestPair` from tiny-mcp-client with `createTestServer` from tiny-stdio-mcp-test-server to get in-memory connected clients.

### Tests

Use `createTestPair(createTestServer(), () => new McpClient(...))` for integration tests:

- `addServer` discovers tools and namespaces them as `mcp__test-server__caesar_cipher_encrypt`
- `getAvailableTools` returns OpenAI-format tools with namespaced names
- `executeTool("mcp__test-server__caesar_cipher_encrypt", { text: "hello" })` returns `"khoor"`
- `executeTool("mcp__test-server__word_of_the_day", {})` returns `"Bumfuzzle - to confuse or fluster someone"`
- `executeTool("unknown_tool", {})` throws `"MCP tool not found: unknown_tool"`
- `dispose` closes all clients (verify client.state === "closed")
- Multiple servers: tools from both appear in getAvailableTools

---

## Step 4: Wire into agent-session (TDD)

**Modify:** `packages/poe-agent/src/agent-session.ts`
**Modify:** `packages/poe-agent/src/agent-session.test.ts`

### Changes to `CreateAgentSessionOptions`

```typescript
export interface CreateAgentSessionOptions {
  // ... existing fields ...
  mcpServers?: Record<string, McpServerDefinition>;
}
```

### Changes to `createAgentSession`

1. After creating `DefaultToolExecutor`, check if `options.mcpServers` has entries
2. If yes:
   - Create `McpToolExecutor`
   - For each server config, create transport (`StdioTransport` or `HttpTransport`), create `McpClient`, connect, then call `mcpExecutor.addServer(serverName, client)`
   - Merge tool lists: `[...builtinTools, ...mcpTools]`
   - Create routing `ToolExecutor`:
     ```typescript
     const builtinToolNames = new Set(builtinTools.map(t => t.function.name));
     const toolExecutor: ToolExecutor = {
       async executeTool(name, args) {
         return builtinToolNames.has(name)
           ? builtinExecutor.executeTool(name, args)
           : mcpExecutor.executeTool(name, args);
       },
     };
     ```
3. Pass merged tools and routing executor to `PoeChatService`
4. In `dispose()`, call `mcpExecutor.dispose()` alongside existing cleanup
5. If any MCP server fails to connect, clean up already-connected ones before throwing

### Transport creation (private helper in agent-session.ts)

```typescript
function createMcpTransport(config: McpServerDefinition): McpTransport {
  if (config.transport === "stdio") {
    return new StdioTransport({ command: config.command, args: config.args, env: config.env ? { ...process.env, ...config.env } : undefined });
  }
  return new HttpTransport({ url: config.url, headers: config.headers });
}
```

### Tests

Mock `McpToolExecutor` via `vi.mock()` (same pattern as existing `DefaultToolExecutor` mock):
- When `mcpServers` is undefined, behavior unchanged (existing tests pass as-is)
- When `mcpServers` is provided, McpToolExecutor is created and initialized
- MCP tools appear alongside built-in tools
- dispose() calls McpToolExecutor.dispose()

---

## Step 5: Update exports

**Modify:** `packages/poe-agent/src/index.ts`

```typescript
export type { McpServerDefinition, McpStdioServerDefinition, McpHttpServerDefinition } from "./mcp-tool-executor.js";
```

---

## Step 6: Integration tests — file operations + MCP tools with scripted fetch (TDD)

**New file:** `packages/poe-agent/src/mcp-integration.test.ts`

### Approach

Test the full agent session loop in-process using:
- **Mock `fetch`** with scripted OpenAI-compatible responses (same pattern as `chat.test.ts`)
- **`memfs`** for built-in file tool operations (read_file, edit_file, list_files)
- **`createTestPair`** + **`createTestServer`** for real MCP tool execution (in-memory, no I/O)
- Assertions on the fetch request bodies to verify tool lists and conversation flow

This validates the in-process integration: agent session → merged tool lists → LLM tool_call routing → built-in tool on memfs → MCP tool via test server → result fed back to LLM.

### Helper: scripted fetch mock

```typescript
/** Returns a vi.fn() that serves canned ChatCompletionResponse objects in sequence */
function createScriptedFetch(
  responses: Array<{ message: ChatMessage }>
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("No more scripted responses");
    return new Response(JSON.stringify({
      choices: [{ index: 0, message: next.message, finish_reason: next.message.tool_calls ? "tool_calls" : "stop" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}
```

### Test: LLM calls a built-in file tool on memfs

Exercises: `createAgentSession` → LLM responds with `read_file` tool_call → DefaultToolExecutor reads from memfs → result sent back → LLM gives final answer.

```typescript
it("reads a file via built-in read_file tool", async () => {
  const vol = Volume.fromJSON({ "/workspace/hello.txt": "Hello from memfs!" });
  const fs = createFsFromVolume(vol).promises as unknown as ToolExecutorFileSystem;

  const fetchMock = createScriptedFetch([
    // Round 1: LLM calls read_file
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-1", type: "function",
          function: { name: "read_file", arguments: '{"path":"hello.txt"}' },
        }],
      },
    },
    // Round 2: LLM sees file content, gives final answer
    { message: { role: "assistant", content: "The file says: Hello from memfs!" } },
  ]);

  const session = await createAgentSession({
    apiKey: "test-key",
    model: "test-model",
    cwd: "/workspace",
    allowedPaths: ["/workspace"],
    fetch: fetchMock,
    fs,
  });

  const result = await session.sendMessage("Read hello.txt");
  expect(result.content).toBe("The file says: Hello from memfs!");

  // Verify the second fetch call included the tool result in messages
  const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
  expect(secondBody.messages).toContainEqual(
    expect.objectContaining({ role: "tool", name: "read_file", content: "Hello from memfs!" }),
  );

  await session.dispose();
});
```

### Test: LLM calls edit_file then read_file on memfs

Exercises: multi-tool sequence — LLM creates a file, then reads it back.

```typescript
it("creates and reads a file via built-in tools", async () => {
  const vol = new Volume();
  vol.mkdirSync("/workspace", { recursive: true });
  const fs = createFsFromVolume(vol).promises as unknown as ToolExecutorFileSystem;

  const fetchMock = createScriptedFetch([
    // Round 1: LLM calls edit_file to create
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-1", type: "function",
          function: {
            name: "edit_file",
            arguments: JSON.stringify({ command: "create", path: "new.txt", file_text: "created by agent" }),
          },
        }],
      },
    },
    // Round 2: LLM calls read_file to verify
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-2", type: "function",
          function: { name: "read_file", arguments: '{"path":"new.txt"}' },
        }],
      },
    },
    // Round 3: final answer
    { message: { role: "assistant", content: "File created and verified." } },
  ]);

  const session = await createAgentSession({
    apiKey: "test-key",
    model: "test-model",
    cwd: "/workspace",
    allowedPaths: ["/workspace"],
    fetch: fetchMock,
    fs,
  });

  const result = await session.sendMessage("Create new.txt then read it back");
  expect(result.content).toBe("File created and verified.");

  // Verify the file was actually created in memfs
  const content = vol.readFileSync("/workspace/new.txt", "utf8");
  expect(content).toBe("created by agent");

  await session.dispose();
});
```

### Test: LLM calls list_files on memfs

```typescript
it("lists directory contents via built-in list_files tool", async () => {
  const vol = Volume.fromJSON({
    "/workspace/a.txt": "a",
    "/workspace/b.txt": "b",
    "/workspace/sub/c.txt": "c",
  });
  const fs = createFsFromVolume(vol).promises as unknown as ToolExecutorFileSystem;

  const fetchMock = createScriptedFetch([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-1", type: "function",
          function: { name: "list_files", arguments: '{"path":"."}' },
        }],
      },
    },
    { message: { role: "assistant", content: "Found a.txt, b.txt, and sub/" } },
  ]);

  const session = await createAgentSession({
    apiKey: "test-key",
    model: "test-model",
    cwd: "/workspace",
    allowedPaths: ["/workspace"],
    fetch: fetchMock,
    fs,
  });

  const result = await session.sendMessage("List files in the current directory");
  expect(result.content).toContain("a.txt");

  // Verify the tool result sent to LLM contained the file listing
  const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
  const toolMessage = secondBody.messages.find((m: ChatMessage) => m.role === "tool" && m.name === "list_files");
  expect(toolMessage.content).toContain("a.txt");
  expect(toolMessage.content).toContain("b.txt");
  expect(toolMessage.content).toContain("sub");

  await session.dispose();
});
```

### Test: LLM calls an MCP tool alongside built-in tools

Exercises: merged tool list — LLM first calls a built-in tool, then an MCP tool.

```typescript
it("uses both built-in and MCP tools in a single session", async () => {
  const vol = Volume.fromJSON({ "/workspace/data.txt": "secret=42" });
  const fs = createFsFromVolume(vol).promises as unknown as ToolExecutorFileSystem;

  // Set up in-memory MCP test server
  const { clientTransport, serverTransport } = createTestPair(createTestServer(), () => new McpClient(...));

  const fetchMock = createScriptedFetch([
    // Round 1: LLM reads a file
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-1", type: "function",
          function: { name: "read_file", arguments: '{"path":"data.txt"}' },
        }],
      },
    },
    // Round 2: LLM calls MCP tool
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-2", type: "function",
          function: { name: "mcp__test-server__caesar_cipher_encrypt", arguments: '{"text":"secret=42","shift":3}' },
        }],
      },
    },
    // Round 3: final answer
    { message: { role: "assistant", content: "The encrypted data is vhfuhw=42" } },
  ]);

  const session = await createAgentSession({
    apiKey: "test-key",
    model: "test-model",
    cwd: "/workspace",
    allowedPaths: ["/workspace"],
    fetch: fetchMock,
    fs,
    mcpServers: { "test-server": { transport: "stdio", command: "unused" } },
    // McpToolExecutor is injected with the test client (see Step 4 wiring)
  });

  const result = await session.sendMessage("Read data.txt and encrypt it");
  expect(result.content).toContain("vhfuhw=42");

  // Verify the first fetch call included both built-in and MCP tools
  const firstBody = JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}");
  const toolNames = firstBody.tools.map((t: Tool) => t.function.name);
  expect(toolNames).toContain("read_file");
  expect(toolNames).toContain("mcp__test-server__caesar_cipher_encrypt");

  await session.dispose();
});
```

### Test: tool routing — unknown tool name errors cleanly

```typescript
it("returns error for unrecognized tool name", async () => {
  const fetchMock = createScriptedFetch([
    {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call-1", type: "function",
          function: { name: "nonexistent_tool", arguments: "{}" },
        }],
      },
    },
    { message: { role: "assistant", content: "That tool doesn't exist." } },
  ]);

  const session = await createAgentSession({
    apiKey: "test-key",
    model: "test-model",
    fetch: fetchMock,
  });

  const result = await session.sendMessage("Call a fake tool");

  // Verify the error was fed back as a tool message
  const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}");
  const toolMessage = secondBody.messages.find((m: ChatMessage) => m.role === "tool");
  expect(toolMessage.content).toContain("Error");

  await session.dispose();
});
```

### Summary of test cases (~8 tests)

| Test | Built-in tool | MCP tool | memfs | Verifies |
|------|:---:|:---:|:---:|----------|
| read_file on memfs | read_file | - | yes | File content returned to LLM |
| edit_file create + read_file | edit_file, read_file | - | yes | File mutation + read-back |
| list_files on memfs | list_files | - | yes | Directory listing |
| edit_file str_replace on memfs | edit_file | - | yes | In-place edit |
| MCP tool only | - | caesar_cipher_encrypt | no | MCP execution + namespacing |
| Built-in + MCP tools together | read_file | caesar_cipher_encrypt | yes | Merged tool list + routing |
| MCP tools in tool list sent to LLM | - | word_of_the_day | no | Tool definitions in API request |
| Unknown tool error | - | - | no | Error propagation |

---

## Step 7: HTTP proxy with capture for e2e tests (TDD)

**Package:** `packages/e2e-docker-test-runner/` (extend existing e2e testing package)

### Problem

E2e tests need to:
1. **Control LLM responses** - deterministic replay without real API keys
2. **Assert on request content** - verify the agent sends the right tools, model, messages
3. **Work for all agents** - every agent routes through the Poe API via configurable `POE_BASE_URL`

### Architecture

```
Agent → http://localhost:3456/v1/chat/completions → proxy → [snapshot or upstream API]
                                                      |
                                                      └→ /tmp/proxy-capture.jsonl (all traffic logged)
```

The proxy lives in `e2e-docker-test-runner`. It provides:
- Declarative route definitions (from path → to target URL)
- Three modes: **playback** (snapshots), **record** (forward + save), **passthrough** (forward only)
- JSONL capture of all request/response pairs
- Vitest matchers to assert on captured traffic
- Request exploration API for debugging

### 7a. Types (`packages/e2e-docker-test-runner/src/proxy-types.ts`)

```typescript
/** A single proxy route: match requests by path, handle via mode */
export interface ProxyRoute {
  /** URL path prefix to match (e.g. "/v1/chat/completions") */
  path: string;
  /** Target URL to forward to in passthrough/record mode */
  target: string;
  /** How to handle matched requests */
  mode: "playback" | "passthrough" | "record";
  /** Directory containing snapshot files (playback/record modes) */
  snapshotDir?: string;
}

/** Full proxy configuration */
export interface ProxyConfig {
  port: number;
  routes: ProxyRoute[];
  /** JSONL file path where every request/response pair is logged */
  captureFile: string;
}

/** One line in the JSONL capture file */
export interface CapturedExchange {
  timestamp: string;
  route: string;          // matched route path
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;        // parsed JSON body
  };
  response: {
    status: number;
    body: unknown;        // parsed JSON body
  };
}
```

### 7b. Proxy server (`packages/e2e-docker-test-runner/src/proxy-server.ts`)

A `node:http` server (~120 lines):

1. On each incoming request, find the first `ProxyRoute` matching by `path` prefix
2. Read and parse the JSON request body
3. Based on `route.mode`:
   - **playback**: compute snapshot key from body (`SHA256({ model, messages })`), load `<snapshotDir>/<key>.json`, return as response
   - **record**: forward to `route.target` with original headers, save response as snapshot, return response
   - **passthrough**: forward to `route.target`, return response (no snapshot save)
4. In ALL modes: append `CapturedExchange` to `captureFile` as one JSONL line
5. If no route matches: return `502 { error: "No matching proxy route for <path>" }`
6. If playback snapshot missing: return `404 { error: "Snapshot not found for key <key>" }`

Snapshot key generation: reuse the `SHA256(JSON.stringify({ model, messages }))` algorithm from `tests/helpers/snapshot-client.ts:generateSnapshotKey`.

Snapshot file format per route (OpenAI chat completion compatible):

```json
{
  "key": "claude-sonnet-4-5-abc123def456",
  "request": { "model": "Claude-Sonnet-4.5", "messages": [...], "tools": [...] },
  "response": { "choices": [{ "message": { "role": "assistant", "content": "..." } }] },
  "metadata": { "recordedAt": "2026-02-25T00:00:00Z", "model": "Claude-Sonnet-4.5" }
}
```

### 7c. Proxy CLI entry point (`packages/e2e-docker-test-runner/src/proxy-cli.ts`)

For running inside Docker containers:

```bash
# Start proxy in background inside container:
proxy-server --config /tmp/proxy-config.json &

# Or inline:
proxy-server --port 3456 --capture /tmp/capture.jsonl \
  --route '/v1/chat/completions=playback:/tmp/snapshots'
```

Accepts either a JSON config file (`ProxyConfig`) or CLI flags.

### 7d. Integrate proxy into `useContainer` lifecycle

**Modify:** `packages/e2e-docker-test-runner/src/use-container.ts`
**Modify:** `packages/e2e-docker-test-runner/src/persistent-container.ts`
**Modify:** `packages/e2e-docker-test-runner/src/types.ts`

The proxy is **not** a separate thing tests opt into. It's part of the container lifecycle — always on when snapshots are provided, `POE_BASE_URL` set automatically.

#### Extend `UseContainerOptions`

```typescript
export interface UseContainerOptions {
  workspaceDir: string;
  testName?: string;
  /** Path to directory containing proxy snapshot files (relative to repo root).
   *  When provided, proxy starts automatically and POE_BASE_URL points at it. */
  snapshotDir?: string;
}
```

#### Extend `Container` interface

```typescript
export interface Container {
  // ... existing methods ...

  /** Read captured proxy exchanges. Only available when snapshotDir was provided. */
  requests(): Promise<CapturedRequests>;

  /** Write snapshot files into the container's snapshot directory. */
  writeSnapshots(snapshots: Array<{ key: string; response: unknown }>): Promise<void>;
}
```

#### Global proxy defaults (convention over configuration)

| Setting | Value | Source |
|---------|-------|--------|
| Port | `3456` | Hardcoded constant |
| Capture file | `/tmp/proxy-capture.jsonl` | Hardcoded constant |
| Snapshot dir (in container) | `/tmp/proxy-snapshots` | Hardcoded constant |
| Mode | `playback` or `record` | `POE_PROXY_MODE` env var, default `playback` |
| Route | `/v1/chat/completions → https://api.poe.com/v1/chat/completions` | Hardcoded default |
| `POE_BASE_URL` | `http://localhost:3456` | Set on container automatically |

#### Modified `useContainer` lifecycle

```typescript
export function useContainer(options: UseContainerOptions): Container {
  let current: Container | null = null;

  beforeEach(async () => {
    setWorkspaceDir(options.workspaceDir);
    current = await createContainer({
      testName: options.testName,
      // When snapshotDir is set, createContainer:
      //   1. Adds -e POE_BASE_URL=http://localhost:3456 to container env
      //   2. Copies host snapshot files into /tmp/proxy-snapshots/
      //   3. Starts proxy-server in background BEFORE login()
      snapshotDir: options.snapshotDir,
    });
    await current.login();
  });

  afterEach(async () => {
    await current?.destroy();
    current = null;
  });

  // ... same Proxy wrapper ...
}
```

#### Modified `createContainer`

```typescript
// In buildCreateArgs, when snapshotDir is set:
if (config.snapshotDir) {
  args.push('-e', 'POE_BASE_URL=http://localhost:3456');
}

// After container start, before returning:
if (options.snapshotDir) {
  // Copy snapshot files from host into container
  for (const file of readdirSync(resolve(workspace, options.snapshotDir))) {
    await container.writeFile(`/tmp/proxy-snapshots/${file}`, readFileSync(...));
  }

  // Start proxy in background
  const mode = process.env.POE_PROXY_MODE ?? 'playback';
  await container.exec(`proxy-server --port 3456 --capture /tmp/proxy-capture.jsonl \
    --route '/v1/chat/completions=${mode}:/tmp/proxy-snapshots' &`);
  // Wait for proxy to bind
  await container.exec('for i in $(seq 1 20); do curl -sf http://localhost:3456/health && break || sleep 0.1; done');
}
```

#### `container.requests()` implementation

```typescript
async requests(): Promise<CapturedRequests> {
  if (!snapshotDir) {
    throw new Error('requests() requires snapshotDir in useContainer options');
  }
  const raw = await this.readFile('/tmp/proxy-capture.jsonl');
  const exchanges = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return new CapturedRequests(exchanges);
}
```

#### `container.writeSnapshots()` implementation

```typescript
async writeSnapshots(snapshots: Array<{ key: string; response: unknown }>): Promise<void> {
  for (const snap of snapshots) {
    await this.writeFile(
      `/tmp/proxy-snapshots/${snap.key}.json`,
      JSON.stringify({ key: snap.key, response: snap.response, metadata: { recordedAt: new Date().toISOString() } })
    );
  }
}
```

#### What `POE_BASE_URL=http://localhost:3456` gives you for free

Since `POE_BASE_URL` is set on the container env, `poe-code configure <agent> --yes` writes the proxy URL into each agent's config automatically:

- Claude Code → `~/.claude/settings.json` → `ANTHROPIC_BASE_URL: http://localhost:3456`
- Codex → `~/.codex/config.toml` → `base_url = "http://localhost:3456"`
- Any future agent → same pattern

No test code needed. The existing `container.exec('poe-code configure claude-code --yes')` just works.

### 7e. Request exploration API (`packages/e2e-docker-test-runner/src/proxy-requests.ts`)

A `CapturedRequests` wrapper class that makes it easy to explore, filter, and debug captured exchanges in tests. This is the primary interface tests use — not raw `CapturedExchange[]`.

```typescript
export class CapturedRequests {
  constructor(private readonly exchanges: CapturedExchange[]) {}

  /** Number of captured exchanges */
  get length(): number { return this.exchanges.length; }

  /** Access by index: requests[0], requests[1], etc. */
  at(index: number): CapturedExchange {
    const exchange = this.exchanges[index];
    if (!exchange) {
      throw new Error(
        `No captured request at index ${index}. ` +
        `Only ${this.exchanges.length} request(s) captured:\n` +
        this.summary()
      );
    }
    return exchange;
  }

  /** All exchanges as array (for spreading, iteration) */
  all(): CapturedExchange[] { return [...this.exchanges]; }

  /** Filter by route path prefix */
  forRoute(path: string): CapturedRequests {
    return new CapturedRequests(this.exchanges.filter(e => e.route === path || e.request.path.startsWith(path)));
  }

  /** Filter to only exchanges where the LLM response included tool_calls */
  withToolCalls(): CapturedRequests {
    return new CapturedRequests(this.exchanges.filter(e => {
      const body = e.response.body as Record<string, unknown>;
      const choices = body?.choices as Array<{ message?: { tool_calls?: unknown[] } }>;
      return choices?.[0]?.message?.tool_calls?.length ?? 0 > 0;
    }));
  }

  /** Filter to only exchanges where request body contains a tool message */
  withToolResults(): CapturedRequests {
    return new CapturedRequests(this.exchanges.filter(e => {
      const body = e.request.body as { messages?: Array<{ role: string }> };
      return body?.messages?.some(m => m.role === "tool") ?? false;
    }));
  }

  /** Extract all tool names from the `tools` array in a request body */
  toolNamesAt(index: number): string[] {
    const body = this.at(index).request.body as { tools?: Array<{ function: { name: string } }> };
    return (body.tools ?? []).map(t => t.function.name);
  }

  /** Extract tool_calls from a response body */
  toolCallsAt(index: number): Array<{ name: string; arguments: Record<string, unknown> }> {
    const body = this.at(index).response.body as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
    };
    return (body.choices?.[0]?.message?.tool_calls ?? []).map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));
  }

  /** Extract messages array from a request body */
  messagesAt(index: number): Array<{ role: string; content?: string; name?: string; tool_call_id?: string }> {
    const body = this.at(index).request.body as { messages?: Array<Record<string, unknown>> };
    return (body.messages ?? []) as Array<{ role: string; content?: string; name?: string; tool_call_id?: string }>;
  }

  /** Find first tool result message for a given tool name in a request's messages */
  toolResultAt(index: number, toolName: string): { content: string; tool_call_id: string } | undefined {
    const msgs = this.messagesAt(index);
    const msg = msgs.find(m => m.role === "tool" && m.name === toolName);
    if (!msg) return undefined;
    return { content: msg.content ?? "", tool_call_id: msg.tool_call_id ?? "" };
  }

  /** Human-readable summary of all captured exchanges — used in assertion failure messages */
  summary(): string {
    if (this.exchanges.length === 0) return "  (no captured requests)";
    return this.exchanges.map((e, i) => {
      const body = e.request.body as { model?: string; messages?: unknown[]; tools?: unknown[] };
      const respBody = e.response.body as { choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }> };
      const msg = respBody.choices?.[0]?.message;
      const lines = [
        `  [${i}] ${e.request.method} ${e.request.path} (${e.response.status})`,
        `      model: ${body.model ?? "(none)"}`,
        `      messages: ${body.messages?.length ?? 0} messages`,
        `      tools: ${body.tools?.length ?? 0} tool definitions`,
      ];
      if (msg?.tool_calls?.length) {
        const names = (msg.tool_calls as Array<{ function: { name: string } }>).map(tc => tc.function.name);
        lines.push(`      response tool_calls: [${names.join(", ")}]`);
      }
      if (msg?.content) {
        const truncated = msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content;
        lines.push(`      response content: "${truncated}"`);
      }
      return lines.join("\n");
    }).join("\n");
  }

  /** Pretty-print a single exchange for debugging (full JSON) */
  debugAt(index: number): string {
    return JSON.stringify(this.at(index), null, 2);
  }
}

/** Parse captured exchanges from container and wrap in CapturedRequests */
export async function getCapturedRequests(
  container: Container,
  captureFile: string
): Promise<CapturedRequests> {
  const exchanges = await getCapturedExchanges(container, captureFile);
  return new CapturedRequests(exchanges);
}
```

Usage in tests:

```typescript
const requests = await getCapturedRequests(container, captureFile);

// Explore by index
requests.at(0)                              // first exchange (throws with summary if missing)
requests.at(1)                              // second exchange
requests.length                             // total count

// Filter chains
requests.forRoute("/v1/chat/completions")   // only chat completion requests
requests.withToolCalls()                    // only responses that had tool_calls
requests.withToolResults()                  // only requests that included tool result messages

// Extract structured data
requests.toolNamesAt(0)                     // ["read_file", "edit_file", "mcp__test-server__caesar_cipher_encrypt"]
requests.toolCallsAt(0)                     // [{ name: "read_file", arguments: { path: "hello.txt" } }]
requests.messagesAt(1)                      // full messages array from 2nd request
requests.toolResultAt(1, "read_file")       // { content: "file content...", tool_call_id: "call-1" }

// Debugging
requests.summary()                          // human-readable table of all exchanges
requests.debugAt(0)                         // full JSON dump of exchange 0
```

### 7f. Vitest matchers (`packages/e2e-docker-test-runner/src/proxy-matchers.ts`)

Custom matchers following the same pattern as the existing `matchers.ts` (using `formatExecContext`-style context dumping). Every matcher includes the full request/response context in its failure message so you can debug without adding extra logging.

```typescript
/**
 * Formats a CapturedExchange into a readable debug string for assertion failure messages.
 * Shows: route, method, path, status, request body (model, messages count, tool names),
 * response body (content preview, tool_calls).
 */
function formatExchangeContext(exchange: CapturedExchange): string {
  const reqBody = exchange.request.body as Record<string, unknown>;
  const respBody = exchange.response.body as Record<string, unknown>;
  const choices = respBody?.choices as Array<{ message?: Record<string, unknown> }> | undefined;
  const msg = choices?.[0]?.message;

  const lines = [
    `  Route: ${exchange.route}`,
    `  ${exchange.request.method} ${exchange.request.path} → ${exchange.response.status}`,
    `  Timestamp: ${exchange.timestamp}`,
    `  Request body:`,
    `    model: ${reqBody?.model ?? "(none)"}`,
  ];

  const messages = reqBody?.messages as Array<{ role: string; name?: string; content?: string }> | undefined;
  if (messages) {
    lines.push(`    messages (${messages.length}):`);
    for (const m of messages) {
      const preview = m.content ? (m.content.length > 60 ? m.content.slice(0, 60) + "..." : m.content) : "(empty)";
      const nameTag = m.name ? ` [${m.name}]` : "";
      lines.push(`      - ${m.role}${nameTag}: ${preview}`);
    }
  }

  const tools = reqBody?.tools as Array<{ function: { name: string } }> | undefined;
  if (tools) {
    lines.push(`    tools (${tools.length}): [${tools.map(t => t.function.name).join(", ")}]`);
  }

  lines.push(`  Response body:`);
  if (msg?.tool_calls) {
    const tcs = msg.tool_calls as Array<{ function: { name: string; arguments: string } }>;
    lines.push(`    tool_calls: [${tcs.map(tc => `${tc.function.name}(${tc.function.arguments})`).join(", ")}]`);
  }
  if (msg?.content) {
    const content = msg.content as string;
    const preview = content.length > 100 ? content.slice(0, 100) + "..." : content;
    lines.push(`    content: "${preview}"`);
  }

  return lines.join("\n");
}

/**
 * Formats a list of CapturedExchanges as a numbered summary.
 */
function formatExchangeList(exchanges: CapturedExchange[]): string {
  if (exchanges.length === 0) return "  (no captured exchanges)";
  return exchanges.map((e, i) => {
    const body = e.request.body as { model?: string; tools?: unknown[] };
    return `  [${i}] ${e.request.method} ${e.request.path} → ${e.response.status} (model: ${body.model ?? "?"}, tools: ${body.tools?.length ?? 0})`;
  }).join("\n");
}

expect.extend({
  /**
   * Assert a CapturedExchange has a request body matching (partial deep match).
   *
   * Failure message shows:
   *   - What was expected vs what was received
   *   - Full request context: method, path, all messages, all tool names
   *   - Full response context: status, tool_calls, content preview
   */
  toHaveRequestBody(received: CapturedExchange, expected: Record<string, unknown>) {
    const pass = this.equals(received.request.body, expect.objectContaining(expected));
    return {
      pass,
      message: () => {
        const diff = this.utils.diff(expected, received.request.body, { expand: false });
        return pass
          ? `expected request body not to match\n${formatExchangeContext(received)}`
          : `expected request body to match\n\nDiff:\n${diff}\n\nFull exchange:\n${formatExchangeContext(received)}`;
      },
    };
  },

  /**
   * Assert a CapturedExchange has a response body matching (partial deep match).
   *
   * Failure message shows the full exchange context including the actual response body.
   */
  toHaveResponseBody(received: CapturedExchange, expected: Record<string, unknown>) {
    const pass = this.equals(received.response.body, expect.objectContaining(expected));
    return {
      pass,
      message: () => {
        const diff = this.utils.diff(expected, received.response.body, { expand: false });
        return pass
          ? `expected response body not to match\n${formatExchangeContext(received)}`
          : `expected response body to match\n\nDiff:\n${diff}\n\nFull exchange:\n${formatExchangeContext(received)}`;
      },
    };
  },

  /**
   * Assert CapturedExchange[] contains at least one request matching all specified criteria.
   *
   * Failure message shows:
   *   - What criteria were searched for
   *   - A numbered summary of ALL captured exchanges so you can spot what's off
   */
  toContainRequest(received: CapturedExchange[], matcher: {
    path?: string;
    method?: string;
    bodyContaining?: Record<string, unknown>;
  }) {
    const match = received.find(e => {
      if (matcher.path && !e.request.path.startsWith(matcher.path)) return false;
      if (matcher.method && e.request.method !== matcher.method) return false;
      if (matcher.bodyContaining && !this.equals(e.request.body, expect.objectContaining(matcher.bodyContaining))) return false;
      return true;
    });
    const pass = match !== undefined;
    return {
      pass,
      message: () => {
        const criteria = [
          matcher.path ? `path: "${matcher.path}"` : null,
          matcher.method ? `method: "${matcher.method}"` : null,
          matcher.bodyContaining ? `body containing: ${JSON.stringify(matcher.bodyContaining)}` : null,
        ].filter(Boolean).join(", ");
        return pass
          ? `expected no exchange matching {${criteria}}\n\nAll captured exchanges:\n${formatExchangeList(received)}`
          : `expected at least one exchange matching {${criteria}}, but none found\n\nAll captured exchanges (${received.length}):\n${formatExchangeList(received)}`;
      },
    };
  },

  /**
   * Assert that a request's tool list contains a tool with the given name.
   *
   * Failure message shows:
   *   - The expected tool name
   *   - All tool names actually present in the request
   *   - Full exchange context
   */
  toHaveToolInRequest(received: CapturedExchange, toolName: string) {
    const body = received.request.body as { tools?: Array<{ function: { name: string } }> };
    const toolNames = (body.tools ?? []).map(t => t.function.name);
    const pass = toolNames.includes(toolName);
    return {
      pass,
      message: () =>
        pass
          ? `expected request not to contain tool "${toolName}"\n  Tools: [${toolNames.join(", ")}]\n${formatExchangeContext(received)}`
          : `expected request to contain tool "${toolName}"\n  Tools present: [${toolNames.join(", ")}]\n${formatExchangeContext(received)}`,
    };
  },

  /**
   * Assert that a response contains a tool_call for the given tool name.
   *
   * Failure message shows:
   *   - The expected tool name
   *   - All tool_call names actually in the response
   *   - Full exchange context
   */
  toHaveToolCall(received: CapturedExchange, toolName: string) {
    const body = received.response.body as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function: { name: string } }> } }>;
    };
    const toolCalls = body.choices?.[0]?.message?.tool_calls ?? [];
    const callNames = toolCalls.map(tc => tc.function.name);
    const pass = callNames.includes(toolName);
    return {
      pass,
      message: () =>
        pass
          ? `expected response not to have tool_call "${toolName}"\n  tool_calls: [${callNames.join(", ")}]\n${formatExchangeContext(received)}`
          : `expected response to have tool_call "${toolName}"\n  tool_calls present: [${callNames.join(", ")}]\n${formatExchangeContext(received)}`,
    };
  },

  /**
   * Assert that a request's messages contain a tool result for the given tool name
   * with content matching the expected string/pattern.
   *
   * Failure message shows:
   *   - The expected tool name and content
   *   - All tool messages actually present
   *   - Full exchange context
   */
  toHaveToolResult(received: CapturedExchange, toolName: string, contentMatcher?: string | RegExp) {
    const body = received.request.body as {
      messages?: Array<{ role: string; name?: string; content?: string }>;
    };
    const toolMessages = (body.messages ?? []).filter(m => m.role === "tool");
    const targetMessage = toolMessages.find(m => m.name === toolName);

    let pass = targetMessage !== undefined;
    if (pass && contentMatcher) {
      if (typeof contentMatcher === "string") {
        pass = (targetMessage?.content ?? "").includes(contentMatcher);
      } else {
        pass = contentMatcher.test(targetMessage?.content ?? "");
      }
    }

    return {
      pass,
      message: () => {
        const toolMsgSummary = toolMessages.length === 0
          ? "  (no tool messages in request)"
          : toolMessages.map(m => `  - ${m.name}: "${(m.content ?? "").slice(0, 80)}${(m.content ?? "").length > 80 ? "..." : ""}"`).join("\n");

        if (pass) {
          return `expected request not to have tool result for "${toolName}"${contentMatcher ? ` matching ${contentMatcher}` : ""}\n${formatExchangeContext(received)}`;
        }

        if (!targetMessage) {
          return `expected request to have tool result for "${toolName}", but no tool message with that name found\n\nTool messages in request:\n${toolMsgSummary}\n\nFull exchange:\n${formatExchangeContext(received)}`;
        }

        return `expected tool result for "${toolName}" to match ${contentMatcher}\n  Actual content: "${targetMessage.content}"\n\nFull exchange:\n${formatExchangeContext(received)}`;
      },
    };
  },
});

// Type declarations
declare module 'vitest' {
  interface Assertion<T> {
    toHaveRequestBody(expected: Record<string, unknown>): void;
    toHaveResponseBody(expected: Record<string, unknown>): void;
    toContainRequest(matcher: { path?: string; method?: string; bodyContaining?: Record<string, unknown> }): void;
    toHaveToolInRequest(toolName: string): void;
    toHaveToolCall(toolName: string): void;
    toHaveToolResult(toolName: string, contentMatcher?: string | RegExp): void;
  }
}
```

#### Example failure messages

**`toHaveRequestBody` failure:**
```
expected request body to match

Diff:
- Expected
+ Received

  Object {
-   "model": "Claude-Sonnet-4.5",
+   "model": "Claude-Haiku-4.5",
  }

Full exchange:
  Route: /v1/chat/completions
  POST /v1/chat/completions → 200
  Timestamp: 2026-02-25T10:00:00.000Z
  Request body:
    model: Claude-Haiku-4.5
    messages (3):
      - system: You are a helpful coding assistant...
      - user: What is the word of the day?
      - assistant: (empty)
    tools (7): [read_file, edit_file, list_files, run_command, search_web, mcp__test-server__caesar_cipher_encrypt, mcp__test-server__word_of_the_day]
  Response body:
    tool_calls: [mcp__test-server__word_of_the_day({})]
```

**`toHaveToolInRequest` failure:**
```
expected request to contain tool "mcp__test-server__word_of_the_day"
  Tools present: [read_file, edit_file, list_files, run_command, search_web]
  Route: /v1/chat/completions
  POST /v1/chat/completions → 200
  ...
```

**`toContainRequest` failure:**
```
expected at least one exchange matching {path: "/v1/chat/completions", body containing: {"model":"Claude-Sonnet-4.5"}}, but none found

All captured exchanges (2):
  [0] POST /v1/chat/completions → 200 (model: Claude-Haiku-4.5, tools: 7)
  [1] POST /v1/chat/completions → 200 (model: Claude-Haiku-4.5, tools: 7)
```

**`toHaveToolResult` failure:**
```
expected request to have tool result for "mcp__test-server__word_of_the_day", but no tool message with that name found

Tool messages in request:
  - read_file: "Hello from the file!"

Full exchange:
  Route: /v1/chat/completions
  POST /v1/chat/completions → 200
  ...
```

**`CapturedRequests.at()` out-of-bounds:**
```
No captured request at index 2. Only 1 request(s) captured:
  [0] POST /v1/chat/completions → 200 (model: Claude-Sonnet-4.5, tools: 7)
```

### 7g. Testing the proxy itself with a dummy upstream API

**New file:** `packages/e2e-docker-test-runner/src/proxy-server.test.ts`

The proxy unit tests use a **dummy upstream API** — a tiny `node:http` server started in `beforeAll` that serves canned OpenAI-compatible responses. This tests the proxy end-to-end without Docker and without real APIs.

#### Dummy upstream API

```typescript
// In test file - a minimal HTTP server that mimics the Poe API
async function startDummyApi(port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const parsed = JSON.parse(body);
      // Return a canned response based on the request
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: `Echo: ${parsed.messages?.[parsed.messages.length - 1]?.content ?? 'empty'}`,
          }
        }]
      }));
    });
  });
  await new Promise<void>(resolve => server.listen(port, resolve));
  return { url: `http://localhost:${port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
```

#### Test cases for the proxy

**Passthrough mode tests:**
- Forwards request to dummy API and returns its response
- Captures exchange in JSONL file with correct request body, response body, path, timestamp
- Preserves original request headers (Authorization, Content-Type) when forwarding
- Returns 502 when no route matches the request path

**Record mode tests:**
- Forwards to dummy API AND saves response as snapshot file
- Snapshot file name matches the generated key
- Snapshot file contains both request and response
- Subsequent request with same body returns same snapshot (idempotent recording)

**Playback mode tests:**
- Returns snapshot response without contacting dummy API (dummy API not even started)
- Returns 404 with descriptive error when snapshot is missing
- Still captures the exchange in JSONL even in playback mode
- Key generation is deterministic: same `{ model, messages }` always produces same key

**Capture file tests:**
- Multiple requests produce multiple JSONL lines
- Each line is valid JSON parseable as `CapturedExchange`
- Timestamp is ISO 8601
- Request body is the parsed JSON, not raw string
- Response body is the parsed JSON from upstream/snapshot

**Route matching tests:**
- First matching route wins (routes checked in order)
- Route with `/v1/chat` matches `/v1/chat/completions` (prefix match)
- Route with `/v1/chat/completions` does NOT match `/v1/models`

#### Full integration test (proxy + dummy API together)

```typescript
describe('proxy-server', () => {
  let dummyApi: { url: string; close: () => Promise<void> };
  let proxy: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    dummyApi = await startDummyApi(9901);
  });
  afterAll(async () => { await dummyApi.close(); });

  it('passthrough: forwards to upstream, captures exchange', async () => {
    const captureFile = '/tmp/test-capture.jsonl';
    proxy = await startProxyServer({
      port: 9902,
      captureFile,
      routes: [{ path: '/v1/chat/completions', target: dummyApi.url + '/v1/chat/completions', mode: 'passthrough' }],
    });

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-key' },
      body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'hello' }] }),
    });

    const body = await response.json();
    expect(body.choices[0].message.content).toBe('Echo: hello');

    // Read capture file and assert
    const requests = parseCaptureFile(captureFile);
    expect(requests.length).toBe(1);
    expect(requests.at(0)).toHaveRequestBody({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(requests.at(0)).toHaveResponseBody({
      choices: expect.arrayContaining([
        expect.objectContaining({ message: { role: 'assistant', content: 'Echo: hello' } }),
      ]),
    });

    await proxy.close();
  });

  it('playback: serves from snapshot without hitting upstream', async () => {
    // Write snapshot, start proxy in playback mode (no dummyApi needed)
    // Send request, verify response matches snapshot
    // Verify capture file still has the exchange
  });

  it('record: forwards to upstream and saves snapshot', async () => {
    // Send request through proxy in record mode
    // Verify response matches upstream
    // Verify snapshot file was created with correct key
    // Send same request again, verify same snapshot is returned
  });
});
```

Note: these tests use `memfs` for snapshot/capture file I/O where possible, and real `node:http` servers for the HTTP layer (no Docker needed).

---

## Step 8: Docker e2e test for poe-agent + MCP

**New file:** `e2e/poe-agent-mcp.test.ts`
**New dir:** `e2e/fixtures/poe-agent-mcp/` (snapshot files)

### How it works

The test passes `snapshotDir` to `useContainer`. That's it — proxy starts automatically, `POE_BASE_URL` is set, `container.requests()` is available. No manual proxy setup, no imports from proxy modules, no port/captureFile configuration.

### Test (concrete)

```typescript
import { describe, it, expect } from 'vitest';
import { useContainer } from '@poe-code/e2e-docker-test-runner';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

describe('poe-agent MCP integration', () => {
  const container = useContainer({
    workspaceDir: repoRoot,
    testName: 'poe-agent-mcp',
    snapshotDir: 'e2e/fixtures/poe-agent-mcp',  // ← this is the only change vs existing e2e tests
  });

  it('discovers MCP tools, sends them to LLM, calls the tool, returns result', async () => {
    // 1. Configure and run
    const spawnResult = await container.exec(
      `poe-code spawn --mcp-config '${JSON.stringify({
        'test-server': { command: 'tiny-stdio-mcp-test-server', args: ['serve', 'word-of-the-day'] },
      })}' poe-agent 'What is the word of the day?'`
    );

    expect(spawnResult).toHaveExitCode(0);
    expect(spawnResult.stdout.toLowerCase()).toContain('bumfuzzle');

    // 2. Assert on captured LLM requests
    const requests = await container.requests();
    expect(requests.length).toBe(2);

    // First request: MCP tools appear in tool list alongside built-ins
    expect(requests.at(0)).toHaveToolInRequest('mcp__test-server__word_of_the_day');
    expect(requests.at(0)).toHaveToolInRequest('mcp__test-server__caesar_cipher_encrypt');
    expect(requests.at(0)).toHaveToolInRequest('read_file');

    // Second request: tool result fed back to LLM
    expect(requests.at(1)).toHaveToolResult('mcp__test-server__word_of_the_day', 'Bumfuzzle');
  });
});
```

Compare with the existing `claude-code.test.ts` — same `useContainer` pattern, just adds `snapshotDir`.

### How existing tests adopt the proxy (zero changes needed for basic use)

Existing tests that don't pass `snapshotDir` are completely unaffected — no proxy, no `POE_BASE_URL` override, same behavior as today.

When an existing test wants deterministic playback:

```diff
 // e2e/claude-code.test.ts
 const container = useContainer({
   workspaceDir: repoRoot,
   testName: 'claude-code',
+  snapshotDir: 'e2e/fixtures/claude-code',
 });

 it('configure and test', async () => {
   const result = await container.exec('poe-code configure claude-code --yes');
   expect(result).toHaveExitCode(0);
   // ... existing assertions still work ...
+
+  // NEW: can now assert on what the agent sent to the LLM
+  const requests = await container.requests();
+  expect(requests.at(0)).toHaveRequestBody({ model: 'Claude-Sonnet-4.5' });
 });
```

### Docker image changes

- `e2e.Dockerfile` already includes `tiny-stdio-mcp-test-server`
- Add: `poe-agent` as importable package in container
- Add: `proxy-server` binary (built from e2e-docker-test-runner, added to image PATH)

### Snapshot recording workflow

```bash
# First time: record snapshots from real Poe API
POE_PROXY_MODE=record POE_API_KEY=real-key npm run e2e -- e2e/poe-agent-mcp.test.ts

# Snapshots saved to e2e/fixtures/poe-agent-mcp/*.json (committed to repo)
# Subsequent runs use playback (no API key needed, default mode)
npm run e2e -- e2e/poe-agent-mcp.test.ts
```

---

## Step 9: Additional MCP test cases (TDD)

Expand `packages/poe-agent/src/mcp-tool-executor.test.ts` and `mcp-integration.test.ts` with the following additional cases.

### McpToolExecutor unit/integration tests (Step 3 additions)

#### Tool discovery edge cases

- **Server with zero tools:** `addServer` on a server that returns `{ tools: [] }` — `getAvailableTools` returns empty array for that server, no error
- **Paginated tool list:** Server returns `{ tools: [tool1], nextCursor: "page2" }` then `{ tools: [tool2] }` — both tools discovered
- **Duplicate tool names across servers:** Two servers both expose `encrypt` → namespaced as `mcp__server-a__encrypt` and `mcp__server-b__encrypt`, no collision
- **Tool name with special characters:** MCP tool named `my-tool_v2.0` → namespaced as `mcp__server__my-tool_v2.0` — verify round-trip through callTool

#### Tool execution edge cases

- **MCP tool returns multiple content items:** `callTool` returns `{ content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }] }` → `callToolResultToString` joins with `\n` → `"line1\nline2"`
- **MCP tool returns image content:** `{ content: [{ type: "image", mimeType: "image/png", data: "..." }] }` → `"[image: image/png]"`
- **MCP tool returns error:** `{ content: [{ type: "text", text: "something broke" }], isError: true }` → throws Error with `"something broke"`
- **MCP tool returns embedded resource with text:** `{ content: [{ type: "resource", resource: { uri: "file:///x", text: "content" } }] }` → `"content"`
- **MCP tool returns embedded resource with blob:** `{ content: [{ type: "resource", resource: { uri: "file:///x", blob: "base64..." } }] }` → `"[blob: file:///x]"`
- **MCP tool returns mixed content:** text + image → `"some text\n[image: image/jpeg]"`
- **MCP tool with empty result:** `{ content: [] }` → `""`
- **Calling disposed executor:** After `dispose()`, `executeTool` throws (or the underlying client is closed)

#### Concurrent servers

- **Two servers, interleaved calls:** `addServer("a", ...)`, `addServer("b", ...)`, then `executeTool("mcp__a__tool1", ...)` and `executeTool("mcp__b__tool2", ...)` both succeed — verifies the `toolToClient` mapping routes to the correct client
- **Dispose with multiple servers:** `dispose()` closes all clients even if one throws during close (via `Promise.allSettled`)

### Integration test additions (Step 6 additions)

#### Multi-turn conversation with file mutations

- **Agent reads, edits, re-reads:** LLM calls `read_file("config.txt")` → gets `"port=3000"` → calls `edit_file(str_replace, "3000", "8080")` → calls `read_file("config.txt")` → gets `"port=8080"` → gives final answer. Verify all three tool results in the fetch request bodies.

#### MCP tool error propagation

- **MCP tool returns isError:** LLM calls `mcp__test-server__caesar_cipher_encrypt` with invalid args → MCP returns error → error is fed back to LLM as `Error: ...` tool message → LLM recovers with a text response. Verify the tool message contains the error.

#### Parallel tool calls in single response

- **LLM returns multiple tool_calls:** Response has `tool_calls: [{ name: "read_file", ... }, { name: "mcp__test-server__word_of_the_day", ... }]` → both executed → both results sent back in the next request. Verify both tool result messages appear.

#### MCP tool schema validation in API request

- **Verify full tool schema sent to LLM:** Assert that the tool definition for `mcp__test-server__caesar_cipher_encrypt` in the fetch request body includes the correct `parameters.properties` (text: string, shift: integer) and `parameters.required` (["text"]).

#### Session lifecycle

- **dispose() closes MCP clients:** After `session.dispose()`, verify that the MCP client is in closed state.
- **Session rejects after dispose:** After `session.dispose()`, calling `session.sendMessage(...)` throws "Agent session is already disposed."

### Summary of all MCP-related test cases

| Category | Test case count |
|----------|:--------------:|
| **Step 2: Conversion functions** | ~12 |
| **Step 3: McpToolExecutor** | ~7 (original) + ~12 (new) = ~19 |
| **Step 4: Agent session wiring** | ~4 |
| **Step 6: File ops + MCP integration** | ~8 (original) + ~5 (new) = ~13 |
| **Step 7: Proxy server** | ~15 |
| **Step 8: Docker e2e** | ~1 |
| **Total** | ~64 |

---

## Verification

1. **Unit tests:** `npx turbo run test --filter=@poe-code/poe-agent` - all new and existing tests pass
2. **Lint:** `npm run lint` passes
3. **Integration test:** The McpToolExecutor integration test with `createTestPair` + `createTestServer` validates full MCP lifecycle (connect → listTools → callTool → close)
4. **File operation tests:** The `mcp-integration.test.ts` tests validate built-in tools on memfs + MCP tools in a single agent session
5. **E2E:** `npm run e2e:verbose` - existing e2e tests still pass + new poe-agent-mcp test passes
6. **Manual spot test:** `npm run dev -- <agent-command>` with MCP server config

---

## Commit sequence

1. `chore(poe-agent): add tiny-mcp-client dependency`
2. `feat(poe-agent): add MCP tool format conversion and namespacing`
3. `feat(poe-agent): add McpToolExecutor for MCP tool discovery and execution`
4. `feat(poe-agent): wire MCP servers into agent session lifecycle`
5. `feat(poe-agent): export MCP server definition types`
6. `test(poe-agent): add file operation and MCP integration tests`
7. `feat(e2e-docker-test-runner): add proxy server with types and CLI`
8. `feat(e2e-docker-test-runner): add request exploration API and matchers`
9. `feat(e2e-docker-test-runner): integrate proxy into useContainer lifecycle`
10. `test(e2e-docker-test-runner): add proxy server tests with dummy upstream API`
11. `test(poe-agent): add Docker e2e test for MCP integration`
12. `test(poe-agent): add additional MCP edge case tests`

---

## Critical files

| File | Action |
|------|--------|
| **poe-agent: MCP integration** | |
| `packages/poe-agent/package.json` | Modify - add deps |
| `packages/poe-agent/src/mcp-tool-executor.ts` | Create - executor + conversions + types |
| `packages/poe-agent/src/mcp-tool-executor.test.ts` | Create - unit + integration tests |
| `packages/poe-agent/src/mcp-integration.test.ts` | Create - file operation + MCP integration tests |
| `packages/poe-agent/src/agent-session.ts` | Modify - wire MCP lifecycle |
| `packages/poe-agent/src/agent-session.test.ts` | Modify - add MCP tests |
| `packages/poe-agent/src/index.ts` | Modify - export types |
| **e2e-docker-test-runner: proxy infrastructure** | |
| `packages/e2e-docker-test-runner/src/proxy-types.ts` | Create - ProxyRoute, ProxyConfig, CapturedExchange |
| `packages/e2e-docker-test-runner/src/proxy-server.ts` | Create - HTTP proxy with capture |
| `packages/e2e-docker-test-runner/src/proxy-server.test.ts` | Create - tests with dummy upstream API |
| `packages/e2e-docker-test-runner/src/proxy-cli.ts` | Create - CLI entry point for Docker |
| `packages/e2e-docker-test-runner/src/use-container.ts` | Modify - add snapshotDir option, proxy lifecycle |
| `packages/e2e-docker-test-runner/src/persistent-container.ts` | Modify - POE_BASE_URL env, proxy start, requests()/writeSnapshots() |
| `packages/e2e-docker-test-runner/src/types.ts` | Modify - add requests()/writeSnapshots() to Container |
| `packages/e2e-docker-test-runner/src/proxy-requests.ts` | Create - CapturedRequests exploration class |
| `packages/e2e-docker-test-runner/src/proxy-matchers.ts` | Create - toHaveRequestBody, toHaveToolInRequest, toHaveToolResult, etc. |
| `packages/e2e-docker-test-runner/src/proxy-matchers.test.ts` | Create - matcher unit tests |
| `packages/e2e-docker-test-runner/src/index.ts` | Modify - export proxy utilities |
| **E2E test** | |
| `e2e/poe-agent-mcp.test.ts` | Create - Docker e2e test with proxy |
| **Read-only references** | |
| `packages/poe-agent/src/chat.ts` | Tool/ToolExecutor types |
| `packages/tiny-mcp-client/src/index.ts` | McpClient API |
| `packages/tiny-stdio-mcp-test-server/src/index.ts` | createTestServer |
| `tests/helpers/snapshot-client.ts` | generateSnapshotKey algorithm to reuse |
