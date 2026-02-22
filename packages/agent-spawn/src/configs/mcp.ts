import type { McpSpawnConfig } from "../types.js";

interface JsonMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function toJsonMcpServers(servers: McpSpawnConfig): Record<string, JsonMcpServer> {
  const out: Record<string, JsonMcpServer> = {};

  for (const [name, server] of Object.entries(servers)) {
    const mapped: JsonMcpServer = { command: server.command };
    if (server.args && server.args.length > 0) {
      mapped.args = server.args;
    }
    if (server.env && Object.keys(server.env).length > 0) {
      mapped.env = server.env;
    }
    out[name] = mapped;
  }

  return out;
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toTomlArray(values: string[]): string {
  const serialized = values.map((value) => toTomlString(value));
  return `[${serialized.join(", ")}]`;
}

function toTomlInlineTable(values: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    parts.push(`${JSON.stringify(key)}=${toTomlString(value)}`);
  }
  return `{${parts.join(", ")}}`;
}

export function serializeJsonMcpArgs(servers: McpSpawnConfig): string[] {
  return ["--mcp-config", JSON.stringify({ mcpServers: toJsonMcpServers(servers) })];
}

export function serializeCodexMcpArgs(servers: McpSpawnConfig): string[] {
  const args: string[] = [];

  for (const [name, server] of Object.entries(servers)) {
    const prefix = `mcp_servers.${name}`;
    args.push("-c", `${prefix}.command=${toTomlString(server.command)}`);

    if (server.args && server.args.length > 0) {
      args.push("-c", `${prefix}.args=${toTomlArray(server.args)}`);
    }

    if (server.env && Object.keys(server.env).length > 0) {
      args.push("-c", `${prefix}.env=${toTomlInlineTable(server.env)}`);
    }
  }

  return args;
}
