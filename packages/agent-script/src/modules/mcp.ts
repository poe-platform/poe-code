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

export type McpModuleToolCall = {
  name: string;
  args?: unknown;
};

export type McpModuleToolBatchError = {
  name: string;
  message: string;
};

export type McpModuleToolBatchResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      error: McpModuleToolBatchError;
    };

export type McpModuleClient = {
  tools(): Promise<McpModuleTool[]>;
  tool(name: string, args?: unknown): Promise<unknown>;
  toolBatch(calls: McpModuleToolCall[]): Promise<McpModuleToolBatchResult[]>;
};

type McpConnection = {
  listTools(): Promise<{
    tools: unknown[];
  }>;
  callTool(params: {
    name: string;
    arguments?: unknown;
  }): Promise<unknown>;
  callToolBatch?(
    params: Array<{
      name: string;
      arguments?: unknown;
    }>
  ): Promise<McpModuleToolBatchResult[]>;
};

type McpToolRequest = Parameters<McpConnection["callTool"]>[0];

type NormalizedToolBatchCall =
  | {
      ok: true;
      request: McpToolRequest;
    }
  | {
      ok: false;
      error: McpModuleToolBatchError;
    };

const DEFAULT_TOOL_BATCH_CONCURRENCY = 4;

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
        },

        async toolBatch(calls) {
          return executeToolBatch(connection, readToolBatchCalls(calls));
        }
      };
    }
  };
}

async function executeToolBatch(
  connection: McpConnection,
  calls: NormalizedToolBatchCall[]
): Promise<McpModuleToolBatchResult[]> {
  if (calls.length === 0) {
    return [];
  }

  if (connection.callToolBatch !== undefined && calls.every((call) => call.ok)) {
    try {
      return normalizeProtocolBatchResults(
        await connection.callToolBatch(calls.map((call) => call.request)),
        calls.length
      );
    } catch (error) {
      const batchError = normalizeToolBatchError(error);
      return calls.map(() => ({
        ok: false,
        error: batchError
      }));
    }
  }

  return executeToolBatchWithConcurrency(connection, calls, DEFAULT_TOOL_BATCH_CONCURRENCY);
}

async function executeToolBatchWithConcurrency(
  connection: McpConnection,
  calls: NormalizedToolBatchCall[],
  concurrency: number
): Promise<McpModuleToolBatchResult[]> {
  const results = new Array<McpModuleToolBatchResult>(calls.length);
  let nextIndex = 0;
  let disconnectError: McpModuleToolBatchError | undefined;

  const workerCount = Math.min(concurrency, calls.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < calls.length) {
      const index = nextIndex;
      nextIndex += 1;

      const call = calls[index];
      if (call === undefined) {
        continue;
      }

      if (!call.ok) {
        results[index] = {
          ok: false,
          error: call.error
        };
        continue;
      }

      if (disconnectError !== undefined) {
        results[index] = {
          ok: false,
          error: disconnectError
        };
        continue;
      }

      try {
        results[index] = {
          ok: true,
          value: await connection.callTool(call.request)
        };
      } catch (error) {
        const toolError = normalizeToolBatchError(error);
        results[index] = {
          ok: false,
          error: toolError
        };

        if (isMcpDisconnectError(toolError)) {
          disconnectError = toolError;
        }
      }
    }
  });

  await Promise.all(workers);

  return results;
}

function normalizeProtocolBatchResults(
  value: unknown,
  expectedLength: number
): McpModuleToolBatchResult[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error("MCP callToolBatch() must resolve to a result array matching the input length.");
  }

  return value.map((entry, index) => normalizeProtocolBatchResult(entry, index));
}

function normalizeProtocolBatchResult(value: unknown, index: number): McpModuleToolBatchResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error(`MCP callToolBatch()[${index}] must be a result envelope.`);
  }

  if (value.ok === true) {
    return {
      ok: true,
      value: value.value
    };
  }

  return {
    ok: false,
    error: normalizeToolBatchError(value.error)
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
    callTool: (params) => (value.callTool as McpConnection["callTool"])(params),
    ...(typeof value.callToolBatch === "function"
      ? {
          callToolBatch: (params: McpToolRequest[]) =>
            (value.callToolBatch as NonNullable<McpConnection["callToolBatch"]>)(params)
        }
      : {})
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

function readToolBatchCalls(value: unknown): NormalizedToolBatchCall[] {
  if (!Array.isArray(value)) {
    throw new Error("MCP toolBatch calls must be an array.");
  }

  return value.map((entry, index) => normalizeToolBatchCall(entry, index));
}

function normalizeToolBatchCall(value: unknown, index: number): NormalizedToolBatchCall {
  try {
    if (!isRecord(value)) {
      throw new Error(`MCP toolBatch call[${index}] must be an object.`);
    }

    return {
      ok: true,
      request: {
        name: readNonEmptyTrimmedString(value.name, `MCP toolBatch call[${index}] name`),
        ...(value.args === undefined ? {} : { arguments: readToolArguments(value.args) })
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeToolBatchError(error)
    };
  }
}

function normalizeToolBatchError(error: unknown): McpModuleToolBatchError {
  if (error instanceof Error) {
    return {
      name: error.name.length === 0 ? "Error" : error.name,
      message: error.message
    };
  }

  if (isRecord(error)) {
    const name = typeof error.name === "string" && error.name.trim().length > 0
      ? error.name
      : "Error";
    const message = typeof error.message === "string"
      ? error.message
      : String(error);

    return {
      name,
      message
    };
  }

  return {
    name: "Error",
    message: error === undefined ? "" : String(error)
  };
}

function isMcpDisconnectError(error: McpModuleToolBatchError): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes("disconnected") ||
    message.includes("connection closed") ||
    message.includes("transport closed") ||
    message.includes("disposed") ||
    message.includes("eof")
  );
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
