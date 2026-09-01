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
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
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

const mockConfigFingerprint = "99d35d6c3b38b60d122e851df954e925a19ec49804367e9c20ed492009d8878b";

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

vi.mock("toolcraft-design", () => ({
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
  StdioTransport: vi.fn(function MockStdioTransport(
    this: { options: Record<string, unknown> },
    options: Record<string, unknown>
  ) {
    this.options = options;
    transportState.stdio.push(options);
  }),
  HttpTransport: vi.fn(function MockHttpTransport(
    this: { options: Record<string, unknown> },
    options: Record<string, unknown>
  ) {
    this.options = options;
    transportState.http.push(options);
  }),
}));

const { parseRefreshEnv, resolveCachePath, resolveMcpProxies } = await import("./mcp-proxy.js");

async function withObjectPrototypeCode<T>(code: string, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    value: code,
    writable: true
  });

  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(Object.prototype, "code", descriptor);
    } else {
      delete (Object.prototype as { code?: unknown }).code;
    }
  }
}

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
    diagnostics: { level: "silent" as const, emit: vi.fn() },
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

  it("rejects cache group names containing path components", () => {
    expect(() => resolveCachePath("../../../outside/escaped", "/repo")).toThrow(
      /MCP proxy group name must be a file-safe name/
    );
  });
});

describe("resolveMcpProxies", () => {
  const originalRefresh = process.env.TOOLCRAFT_MCP_REFRESH;

  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
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
    vi.restoreAllMocks();
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
          configFingerprint: mockConfigFingerprint,
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [
            {
              ...tool("create_issue"),
              title: "Create issue",
              annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true,
              },
            },
          ],
        }),
      },
      "/"
    );

    await resolveMcpProxies(root);

    expect(proxyGroup.children).toHaveLength(1);
    expect(proxyGroup.children[0]).toMatchObject({
      kind: "command",
      name: "create_issue",
      title: "Create issue",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
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
          configFingerprint: mockConfigFingerprint,
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
          configFingerprint: mockConfigFingerprint,
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
          configFingerprint: mockConfigFingerprint,
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

  it("rejects typed upstream tool results that omit structuredContent", async () => {
    const group = createProxyGroup({});
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
          configFingerprint: mockConfigFingerprint,
          fetchedAt: "2026-04-26T12:00:00.000Z",
          tools: [
            {
              ...tool("create_issue"),
              outputSchema: {
                type: "object",
                properties: {
                  id: { type: "string" },
                },
                required: ["id"],
                additionalProperties: false,
              },
            },
          ],
        }),
      },
      "/"
    );
    setClientPlans({ callToolResult: { content: [{ type: "text", text: "{\"id\":\"1\"}" }] } });

    await resolveMcpProxies(root);

    const proxyGroup = root.children[0];
    expect(proxyGroup?.kind).toBe("group");
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }
    const createCommand = proxyGroup.children[0];
    expect(createCommand?.kind).toBe("command");
    if (createCommand?.kind !== "command") {
      throw new Error("Expected create command.");
    }

    await expect(createCommand.handler(createContext({ title: "Bug" }) as never)).rejects.toThrow(
      'upstream tool "create_issue" declared outputSchema but returned no structuredContent'
    );
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
          configFingerprint: mockConfigFingerprint,
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
          configFingerprint: mockConfigFingerprint,
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
          configFingerprint: mockConfigFingerprint,
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
          configFingerprint: mockConfigFingerprint,
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

  it("does not cache invalid discovered tool schemas and retries upstream later", async () => {
    const first = createProxyGroup({});
    const firstRoot = defineGroup({ name: "root", children: [first] });
    setClientPlans({ pages: [{ tools: [tool("bad_tool", { type: "string" })] }] });

    await expect(resolveMcpProxies(firstRoot)).rejects.toThrow(/bad_tool/);
    await expect(mockFsPromises.readFile(getCachePath(), "utf8")).rejects.toThrow();

    const second = createProxyGroup({});
    const secondRoot = defineGroup({ name: "root", children: [second] });
    const secondGroup = secondRoot.children[0];
    if (secondGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }
    setClientPlans({ pages: [{ tools: [tool("good_tool")] }] });
    await resolveMcpProxies(secondRoot);

    expect(secondGroup.children.map((child) => child.name)).toEqual(["good_tool"]);
    expect(clientState.instances).toHaveLength(2);
  });

  it("keeps working proxy children when a cached replacement is invalid", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({ name: "root", children: [group] });
    const proxyGroup = root.children[0];
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }
    vol.fromJSON({
      [getCachePath()]: JSON.stringify({
        version: 1,
        upstream: { name: "cached", version: "1" },
        configFingerprint: mockConfigFingerprint,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        tools: [tool("old_tool")]
      })
    }, "/");
    await resolveMcpProxies(root);
    expect(proxyGroup.children.map((child) => child.name)).toEqual(["old_tool"]);

    await mockFsPromises.writeFile(getCachePath(), JSON.stringify({
      version: 1,
      upstream: { name: "cached", version: "1" },
      configFingerprint: mockConfigFingerprint,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      tools: [tool("new_tool"), tool("bad_tool", { type: "string" })]
    }));

    await expect(resolveMcpProxies(root)).rejects.toThrow(/bad_tool/);
    expect(proxyGroup.children.map((child) => child.name)).toEqual(["old_tool"]);
  });

  it("retains last known good cache when a forced refresh fails", async () => {
    const cached = createProxyGroup({});
    const cachedRoot = defineGroup({ name: "root", children: [cached] });
    setClientPlans({ pages: [{ tools: [tool("stable_tool")] }] });
    await resolveMcpProxies(cachedRoot);
    const before = await mockFsPromises.readFile(getCachePath(), "utf8");

    process.env.TOOLCRAFT_MCP_REFRESH = "github";
    const refreshing = createProxyGroup({});
    const refreshRoot = defineGroup({ name: "root", children: [refreshing] });
    setClientPlans({ pages: [{ tools: [tool("bad_tool", { type: "string" })] }] });
    await expect(resolveMcpProxies(refreshRoot)).rejects.toThrow(/bad_tool/);
    await expect(mockFsPromises.readFile(getCachePath(), "utf8")).resolves.toBe(before);

    delete process.env.TOOLCRAFT_MCP_REFRESH;
    const reused = createProxyGroup({});
    const reusedRoot = defineGroup({ name: "root", children: [reused] });
    const reusedGroup = reusedRoot.children[0];
    if (reusedGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }
    await resolveMcpProxies(reusedRoot);
    expect(reusedGroup.children.map((child) => child.name)).toEqual(["stable_tool"]);
  });

  it("refetches proxy tools after upstream configuration changes", async () => {
    const first = createProxyGroup({});
    const firstRoot = defineGroup({ name: "root", children: [first] });
    setClientPlans({ pages: [{ tools: [tool("first_tool")] }] });
    await resolveMcpProxies(firstRoot);

    const second = defineGroup({
      name: "github",
      mcp: { transport: "stdio", command: "different-server" },
      children: []
    });
    const secondRoot = defineGroup({ name: "root", children: [second] });
    const secondGroup = secondRoot.children[0];
    if (secondGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }
    setClientPlans({ pages: [{ tools: [tool("second_tool")] }] });
    await resolveMcpProxies(secondRoot);

    expect(secondGroup.children.map((child) => child.name)).toEqual(["second_tool"]);
    expect(clientState.instances).toHaveLength(2);
  });

  it("refetches legacy caches that cannot identify their upstream configuration", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({ name: "root", children: [group] });
    const proxyGroup = root.children[0];
    if (proxyGroup?.kind !== "group") {
      throw new Error("Expected proxy group.");
    }
    vol.fromJSON({
      [getCachePath()]: JSON.stringify({
        version: 1,
        upstream: { name: "legacy", version: "1" },
        fetchedAt: "2026-01-01T00:00:00.000Z",
        tools: [tool("legacy_tool")]
      })
    }, "/");
    setClientPlans({ pages: [{ tools: [tool("fresh_tool")] }] });

    await resolveMcpProxies(root);

    expect(proxyGroup.children.map((child) => child.name)).toEqual(["fresh_tool"]);
    expect(clientState.instances).toHaveLength(1);
    const cache = JSON.parse(await mockFsPromises.readFile(getCachePath(), "utf8"));
    expect(cache.configFingerprint).toBe(mockConfigFingerprint);
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
    const writeOptions: unknown[] = [];
    const originalWriteFile = mockFsPromises.writeFile.bind(mockFsPromises);
    const originalRename = mockFsPromises.rename.bind(mockFsPromises);

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    vi.spyOn(mockFsPromises, "writeFile").mockImplementation(async (...args) => {
      calls.push(`write:${String(args[0])}`);
      writeOptions.push(args[2]);
      return originalWriteFile(...args);
    });
    vi.spyOn(mockFsPromises, "rename").mockImplementation(async (...args) => {
      calls.push(`rename:${String(args[0])}->${String(args[1])}`);
      return originalRename(...args);
    });

    await resolveMcpProxies(root);

    expect(calls).toHaveLength(2);
    expect(writeOptions).toEqual([{ encoding: "utf8", flag: "wx" }]);
    expect(calls[0]).toMatch(new RegExp(`^write:${getCachePath().replaceAll(".", "\\.")}\\.tmp-`));
    expect(calls[1]).toMatch(new RegExp(`^rename:${getCachePath().replaceAll(".", "\\.")}\\.tmp-.*->${getCachePath().replaceAll(".", "\\.")}$`));
  });

  it("removes a staged cache file when atomic rename fails", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    let stagedPath: string | undefined;
    const originalWriteFile = mockFsPromises.writeFile.bind(mockFsPromises);

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    vi.spyOn(mockFsPromises, "writeFile").mockImplementation(async (...args) => {
      stagedPath = String(args[0]);
      return originalWriteFile(...args);
    });
    vi.spyOn(mockFsPromises, "rename").mockRejectedValue(
      Object.assign(new Error("rename failed"), { code: "EIO" })
    );

    await expect(resolveMcpProxies(root)).rejects.toThrow(/couldn't discover MCP github: rename failed/);

    expect(stagedPath).toMatch(new RegExp(`^${getCachePath().replaceAll(".", "\\.")}\\.tmp-`));
    expect(vol.existsSync(stagedPath ?? "")).toBe(false);
    expect(vol.existsSync(getCachePath())).toBe(false);
  });

  it("removes a partial cache file when atomic write fails", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    let stagedPath: string | undefined;
    const originalWriteFile = mockFsPromises.writeFile.bind(mockFsPromises);

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    vi.spyOn(mockFsPromises, "writeFile").mockImplementation(async (...args) => {
      const targetPath = String(args[0]);
      if (targetPath.startsWith(`${getCachePath()}.tmp-`)) {
        stagedPath = targetPath;
        await originalWriteFile(args[0] as string, "partial\n", args[2] as never);
        throw new Error("disk full");
      }

      return originalWriteFile(...args);
    });

    await withObjectPrototypeCode("EEXIST", async () => {
      await expect(resolveMcpProxies(root)).rejects.toThrow(/couldn't discover MCP github: disk full/);
    });

    expect(stagedPath).toMatch(new RegExp(`^${getCachePath().replaceAll(".", "\\.")}\\.tmp-`));
    expect(vol.existsSync(stagedPath ?? "")).toBe(false);
    expect(vol.existsSync(getCachePath())).toBe(false);
  });

  it("does not follow cache temp symlinks inserted before write", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({
      name: "root",
      children: [group],
    });
    const originalWriteFile = mockFsPromises.writeFile.bind(mockFsPromises);
    vol.mkdirSync("/outside", { recursive: true });
    vol.writeFileSync("/outside/cache.json", "outside-state\n");

    setClientPlans({
      pages: [{ tools: [tool("create_issue")] }],
    });

    vi.spyOn(mockFsPromises, "writeFile").mockImplementation(async (...args) => {
      const targetPath = String(args[0]);
      if (targetPath.startsWith(`${getCachePath()}.tmp-`)) {
        vol.symlinkSync("/outside/cache.json", targetPath);
      }

      return originalWriteFile(...args);
    });

    await expect(resolveMcpProxies(root)).rejects.toThrow(/couldn't discover MCP github:/);
    expect(vol.readFileSync("/outside/cache.json", "utf8")).toBe("outside-state\n");
    expect(vol.existsSync(getCachePath())).toBe(false);
  });

  it("uses distinct staging files for concurrent cache writers", async () => {
    const first = createProxyGroup({});
    const second = createProxyGroup({});
    const paths: string[] = [];
    const originalWriteFile = mockFsPromises.writeFile.bind(mockFsPromises);
    vi.spyOn(mockFsPromises, "writeFile").mockImplementation(async (...args) => {
      paths.push(String(args[0]));
      return originalWriteFile(...args);
    });
    setClientPlans(
      { pages: [{ tools: [tool("first_tool")] }] },
      { pages: [{ tools: [tool("second_tool")] }] }
    );

    await Promise.all([
      resolveMcpProxies(defineGroup({ name: "root", children: [first] })),
      resolveMcpProxies(defineGroup({ name: "root", children: [second] }))
    ]);

    expect(new Set(paths).size).toBe(2);
  });

  it("rejects symlinked cache directories before writing proxy discovery", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({ name: "root", children: [group] });
    vol.mkdirSync("/repo/.toolcraft", { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    vol.symlinkSync("/outside", "/repo/.toolcraft/mcp");
    setClientPlans({ pages: [{ tools: [tool("create_issue")] }] });

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(resolveMcpProxies(root)).rejects.toThrow(/MCP cache path must not contain symbolic links/);
    });
    expect(vol.existsSync("/outside/github.json")).toBe(false);
  });

  it("rejects symlinked cache files before loading external proxy tools", async () => {
    const group = createProxyGroup({});
    const root = defineGroup({ name: "root", children: [group] });
    vol.mkdirSync("/repo/.toolcraft/mcp", { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    vol.writeFileSync(
      "/outside/github.json",
      JSON.stringify({
        version: 1,
        upstream: { name: "external", version: "1" },
        fetchedAt: "2026-01-01T00:00:00.000Z",
        tools: [tool("external_tool")]
      })
    );
    vol.symlinkSync("/outside/github.json", getCachePath());

    await withObjectPrototypeCode("ENOENT", async () => {
      await expect(resolveMcpProxies(root)).rejects.toThrow(/MCP cache path must not contain symbolic links/);
    });
    expect(group.children).toHaveLength(0);
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
