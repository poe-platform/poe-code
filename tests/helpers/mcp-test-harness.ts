import { spawn, type ChildProcess } from "child_process";

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolCallResult {
  type: string;
  text?: string;
  resource?: {
    uri: string;
    mimeType: string;
  };
}

interface McpTestClient {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult[]>;
  close(): Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function createMcpTestClient(
  command: string,
  args: string[]
): Promise<McpTestClient> {
  let requestId = 0;
  let process: ChildProcess | null = null;
  let buffer = "";
  const pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const sendRequest = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      if (!process || !process.stdin) {
        reject(new Error("Process not started"));
        return;
      }

      const id = ++requestId;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params && { params })
      };

      pendingRequests.set(id, { resolve, reject });
      process.stdin.write(JSON.stringify(request) + "\n");
    });
  };

  const handleMessage = (message: JsonRpcResponse) => {
    const pending = pendingRequests.get(message.id);
    if (pending) {
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  };

  process = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });

  process.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JsonRpcResponse;
          handleMessage(message);
        } catch {
          // Ignore non-JSON lines
        }
      }
    }
  });

  // Initialize the connection
  await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-test-harness", version: "1.0.0" }
  });

  await sendRequest("notifications/initialized");

  return {
    async listTools(): Promise<McpTool[]> {
      const result = await sendRequest("tools/list") as { tools: McpTool[] };
      return result.tools;
    },

    async callTool(name: string, toolArgs: Record<string, unknown>): Promise<McpToolCallResult[]> {
      const result = await sendRequest("tools/call", {
        name,
        arguments: toolArgs
      }) as { content: McpToolCallResult[] };
      return result.content;
    },

    async close(): Promise<void> {
      if (process) {
        process.kill();
        process = null;
      }
    }
  };
}

export function normalizeToolSchema(tool: McpTool): {
  name: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
} {
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = schema.properties || {};
  const required = schema.required || [];

  return {
    name: tool.name,
    description: tool.description,
    requiredParams: required,
    optionalParams: Object.keys(properties).filter((p) => !required.includes(p))
  };
}
