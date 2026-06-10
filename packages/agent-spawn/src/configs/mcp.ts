import type { McpSpawnConfig } from "../types.js";

interface JsonMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

function toJsonMcpServers(servers: McpSpawnConfig): Record<string, JsonMcpServer> {
  const out: Record<string, JsonMcpServer> = Object.create(null);

  for (const [name, server] of Object.entries(servers)) {
    const mapped: JsonMcpServer = { command: server.command };
    if (server.args && server.args.length > 0) {
      mapped.args = server.args;
    }
    if (server.env && Object.keys(server.env).length > 0) {
      mapped.env = server.env;
    }
    if (server.timeout !== undefined) {
      mapped.timeout = server.timeout;
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

export function serializeOpenCodeMcpEnv(servers: McpSpawnConfig): Record<string, string> {
  const mcp: Record<
    string,
    { type: "local"; command: string[]; environment?: Record<string, string> }
  > = Object.create(null);
  for (const [name, server] of Object.entries(servers)) {
    const entry: {
      type: "local";
      command: string[];
      environment?: Record<string, string>;
    } = { type: "local", command: [server.command, ...(server.args ?? [])] };
    if (server.env && Object.keys(server.env).length > 0) {
      entry.environment = server.env;
    }
    mcp[name] = entry;
  }
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp }) };
}

export function serializeCodexMcpArgs(servers: McpSpawnConfig): string[] {
  const args: string[] = [];

  for (const [name, server] of Object.entries(servers)) {
    const prefix = `mcp_servers.${name}`;
    args.push("-c", `${prefix}.command=${toTomlString(server.command)}`);
    if (server.autoApprove !== false) {
      args.push("-c", `${prefix}.default_tools_approval_mode=${toTomlString("approve")}`);
    }

    if (server.args && server.args.length > 0) {
      args.push("-c", `${prefix}.args=${toTomlArray(server.args)}`);
    }

    if (server.env && Object.keys(server.env).length > 0) {
      args.push("-c", `${prefix}.env=${toTomlInlineTable(server.env)}`);
    }

    if (server.timeout !== undefined) {
      args.push("-c", `${prefix}.timeout=${server.timeout}`);
    }
  }

  return args;
}

export function serializeGooseMcpArgs(servers: McpSpawnConfig): string[] {
  return Object.values(servers).flatMap((server) => [
    "--with-extension",
    [server.command, ...(server.args ?? [])].join(" ")
  ]);
}
