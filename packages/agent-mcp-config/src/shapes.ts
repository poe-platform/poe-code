import type { McpServerConfig, McpServerEntry } from "./types.js";

export type ShapeName = "standard" | "opencode" | "goose";

export interface StandardShapeOutput {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface OpencodeShapeOutput {
  type: "local";
  command: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface GooseStdioShapeOutput {
  type: "stdio";
  cmd: string;
  args?: string[];
  envs?: Record<string, string>;
}

export interface GooseHttpShapeOutput {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type GooseShapeOutput = GooseStdioShapeOutput | GooseHttpShapeOutput;

export type ShapeOutput =
  | StandardShapeOutput
  | OpencodeShapeOutput
  | GooseShapeOutput;

export type ShapeTransformer = (
  entry: McpServerEntry
) => ShapeOutput | undefined;

function transformStdioServer(
  config: Extract<McpServerConfig, { transport: "stdio" }>,
  enabled: boolean
): StandardShapeOutput | undefined {
  if (!enabled) {
    return undefined;
  }
  const result: StandardShapeOutput = {
    command: config.command
  };
  if (config.args && config.args.length > 0) {
    result.args = config.args;
  }
  if (config.env && Object.keys(config.env).length > 0) {
    result.env = config.env;
  }
  return result;
}

export function standardShape(entry: McpServerEntry): ShapeOutput | undefined {
  const enabled = entry.enabled !== false;

  if (entry.config.transport === "stdio") {
    return transformStdioServer(entry.config, enabled);
  }

  if (!enabled) {
    return undefined;
  }

  return {
    command: entry.config.url
  };
}

function transformStdioServerOpencode(
  config: Extract<McpServerConfig, { transport: "stdio" }>,
  enabled: boolean
): OpencodeShapeOutput {
  const command = config.args && config.args.length > 0
    ? [config.command, ...config.args]
    : [config.command];

  const result: OpencodeShapeOutput = {
    type: "local",
    command,
    enabled
  };
  if (config.env && Object.keys(config.env).length > 0) {
    result.env = config.env;
  }
  return result;
}

export function opencodeShape(entry: McpServerEntry): OpencodeShapeOutput {
  const enabled = entry.enabled !== false;

  if (entry.config.transport === "stdio") {
    return transformStdioServerOpencode(entry.config, enabled);
  }

  return {
    type: "local",
    command: [entry.config.url],
    enabled
  };
}

export function gooseShape(entry: McpServerEntry): GooseShapeOutput | undefined {
  const enabled = entry.enabled !== false;

  if (!enabled) {
    return undefined;
  }

  if (entry.config.transport === "stdio") {
    const result: GooseStdioShapeOutput = {
      type: "stdio",
      cmd: entry.config.command
    };

    if (entry.config.args && entry.config.args.length > 0) {
      result.args = entry.config.args;
    }

    if (entry.config.env && Object.keys(entry.config.env).length > 0) {
      result.envs = entry.config.env;
    }

    return result;
  }

  const result: GooseHttpShapeOutput = {
    type: "http",
    url: entry.config.url
  };

  if (entry.config.headers && Object.keys(entry.config.headers).length > 0) {
    result.headers = entry.config.headers;
  }

  return result;
}

const shapeTransformers: Record<ShapeName, ShapeTransformer> = {
  standard: standardShape,
  opencode: opencodeShape,
  goose: gooseShape
};

export function getShapeTransformer(shape: ShapeName): ShapeTransformer {
  return shapeTransformers[shape];
}
