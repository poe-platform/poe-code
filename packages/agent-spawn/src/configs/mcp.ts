import type { McpSpawnConfig } from "../types.js";

interface JsonMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export function toJsonMcpServers(servers: McpSpawnConfig): Record<string, JsonMcpServer> {
  validateMcpSpawnConfig(servers);
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

function isTomlBareKeySegment(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpperAlpha = code >= 65 && code <= 90;
    const isLowerAlpha = code >= 97 && code <= 122;
    if (!isDigit && !isUpperAlpha && !isLowerAlpha && char !== "_" && char !== "-") {
      return false;
    }
  }
  return true;
}

function toTomlKeySegment(value: string): string {
  return isTomlBareKeySegment(value) ? value : JSON.stringify(value);
}

export function validateMcpSpawnConfig(servers: McpSpawnConfig): void {
  for (const [name, server] of Object.entries(servers)) {
    if (typeof server.command !== "string" || server.command.trim().length === 0) {
      throw new Error(`MCP server "${name}" command must be a non-empty string.`);
    }
  }
}

export function serializeJsonMcpArgs(servers: McpSpawnConfig): string[] {
  return ["--mcp-config", JSON.stringify({ mcpServers: toJsonMcpServers(servers) })];
}

export function serializeOpenCodeMcpEnv(servers: McpSpawnConfig): Record<string, string> {
  validateMcpSpawnConfig(servers);
  const mcp: Record<
    string,
    { type: "local"; command: string[]; environment?: Record<string, string> }
  > = Object.create(null);
  for (const [name, server] of Object.entries(servers)) {
    if (server.timeout !== undefined) {
      throw new Error(`OpenCode MCP server "${name}" does not support timeout.`);
    }
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
  validateMcpSpawnConfig(servers);
  const args: string[] = [];

  for (const [name, server] of Object.entries(servers)) {
    const prefix = `mcp_servers.${toTomlKeySegment(name)}`;
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
  validateMcpSpawnConfig(servers);
  return Object.entries(servers).flatMap(([name, server]) => {
    if (server.env && Object.keys(server.env).length > 0) {
      throw new Error(`Goose MCP server "${name}" does not support env through --with-extension.`);
    }
    if (server.timeout !== undefined) {
      throw new Error(
        `Goose MCP server "${name}" does not support timeout through --with-extension.`
      );
    }
    return ["--with-extension", [server.command, ...(server.args ?? [])].join(" ")];
  });
}
