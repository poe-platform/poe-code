import { McpError } from "tiny-mcp-client";
import { hostErrorData } from "../error/shape.js";
import { declareHostOperation } from "../interp/host-bridge.js";
import { runResources } from "../interp/resources.js";
import {
  connectMcpTransport,
  normalizeMcpOptions,
  type ManagedMcpConnection,
  type McpModuleOptions
} from "./mcp-transport.js";

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
  callTool(params: { name: string; arguments?: unknown }): Promise<unknown>;
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

export type ConnectMcp = (server: McpModuleServerHandle) => Promise<McpConnection> | McpConnection;

export type McpNamedServerHandle = { name: string };
export type ManagedMcpClient = McpModuleClient & { close(): Promise<void> };
export type ManagedMcpModule = {
  servers: Record<string, ManagedMcpClient>;
  server(name: string): McpNamedServerHandle;
  client(handle: McpNamedServerHandle | string): Promise<ManagedMcpClient>;
};

type CustomMcpModule = {
  server(server: McpModuleServerHandle): McpModuleServerHandle;
  client(handle: McpModuleServerHandle): Promise<McpModuleClient>;
};

export function makeMcpModule(options: McpModuleOptions): ManagedMcpModule;
export function makeMcpModule(connectMcp: ConnectMcp): CustomMcpModule;
export function makeMcpModule(
  connectMcp: ConnectMcp | McpModuleOptions
): CustomMcpModule | ManagedMcpModule {
  if (typeof connectMcp !== "function") {
    const options = normalizeMcpOptions(connectMcp);
    const servers = Object.create(null) as Record<string, ManagedMcpClient>;
    for (const [name, config] of Object.entries(options.servers)) {
      const connections = new WeakMap<object, ManagedMcpConnection>();
      const directScope = {};
      const connection = () => {
        const scope = runResources.getStore();
        scope?.signal.throwIfAborted();
        options.signal?.throwIfAborted();
        const owner = scope ?? directScope;
        let current = connections.get(owner);
        if (current === undefined) {
          current = connectMcpTransport(config, options, scope?.signal);
          connections.set(owner, current);
          scope?.add(current.close);
        }
        return current.ready;
      };
      const invoke = async <Result>(
        operation: (client: Awaited<ReturnType<typeof connection>>) => Promise<Result>
      ): Promise<Result> => {
        try {
          const result = await operation(await connection());
          runResources.getStore()?.signal.throwIfAborted();
          options.signal?.throwIfAborted();
          return result;
        } catch (error) {
          runResources.getStore()?.signal.throwIfAborted();
          options.signal?.throwIfAborted();
          if (error instanceof McpError) {
            hostErrorData.set(error, {
              code: error.code,
              ...(error.data === undefined ? {} : { data: error.data })
            });
          }
          throw error;
        }
      };
      servers[name] = {
        tools: declareHostOperation(
          async () =>
            invoke(async (client) => {
              const tools: McpModuleTool[] = [];
              const cursors = new Set<string>();
              let pages = 0;
              let cursor: string | undefined;
              do {
                const result = await client.listTools(
                  cursor === undefined ? undefined : { cursor }
                );
                pages += 1;
                tools.push(...normalizeToolsResult(result));
                cursor = result.nextCursor;
                if (cursor !== undefined) {
                  if (typeof cursor !== "string" || cursors.has(cursor))
                    throw new Error("MCP tools pagination did not advance.");
                  cursors.add(cursor);
                  if (pages >= options.maxToolPages!)
                    throw new Error("MCP tools page limit exceeded.");
                }
              } while (cursor !== undefined);
              return tools;
            }),
          "re-issue"
        ),
        tool: declareHostOperation(async (toolName: string, args?: unknown) => {
          const request = createNullRecord({
            name: readNonEmptyTrimmedString(toolName, "MCP tool name"),
            ...(args === undefined ? {} : { arguments: readToolArguments(args) })
          });
          return invoke((client) => client.callTool(request));
        }, "read-side-effect"),
        toolBatch: declareHostOperation(async (calls: McpModuleToolCall[]) => {
          const normalized = readToolBatchCalls(calls);
          if (normalized.length === 0) return [];
          return invoke((client) => executeToolBatch(client, normalized));
        }, "read-side-effect"),
        close: declareHostOperation(async () => {
          const owner = runResources.getStore() ?? directScope;
          const current = connections.get(owner);
          if (current !== undefined) {
            await current.close();
            connections.delete(owner);
          }
        }, "re-issue")
      };
    }
    const readName = (value: unknown): string => {
      const name = readNonEmptyString(value, "MCP server name");
      if (!Object.hasOwn(servers, name)) throw new Error(`MCP server '${name}' is not configured.`);
      return name;
    };
    return {
      servers,
      server(name: string) {
        return createNullRecord({ name: readName(name) });
      },
      async client(handle: McpNamedServerHandle | string) {
        if (typeof handle === "string") return servers[readName(handle)];
        if (!isRecord(handle) || Object.keys(handle).length !== 1 || !Object.hasOwn(handle, "name"))
          throw new TypeError("MCP client requires a named server handle.");
        return servers[readName(getOwnProperty(handle, "name"))];
      }
    };
  }
  return {
    server(server: McpModuleServerHandle) {
      return normalizeServerHandle(server);
    },

    async client(handle: McpModuleServerHandle) {
      const connection = validateConnection(await connectMcp(normalizeServerHandle(handle)));

      return {
        async tools() {
          return normalizeToolsResult(await connection.listTools());
        },

        async tool(name: string, args?: unknown) {
          return connection.callTool(
            createNullRecord({
              name: readNonEmptyTrimmedString(name, "MCP tool name"),
              ...(args === undefined ? {} : { arguments: readToolArguments(args) })
            })
          );
        },

        async toolBatch(calls: McpModuleToolCall[]) {
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
      return calls.map(() =>
        createNullRecord({
          ok: false,
          error: batchError
        })
      );
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
        results[index] = createNullRecord({
          ok: false,
          error: call.error
        });
        continue;
      }

      if (disconnectError !== undefined) {
        results[index] = createNullRecord({
          ok: false,
          error: disconnectError
        });
        continue;
      }

      try {
        results[index] = createNullRecord({
          ok: true,
          value: await connection.callTool(call.request)
        });
      } catch (error) {
        const toolError = normalizeToolBatchError(error);
        results[index] = createNullRecord({
          ok: false,
          error: toolError
        });

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
    throw new Error(
      "MCP callToolBatch() must resolve to a result array matching the input length."
    );
  }

  return value.map((entry, index) => normalizeProtocolBatchResult(entry, index));
}

function normalizeProtocolBatchResult(value: unknown, index: number): McpModuleToolBatchResult {
  if (!isRecord(value)) {
    throw new Error(`MCP callToolBatch()[${index}] must be a result envelope.`);
  }

  const ok = getOwnProperty(value, "ok");
  if (typeof ok !== "boolean") {
    throw new Error(`MCP callToolBatch()[${index}] must be a result envelope.`);
  }

  if (ok === true) {
    return createNullRecord({
      ok: true,
      value: getOwnProperty(value, "value")
    });
  }

  return createNullRecord({
    ok: false,
    error: normalizeToolBatchError(getOwnProperty(value, "error"))
  });
}

function normalizeServerHandle(value: unknown): McpModuleServerHandle {
  if (!isRecord(value)) {
    throw new Error("MCP server must be an object.");
  }

  const command = getOwnProperty(value, "command");
  const args = getOwnProperty(value, "args");
  const env = getOwnProperty(value, "env");

  return createNullRecord({
    command: readNonEmptyTrimmedString(command, "MCP server command"),
    ...(args === undefined ? {} : { args: readStringArray(args, "MCP server args") }),
    ...(env === undefined ? {} : { env: readStringRecord(env, "MCP server env") })
  });
}

function validateConnection(value: unknown): McpConnection {
  if (
    !isRecord(value) ||
    typeof value.listTools !== "function" ||
    typeof value.callTool !== "function"
  ) {
    throw new Error("connectMcp must resolve to an object with listTools() and callTool().");
  }

  const callToolBatch = getOwnProperty(value, "callToolBatch");

  return createNullRecord({
    listTools: () => (value.listTools as McpConnection["listTools"])(),
    callTool: (params) => (value.callTool as McpConnection["callTool"])(params),
    ...(typeof callToolBatch === "function"
      ? {
          callToolBatch: (params: McpToolRequest[]) =>
            (callToolBatch as NonNullable<McpConnection["callToolBatch"]>)(params)
        }
      : {})
  });
}

function normalizeToolsResult(value: unknown): McpModuleTool[] {
  const tools = isRecord(value) ? getOwnProperty(value, "tools") : undefined;
  if (!Array.isArray(tools)) {
    throw new Error("MCP listTools() must resolve to an object with a tools array.");
  }

  return tools.map((tool, index) => normalizeTool(tool, index));
}

function normalizeTool(value: unknown, index: number): McpModuleTool {
  if (!isRecord(value)) {
    throw new Error(`MCP tool[${index}] must be an object.`);
  }

  const description = getOwnProperty(value, "description");
  const inputSchema = getOwnProperty(value, "inputSchema");

  return createNullRecord({
    name: readNonEmptyString(getOwnProperty(value, "name"), `MCP tool[${index}] name`),
    ...(description === undefined
      ? {}
      : { description: readOptionalString(description, `MCP tool[${index}] description`) }),
    ...(inputSchema === undefined ? {} : { schema: inputSchema })
  });
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

  return createNullRecord(Object.fromEntries(entries) as Record<string, string>);
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

  return createNullRecord(Object.fromEntries(Object.entries(value)) as Record<string, unknown>);
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

    const args = getOwnProperty(value, "args");

    return createNullRecord({
      ok: true,
      request: createNullRecord({
        name: readNonEmptyTrimmedString(
          getOwnProperty(value, "name"),
          `MCP toolBatch call[${index}] name`
        ),
        ...(args === undefined ? {} : { arguments: readToolArguments(args) })
      })
    });
  } catch (error) {
    return createNullRecord({
      ok: false,
      error: normalizeToolBatchError(error)
    });
  }
}

function normalizeToolBatchError(error: unknown): McpModuleToolBatchError {
  if (error instanceof Error) {
    return createNullRecord({
      name: error.name.length === 0 ? "Error" : error.name,
      message: error.message
    });
  }

  if (isRecord(error)) {
    const nameValue = getOwnProperty(error, "name");
    const messageValue = getOwnProperty(error, "message");
    const name = typeof nameValue === "string" && nameValue.trim().length > 0 ? nameValue : "Error";
    const message = typeof messageValue === "string" ? messageValue : String(error);

    return createNullRecord({
      name,
      message
    });
  }

  return createNullRecord({
    name: "Error",
    message: error === undefined ? "" : String(error)
  });
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

function getOwnProperty<Name extends PropertyKey>(value: object, name: Name): unknown {
  return hasOwnProperty(value, name) ? value[name] : undefined;
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function createNullRecord<T extends object>(value: T): T {
  return Object.assign(Object.create(null) as T, value);
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
