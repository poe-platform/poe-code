import type {CommandContext} from "safe-bash-contracts";
import type { LlmExecutableTool } from "./tool-execution.js";
import { validateJsonData } from "./json-data.js";

/** Display metadata supplied by the host that registers the callable. */
export interface LlmRegisteredTool extends LlmExecutableTool {
  readonly registryKey?: string;
  /** Index in the loader request’s toolNames, shared by expanded toolbox methods. */
  readonly selectionIndex?: number;
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
    for (const value of [tool.description, tool.plugin, tool.signature, tool.registryKey])
      if (value !== undefined && typeof value !== "string")
        throw new TypeError("Invalid LLM tool metadata");
    if (tool.implementation !== undefined && typeof tool.implementation !== "function")
      throw new TypeError("Invalid LLM tool implementation");
    if (tool.selectionIndex !== undefined && (!Number.isSafeInteger(tool.selectionIndex) || tool.selectionIndex < 0))
      throw new TypeError("Invalid LLM tool selection index");
    if (tool.prepare !== undefined && typeof tool.prepare !== "function")
      throw new TypeError("Invalid LLM tool preparation");
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

export interface LlmToolboxDescription {
  readonly name: string;
  readonly tools: readonly Pick<LlmRegisteredTool, "name" | "description" | "inputSchema" | "signature">[];
}

export interface LlmPluginQuery {readonly all: boolean; readonly hooks: readonly string[];}
export interface LlmPluginInfo {readonly name: string; readonly hooks: readonly string[]; readonly version?: string;}

/** An invocation-owned runtime for Python tools and plugin discovery. The caller owns
 * canonical storage, transport and admission; closing retires all callables. */
export type LlmToolLoader = (options: {
  readonly context: CommandContext;
  readonly definitions: readonly string[];
  readonly toolNames?: readonly string[];
  readonly discovery?: boolean;
  readonly pluginQuery?: LlmPluginQuery;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}) => Promise<{readonly tools: readonly LlmRegisteredTool[]; readonly toolboxes?: readonly LlmToolboxDescription[]; readonly plugins?: readonly LlmPluginInfo[]; close(): Promise<void>}>;
