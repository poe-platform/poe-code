export type McpModuleServerHandle = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpModuleTool = {
  name: string;
  description?: string;
  schema?: unknown;
};

export type McpModuleClient = {
  tools(): Promise<McpModuleTool[]>;
  tool(name: string, args?: unknown): Promise<unknown>;
};

type McpConnection = {
  listTools(): Promise<{
    tools: unknown[];
  }>;
  callTool(params: {
    name: string;
    arguments?: unknown;
  }): Promise<unknown>;
};

export type ConnectMcp = (
  server: McpModuleServerHandle
) => Promise<McpConnection> | McpConnection;

export function makeMcpModule(connectMcp: ConnectMcp): {
  server(server: McpModuleServerHandle): McpModuleServerHandle;
  client(handle: McpModuleServerHandle): Promise<McpModuleClient>;
} {
  return {
    server(server) {
      return normalizeServerHandle(server);
    },

    async client(handle) {
      const connection = validateConnection(
        await connectMcp(normalizeServerHandle(handle))
      );

      return {
        async tools() {
          return normalizeToolsResult(await connection.listTools());
        },

        async tool(name, args) {
          return connection.callTool({
            name: readNonEmptyTrimmedString(name, "MCP tool name"),
            ...(args === undefined ? {} : { arguments: readToolArguments(args) })
          });
        }
      };
    }
  };
}

function normalizeServerHandle(value: unknown): McpModuleServerHandle {
  if (!isRecord(value)) {
    throw new Error("MCP server must be an object.");
  }

  return {
    command: readNonEmptyTrimmedString(value.command, "MCP server command"),
    ...(value.args === undefined ? {} : { args: readStringArray(value.args, "MCP server args") }),
    ...(value.env === undefined ? {} : { env: readStringRecord(value.env, "MCP server env") })
  };
}

function validateConnection(value: unknown): McpConnection {
  if (
    !isRecord(value) ||
    typeof value.listTools !== "function" ||
    typeof value.callTool !== "function"
  ) {
    throw new Error("connectMcp must resolve to an object with listTools() and callTool().");
  }

  return {
    listTools: () => (value.listTools as McpConnection["listTools"])(),
    callTool: (params) => (value.callTool as McpConnection["callTool"])(params)
  };
}

function normalizeToolsResult(value: unknown): McpModuleTool[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    throw new Error("MCP listTools() must resolve to an object with a tools array.");
  }

  return value.tools.map((tool, index) => normalizeTool(tool, index));
}

function normalizeTool(value: unknown, index: number): McpModuleTool {
  if (!isRecord(value)) {
    throw new Error(`MCP tool[${index}] must be an object.`);
  }

  return {
    name: readNonEmptyString(value.name, `MCP tool[${index}] name`),
    ...(value.description === undefined
      ? {}
      : { description: readOptionalString(value.description, `MCP tool[${index}] description`) }),
    ...(value.inputSchema === undefined ? {} : { schema: value.inputSchema })
  };
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return [...value];
}

function readStringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const entries = Object.entries(value);

  if (entries.some(([, entry]) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string record.`);
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  const text = readOptionalString(value, label);

  if (text === undefined || text.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return text;
}

function readNonEmptyTrimmedString(value: unknown, label: string): string {
  return readNonEmptyString(value, label).trim();
}

function readToolArguments(value: unknown): Record<string, unknown> {
  if (!isPlainObjectRecord(value)) {
    throw new Error("MCP tool arguments must be an object.");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
