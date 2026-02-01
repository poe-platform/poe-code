import type { McpServerConfig, McpServerEntry } from "./types.js";

export type ShapeName = "standard" | "opencode";

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

export type ShapeOutput = StandardShapeOutput | OpencodeShapeOutput;

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

const shapeTransformers: Record<ShapeName, ShapeTransformer> = {
  standard: standardShape,
  opencode: opencodeShape
};

export function getShapeTransformer(shape: ShapeName): ShapeTransformer {
  return shapeTransformers[shape];
}
