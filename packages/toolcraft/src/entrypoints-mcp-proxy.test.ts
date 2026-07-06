import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createFsFromVolume, vol } from "memfs";
import { defineGroup } from "./index.js";

const mockFsPromises = createFsFromVolume(vol).promises;

const serverState = {
  created: [] as Array<{
    options: { name: string; version: string };
    tools: string[];
    listen: ReturnType<typeof vi.fn>;
    connectSDK: ReturnType<typeof vi.fn>;
  }>
};

type MockTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type MockClientPlan = {
  pages?: Array<{ tools: MockTool[]; nextCursor?: string }>;
  serverInfo?: { name: string; version: string };
  callToolResult?: unknown;
};

const clientState = {
  plans: [] as MockClientPlan[],
  instances: [] as MockMcpClient[]
};

class MockMcpClient {
  state: "disconnected" | "ready" | "closed" = "disconnected";
  serverInfo: { name: string; version: string } | null = null;
  readonly connect = vi.fn(async (_transport: unknown) => {
    this.plan = clientState.plans.shift() ?? {};
    this.serverInfo = this.plan.serverInfo ?? {
      name: "mock-upstream",
      version: "1.0.0"
    };
    this.state = "ready";

    return {
      capabilities: { tools: {} },
      protocolVersion: "2024-11-05",
      serverInfo: this.serverInfo
    };
  });
  readonly listTools = vi.fn(async (params: { cursor?: string } = {}) => {
    const pages = this.plan.pages ?? [];

    if (params.cursor === undefined) {
      return pages[0] ?? { tools: [] };
    }

    const index = Number(params.cursor);
    return pages[index] ?? { tools: [] };
  });
  readonly callTool = vi.fn(async (params: unknown) => {
    void params;
    return (
      this.plan.callToolResult ?? {
        content: [{ type: "text", text: "ok" }]
      }
    );
  });
  readonly close = vi.fn(async () => {
    this.state = "closed";
  });
  private plan: MockClientPlan = {};

  constructor(_options: unknown) {
    clientState.instances.push(this);
  }
}

vi.mock("toolcraft-design", () => ({
  configureTheme: vi.fn(),
  createLogger: (emitter?: (message: string) => void) => ({
    info: (message: string) => emitter?.(message),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    resolved: vi.fn(),
    errorResolved: vi.fn(),
    message: vi.fn()
  }),
  renderTable: vi.fn(() => "table"),
  getTheme: vi.fn(() => ({
    header: (value: string) => value,
    muted: (value: string) => value
  })),
  text: {
    heading: (value: string) => value,
    section: (value: string) => value,
    sectionHeader: (value: string) => value,
    muted: (value: string) => value,
    usageCommand: (value: string) => value
  },
  formatCommandList: (commands: Array<{ name: string; description: string }>) =>
    commands.map((command) => `  ${command.name}  ${command.description}`).join("\n"),
  formatOptionList: (options: Array<{ flags: string; description: string }>) =>
    options.map((option) => `  ${option.flags}  ${option.description}`).join("\n"),
  helpFormatterPlain: {
    formatCommandList: (commands: Array<{ name: string; description: string }>) =>
      commands.map((command) => `  ${command.name}  ${command.description}`).join("\n"),
    formatOptionList: (options: Array<{ flags: string; description: string }>) =>
      options.map((option) => `  ${option.flags}  ${option.description}`).join("\n")
  },
  promptText: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
  resetOutputFormatCache: vi.fn(),
  note: vi.fn()
}));

vi.mock("node:fs/promises", () => mockFsPromises);
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

vi.mock("tiny-mcp-client", () => ({
  McpClient: MockMcpClient,
  StdioTransport: vi.fn(function MockStdioTransport(
    this: Record<string, unknown>,
    _options: Record<string, unknown>
  ) {
    void this;
  }),
  HttpTransport: vi.fn(function MockHttpTransport(
    this: Record<string, unknown>,
    _options: Record<string, unknown>
  ) {
    void this;
  })
}));

vi.mock("tiny-stdio-mcp-server", () => ({
  JSON_RPC_ERROR_CODES: {
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603
  },
  ToolError: class ToolError extends Error {
    constructor(
      public readonly code: number,
      message: string
    ) {
      super(message);
      this.name = "ToolError";
    }
  },
  createServer: (options: { name: string; version: string }) => {
    const state = {
      options,
      tools: [] as string[],
      listen: vi.fn(async () => undefined),
      connectSDK: vi.fn(async (_transport: unknown) => undefined)
    };
    serverState.created.push(state);

    return {
      tool: (name: string, _description: string, _schema: unknown, _handler: unknown) => {
        state.tools.push(name);
      },
      method: vi.fn(),
      listen: state.listen,
      connectSDK: state.connectSDK
    };
  }
}));

const { runCLI } = await import("./cli.js");
const { createMCPServer, runMCP } = await import("./mcp.js");
const { createSDK } = await import("./sdk.js");

const originalArgv = [...process.argv];

function setProjectRoot(root = "/repo"): void {
  vi.spyOn(process, "cwd").mockReturnValue(`${root}/packages/toolcraft`);
  vol.fromJSON(
    {
      [`${root}/package.json`]: JSON.stringify({ name: "repo" })
    },
    "/"
  );
}

function setClientPlans(...plans: MockClientPlan[]): void {
  clientState.plans = [...plans];
}

function tool(
  name: string,
  schema: Record<string, unknown> = {
    type: "object",
    properties: {
      title: { type: "string" }
    },
    required: ["title"],
    additionalProperties: false
  }
): MockTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: schema
  };
}

function writeCache(name = "github", tools: MockTool[] = [tool("create_issue")]): void {
  vol.fromJSON(
    {
      [`/repo/.toolcraft/mcp/${name}.json`]: JSON.stringify({
        $schema: "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
        version: 1,
        upstream: { name: "mock-upstream", version: "1.0.0" },
        configFingerprint: createHash("sha256")
          .update(JSON.stringify({ transport: "stdio", command: "mock-server" }))
          .digest("hex"),
        fetchedAt: "2026-04-26T12:00:00.000Z",
        tools
      })
    },
    "/"
  );
}

function createProxyRoot(scope?: Array<"cli" | "mcp" | "sdk">) {
  return defineGroup({
    name: "root",
    children: [
      defineGroup({
        name: "github",
        ...(scope === undefined ? {} : { scope }),
        mcp: {
          transport: "stdio",
          command: "mock-server"
        },
        children: []
      })
    ]
  });
}

describe("MCP proxy entrypoints", () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setProjectRoot();
    serverState.created.length = 0;
    clientState.plans = [];
    clientState.instances.length = 0;
    process.argv = [...originalArgv];
    delete process.env.TOOLCRAFT_MCP_REFRESH;
  });

  afterEach(() => {
    process.argv = [...originalArgv];
  });

  it("resolves proxy children before CLI help renders commands", async () => {
    const root = createProxyRoot();
    writeCache();
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = ["node", "toolcraft", "github", "--help"];

    await runCLI(root);

    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "create_issue"
    );
  });

  it("resolves proxy children before MCP tools are registered", async () => {
    const root = createProxyRoot(["mcp"]);
    writeCache();

    await createMCPServer(root, {
      approvals: true,
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });

    expect(serverState.created).toHaveLength(1);
    expect(serverState.created[0]?.tools).toEqual([
      "github__create_issue",
      "approvals__list",
      "approvals__show"
    ]);
  });

  it("infers MCP version from the nearest package metadata for absolute entrypoints", () => {
    vol.fromJSON(
      {
        "/repo/package.json": JSON.stringify({ name: "workspace", version: "0.0.1" }),
        "/repo/packages/mytool/package.json": JSON.stringify({
          name: "mytool",
          version: "3.4.5"
        }),
        "/repo/packages/mytool/dist/bin.js": ""
      },
      "/"
    );
    process.argv = ["node", "/repo/packages/mytool/dist/bin.js"];

    createMCPServer(
      defineGroup({
        name: "root",
        children: []
      }),
      {
        name: "mytool"
      }
    );

    expect(serverState.created[0]?.options).toEqual({
      name: "mytool",
      version: "3.4.5",
      validateToolArguments: false
    });
  });

  it("reports how to provide the MCP version when it cannot be inferred", () => {
    vol.fromJSON(
      {
        "/repo/package.json": JSON.stringify({ name: "workspace" }),
        "/repo/packages/mytool/dist/bin.js": ""
      },
      "/"
    );
    process.argv = ["node", "/repo/packages/mytool/dist/bin.js"];

    expect(() =>
      createMCPServer(
        defineGroup({
          name: "root",
          children: []
        }),
        {
          name: "mytool"
        }
      )
    ).toThrow(
      'MCP server version is required. Pass version: "x.y.z" to createMCPServer / runMCP, or run toolcraft from a project whose package.json defines "version".'
    );
  });

  it("resolves proxy children before the SDK surface is returned", async () => {
    const root = createProxyRoot();
    writeCache();
    setClientPlans({
      callToolResult: {
        content: [{ type: "text", text: "ok" }]
      }
    });

    const sdk = await createSDK(root);
    const result = await sdk.github.createIssue({
      title: "Bug"
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "ok" }]
    });
    expect(clientState.instances).toHaveLength(1);
    expect(clientState.instances[0]?.callTool).toHaveBeenCalledWith({
      name: "create_issue",
      arguments: { title: "Bug" }
    });
  });

  it("keeps MCP discovery progress on stderr during runMCP startup", async () => {
    const root = createProxyRoot();
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }]
    });

    await runMCP(root, {
      name: "toolcraft-test",
      version: "1.0.0"
    });

    expect(stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe("");
    expect(stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "MCP github: connecting"
    );
  });
});
