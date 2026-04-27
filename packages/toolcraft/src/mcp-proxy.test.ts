import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, vol } from "memfs";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";

const mockFsPromises = createFsFromVolume(vol).promises;
const loggerState = {
  info: [] as string[],
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

const transportState = {
  stdio: [] as Array<Record<string, unknown>>,
  http: [] as Array<Record<string, unknown>>,
};

const clientState = {
  plans: [] as MockClientPlan[],
  instances: [] as MockMcpClient[],
};

class MockMcpClient {
  state: "disconnected" | "ready" | "closed" = "disconnected";
  serverInfo: { name: string; version: string } | null = null;
  readonly connect = vi.fn(async (transport: unknown) => {
    void transport;
    this.plan = clientState.plans.shift() ?? {};
    this.serverInfo = this.plan.serverInfo ?? {
      name: "mock-upstream",
      version: "1.0.0",
    };
    this.state = "ready";

    return {
      capabilities: { tools: {} },
      protocolVersion: "2024-11-05",
      serverInfo: this.serverInfo,
    };
  });
  readonly listTools = vi.fn(
    async (params: { cursor?: string } = {}) => {
      const pages = this.plan.pages ?? [];

      if (params.cursor === undefined) {
        return pages[0] ?? { tools: [] };
      }

      const index = Number(params.cursor);
      return pages[index] ?? { tools: [] };
    }
  );
  readonly callTool = vi.fn(async (params: unknown) => {
    void params;
    return this.plan.callToolResult ?? {
      content: [{ type: "text", text: "ok" }],
    };
  });
  readonly close = vi.fn(async () => {
    this.state = "closed";
  });
  private plan: MockClientPlan = {};

  constructor(options: unknown) {
    void options;
    clientState.instances.push(this);
  }
}

vi.mock("@poe-code/design-system", () => ({
  createLogger: (emitter?: (message: string) => void) => ({
    info: (message: string) => {
      emitter?.(message);
      loggerState.info.push(message);
    },
  }),
}));

vi.mock("node:fs/promises", () => mockFsPromises);
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

vi.mock("tiny-mcp-client", () => ({
  McpClient: MockMcpClient,
  StdioTransport: vi.fn(
    class MockStdioTransport {
      readonly options: Record<string, unknown>;

      constructor(options: Record<string, unknown>) {
        this.options = options;
        transportState.stdio.push(options);
      }
    }
  ),
  HttpTransport: vi.fn(
    class MockHttpTransport {
      readonly options: Record<string, unknown>;

      constructor(options: Record<string, unknown>) {
        this.options = options;
        transportState.http.push(options);
      }
    }
  ),
}));

const { parseRefreshEnv, resolveCachePath, resolveMcpProxies } = await import("./mcp-proxy.js");

function tool(
  name: string,
  schema: Record<string, unknown> = {
    type: "object",
    properties: {
      title: { type: "string" },
    },
    required: ["title"],
    additionalProperties: false,
  }
): MockTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: schema,
  };
}

function setProjectRoot(root = "/repo"): void {
  vi.spyOn(process, "cwd").mockReturnValue(`${root}/packages/toolcraft`);
  vol.fromJSON(
    {
      [`${root}/package.json`]: JSON.stringify({ name: "repo" }),
    },
    "/"
  );
}

function setClientPlans(...plans: MockClientPlan[]): void {
  clientState.plans = [...plans];
}

function createProxyGroup(options: {
  name?: string;
  tools?: string[];
  rename?: Record<string, string>;
  children?: Array<ReturnType<typeof defineCommand> | ReturnType<typeof defineGroup>>;
}) {
  return defineGroup({
    name: options.name ?? "github",
    mcp: {
      transport: "stdio",
      command: "mock-server",
    },
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.rename === undefined ? {} : { rename: options.rename }),
    children: options.children ?? [],
  });
}

function getCachePath(name = "github"): string {
  return `/repo/.toolcraft/mcp/${name}.json`;
}

function createContext(params: Record<string, unknown>) {
  return {
    params,
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      exists: vi.fn(),
    },
    env: {
      get: vi.fn(),
    },
    progress: vi.fn(),
  } as const;
}

describe("parseRefreshEnv", () => {
  it("returns undefined for unset or empty values", () => {
    expect(parseRefreshEnv(undefined)).toBeUndefined();
    expect(parseRefreshEnv("")).toBeUndefined();
    expect(parseRefreshEnv("   ")).toBeUndefined();
  });

  it("returns all for 1 and true", () => {
    expect(parseRefreshEnv("1")).toBe("all");
    expect(parseRefreshEnv("true")).toBe("all");
  });

  it("returns a single-name set", () => {
    expect(parseRefreshEnv("github")).toEqual(new Set(["github"]));
  });

  it("returns a multi-name set", () => {
    expect(parseRefreshEnv("github,linear")).toEqual(new Set(["github", "linear"]));
  });

  it("trims whitespace around names", () => {
    expect(parseRefreshEnv(" github , linear ")).toEqual(new Set(["github", "linear"]));
  });
});

describe("resolveCachePath", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("finds package.json by walking upward from process.cwd()", () => {
    setProjectRoot();
    vi.spyOn(process, "cwd").mockReturnValue("/repo/packages/toolcraft/src");

    expect(resolveCachePath("github")).toBe("/repo/.toolcraft/mcp/github.json");
  });

  it("throws when no package.json is found", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/missing/project");

    expect(() => resolveCachePath("github")).toThrow(
      'Could not find package.json above "/missing/project" while resolving MCP cache path.'
    );
  });

  it("uses an explicit project root without reading process.cwd()", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/caller/project");

    expect(resolveCachePath("github", "/cli-package")).toBe(
      "/cli-package/.toolcraft/mcp/github.json"
    );
  });
});

describe("resolveMcpProxies", () => {
  const originalRefresh = process.env.TOOLCRAFT_MCP_REFRESH;

  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setProjectRoot();
    loggerState.info.length = 0;
    transportState.stdio.length = 0;
    transportState.http.length = 0;
    clientState.plans = [];
    clientState.instances.length = 0;
    delete process.env.TOOLCRAFT_MCP_REFRESH;
  });

  afterEach(() => {
    process.env.TOOLCRAFT_MCP_REFRESH = originalRefresh;
  });

  it("loads proxy tools from cache and populates group children", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];
    const cachePath = getCachePath();

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    vol.fromJSON(
      {
        [cachePath]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("create_issue")],
        }),
      },
      "/"
    );

    await resolveMcpProxies(root);

    expect(proxyGroup.children).toHaveLength(1);
    expect(proxyGroup.children[0]).toMatchObject({
      kind: "command",
      name: "create_issue",
    });
    expect(clientState.instances).toHaveLength(0);
    expect(loggerState.info).toEqual([]);
  });

  it("loads proxy tools from an explicit project root independent of caller cwd", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    vi.spyOn(process, "cwd").mockReturnValue("/caller/project");
    vol.fromJSON(
      {
        ["/cli-package/.toolcraft/mcp/github.json"]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("create_issue")],
        }),
      },
      "/"
    );

    await resolveMcpProxies(root, { projectRoot: "/cli-package" });

    expect(proxyGroup.children.map((child) => child.name)).toEqual(["create_issue"]);
    expect(clientState.instances).toHaveLength(0);
  });

  it("filters non-allowlisted tools from the in-memory group while keeping the cache verbatim", async () => {
    const group = createProxyGroup({
      tools: ["get_issue"],
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    setClientPlans({
      pages: [{ tools: [tool("get_issue"), tool("create_issue")] }],
    });

    await resolveMcpProxies(root);

    expect(proxyGroup.children.map((child) => child.name)).toEqual(["get_issue"]);

    const cache = JSON.parse(await mockFsPromises.readFile(getCachePath(), "utf8"));
    expect(cache.tools.map((entry: { name: string }) => entry.name)).toEqual([
      "get_issue",
      "create_issue",
    ]);
  });

  it("keeps default tool placement as a leaf command even when the upstream tool name contains dots", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    vol.fromJSON(
      {
        [getCachePath()]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("issues.create")],
        }),
      },
      "/"
    );

    await resolveMcpProxies(root);

    expect(proxyGroup.children).toHaveLength(1);
    expect(proxyGroup.children[0]).toMatchObject({
      kind: "command",
      name: "issues.create",
    });
  });

  it("creates a nested group for dotted rename targets and preserves the upstream tool name in the handler call", async () => {
    const group = createProxyGroup({
      rename: {
        create_issue: "issues.create",
      },
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    vol.fromJSON(
      {
        [getCachePath()]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("create_issue")],
        }),
      },
      "/"
    );
    setClientPlans({});

    await resolveMcpProxies(root);

    expect(proxyGroup.children).toHaveLength(1);
    expect(proxyGroup.children[0]).toMatchObject({
      kind: "group",
      name: "issues",
    });

    const issuesGroup = proxyGroup.children[0];
    expect(issuesGroup?.kind).toBe("group");
    if (issuesGroup?.kind !== "group") {
      throw new Error("Expected issues group.");
    }

    expect(issuesGroup.children).toHaveLength(1);
    const createCommand = issuesGroup.children[0];
    expect(createCommand).toMatchObject({
      kind: "command",
      name: "create",
    });

    if (createCommand?.kind !== "command") {
      throw new Error("Expected create command.");
    }

    const result = await createCommand.handler(createContext({ title: "Bug" }) as never);

    expect(result).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(clientState.instances).toHaveLength(1);
    expect(clientState.instances[0]?.callTool).toHaveBeenCalledWith({
      name: "create_issue",
      arguments: { title: "Bug" },
    });
  });

  it("renames tools in place when the rename target has no dots", async () => {
    const group = createProxyGroup({
      rename: {
        create_issue: "create",
      },
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    vol.fromJSON(
      {
        [getCachePath()]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("create_issue")],
        }),
      },
      "/"
    );

    await resolveMcpProxies(root);

    expect(proxyGroup.children).toHaveLength(1);
    expect(proxyGroup.children[0]).toMatchObject({
      kind: "command",
      name: "create",
    });
  });

  it("rejects when rename references an unknown upstream tool", async () => {
    const group = createProxyGroup({
      rename: {
        create_issue: "issues.create",
      },
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });

    vol.fromJSON(
      {
        [getCachePath()]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("get_issue")],
        }),
      },
      "/"
    );

    await expect(resolveMcpProxies(root)).rejects.toThrow(
      `couldn't discover MCP github: rename references unknown upstream tool "create_issue"`
    );
  });

  it("merges auto-created intermediate groups with explicit sibling groups", async () => {
    const nativeList = defineCommand({
      name: "list",
      params: S.Object({}),
      handler: async () => "native",
    });
    const issuesGroup = defineGroup({
      name: "issues",
      children: [nativeList],
    });
    const group = createProxyGroup({
      rename: {
        create_issue: "issues.create",
      },
      children: [issuesGroup],
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    const explicitIssuesGroup = proxyGroup.children[0];
    expect(explicitIssuesGroup?.kind).toBe("group");
    if (explicitIssuesGroup?.kind !== "group") {
      throw new Error("Expected explicit issues group.");
    }

    vol.fromJSON(
      {
        [getCachePath()]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("create_issue")],
        }),
      },
      "/"
    );

    await resolveMcpProxies(root);

    const matchingGroups = proxyGroup.children.filter((child) => child.kind === "group" && child.name === "issues");
    expect(matchingGroups).toHaveLength(1);
    expect(matchingGroups[0]).toBe(explicitIssuesGroup);
    expect(explicitIssuesGroup.children.map((child) => child.name)).toEqual(["list", "create"]);
  });

  it("rejects when a rename target collides with an existing native command", async () => {
    const nativeCreate = defineCommand({
      name: "create",
      params: S.Object({}),
      handler: async () => "native",
    });
    const group = createProxyGroup({
      rename: {
        create_issue: "create",
      },
      children: [nativeCreate],
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });

    vol.fromJSON(
      {
        [getCachePath()]: JSON.stringify({
          $schema:
            "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
          version: 1,
          upstream: { name: "mock-upstream", version: "1.0.0" },
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [tool("create_issue")],
        }),
      },
      "/"
    );

    await expect(resolveMcpProxies(root)).rejects.toThrow(
      `couldn't discover MCP github: command path "create" collides with an existing child`
    );
  });

  it("keeps cache contents unchanged by rename decisions", async () => {
    const group = createProxyGroup({
      rename: {
        create_issue: "issues.create",
      },
    });
    const root = defineGroup({
      name: "root",
      children: [group],
    });

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    await resolveMcpProxies(root);

    const cache = JSON.parse(await mockFsPromises.readFile(getCachePath(), "utf8"));
    expect(cache.tools).toEqual([
      expect.objectContaining({
        name: "create_issue",
      }),
    ]);
  });

  it("emits fetch progress to stderr", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const stderrChunks: string[] = [];
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      return originalStderrWrite(chunk as never, ...(rest as never[]));
    }) as typeof process.stderr.write;

    try {
      await resolveMcpProxies(root);
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    expect(stderrChunks.join("")).toContain("MCP github: connecting");
    expect(stderrChunks.join("")).toContain("MCP github: listing tools");
    expect(stderrChunks.join("")).toContain("MCP github: found 1 tools");
    expect(stderrChunks.join("")).toContain(`MCP github: wrote ${getCachePath()}`);
  });

  it("writes cache files atomically through a sibling .tmp path before rename", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const calls: string[] = [];
    const originalWriteFile = mockFsPromises.writeFile.bind(mockFsPromises);
    const originalRename = mockFsPromises.rename.bind(mockFsPromises);

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    vi.spyOn(mockFsPromises, "writeFile").mockImplementation(async (...args) => {
      calls.push(`write:${String(args[0])}`);
      return originalWriteFile(...args);
    });
    vi.spyOn(mockFsPromises, "rename").mockImplementation(async (...args) => {
      calls.push(`rename:${String(args[0])}->${String(args[1])}`);
      return originalRename(...args);
    });

    await resolveMcpProxies(root);

    expect(calls).toEqual([
      `write:${getCachePath()}.tmp`,
      `rename:${getCachePath()}.tmp->${getCachePath()}`,
    ]);
  });

  it("re-fetches when the cache JSON is corrupt", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const proxyGroup = root.children[0];

    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }

    vol.fromJSON(
      {
        [getCachePath()]: "{invalid json",
      },
      "/"
    );
    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    await resolveMcpProxies(root);

    expect(clientState.instances).toHaveLength(1);
    expect(clientState.instances[0]?.listTools).toHaveBeenCalledTimes(1);
    expect(proxyGroup.children[0]).toMatchObject({
      kind: "command",
      name: "create_issue",
    });
  });
});
