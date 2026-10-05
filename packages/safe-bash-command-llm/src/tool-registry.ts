import type { LlmExecutableTool } from "./tool-execution.js";
import { validateJsonData } from "./json-data.js";

/** Display metadata supplied by the host that registers the callable. */
export interface LlmRegisteredTool extends LlmExecutableTool {
  readonly plugin?: string;
  readonly signature?: string;
}

/** Registry keys gain collision suffixes; callable names remain unchanged. */
export function createLlmToolRegistry(
  tools: Iterable<LlmRegisteredTool>
): ReadonlyMap<string, LlmRegisteredTool> {
  const registry = new Map<string, LlmRegisteredTool>();
  for (const tool of tools) {
    if (
      !tool ||
      typeof tool.name !== "string" ||
      !tool.name ||
      !tool.inputSchema ||
      Array.isArray(tool.inputSchema) ||
      typeof tool.inputSchema !== "object"
    )
      throw new TypeError("Invalid LLM tool definition");
    for (const value of [tool.description, tool.plugin, tool.signature])
      if (value !== undefined && typeof value !== "string")
        throw new TypeError("Invalid LLM tool metadata");
    if (tool.implementation !== undefined && typeof tool.implementation !== "function")
      throw new TypeError("Invalid LLM tool implementation");
    if (tool.async !== undefined && typeof tool.async !== "boolean")
      throw new TypeError("Invalid LLM tool async declaration");
    validateJsonData(tool.inputSchema, "Tool schema must be finite JSON data");
    let name = tool.name,
      suffix = 0;
    while (registry.has(name)) name = `${tool.name}_${++suffix}`;
    registry.set(name, tool);
  }
  return registry;
}

/** Resolve the whole selection before any callable executes. */
export function selectLlmTools(
  registry: ReadonlyMap<string, LlmRegisteredTool>,
  names: readonly string[]
): readonly LlmRegisteredTool[] {
  const missing = names.filter((name) => !registry.has(name));
  if (missing.length)
    throw new Error(
      `Tool(s) ${missing.join(", ")} not found. Available tools: ${[...registry.keys()].join(", ")}`
    );
  return names.map((name) => registry.get(name)!);
}
