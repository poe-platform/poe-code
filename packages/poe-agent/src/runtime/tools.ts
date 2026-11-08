import { DuplicateToolError } from "./errors.js";
import type { NormalizedTool, Tool, ToolEvent, ToolResult } from "./types.js";
import { assertValidToolName } from "./tool-names.js";

function normalizeName(name: string): string {
  return name.trim();
}

function isAsyncGeneratorResult(
  value: unknown
): value is AsyncGenerator<ToolEvent, ToolResult, void> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AsyncGenerator<ToolEvent, ToolResult, void>>;
  return (
    typeof candidate.next === "function" &&
    typeof candidate.return === "function" &&
    typeof candidate.throw === "function" &&
    typeof candidate[Symbol.asyncIterator] === "function"
  );
}

function createNonStreamingInvocation(
  result: ToolResult | Promise<ToolResult>
): AsyncGenerator<ToolEvent, ToolResult, void> {
  return (async function* (): AsyncGenerator<ToolEvent, ToolResult, void> {
    yield* [];
    return await result;
  })();
}

function createFailingInvocation(error: unknown): AsyncGenerator<ToolEvent, ToolResult, void> {
  return (async function* (): AsyncGenerator<ToolEvent, ToolResult, void> {
    yield* [];
    throw error;
  })();
}

function normalizeActiveSkills(activeSkills?: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const skillName of activeSkills ?? []) {
    const name = normalizeName(skillName);
    if (name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    normalized.push(name);
  }

  return normalized;
}

function skillMatchesToolName(skillName: string, toolName: string): boolean {
  if (skillName === toolName) {
    return true;
  }

  if (skillName.endsWith(".*")) {
    const namespace = skillName.slice(0, -2).trim();
    return namespace.length > 0 && toolNameHasNamespace(toolName, namespace);
  }

  return toolNameHasNamespace(toolName, skillName);
}

function toolNameHasNamespace(toolName: string, namespace: string): boolean {
  return toolName.startsWith(`${namespace}.`) || toolName.startsWith(`${namespace}_`);
}

function isToolVisibleToModel(tool: NormalizedTool, activeSkills: string[]): boolean {
  if (tool.visibility === "model") {
    return true;
  }

  if (tool.visibility === "internal") {
    return false;
  }

  for (const activeSkill of activeSkills) {
    if (skillMatchesToolName(activeSkill, tool.name)) {
      return true;
    }
  }

  return false;
}

export function normalizeTool(tool: Tool): NormalizedTool {
  assertValidToolName(tool.name);
  const normalizedName = normalizeName(tool.name);
  const call = tool.call.bind(tool);

  return {
    name: normalizedName,
    description: tool.description,
    inputSchema: tool.inputSchema,
    visibility: tool.visibility ?? "model",
    policy: tool.policy,
    invoke(args, ctx) {
      try {
        const result = call(args, ctx);
        if (isAsyncGeneratorResult(result)) {
          return result;
        }

        return createNonStreamingInvocation(result);
      } catch (error) {
        return createFailingInvocation(error);
      }
    }
  };
}

export class ToolRegistry {
  readonly #tools = new Map<string, NormalizedTool>();

  register(tool: Tool): void {
    const normalizedTool = Object.freeze(normalizeTool(tool));
    if (this.#tools.has(normalizedTool.name)) {
      throw new DuplicateToolError(normalizedTool.name);
    }

    this.#tools.set(normalizedTool.name, normalizedTool);
  }

  get(name: string): NormalizedTool | undefined {
    return this.#tools.get(normalizeName(name));
  }

  getAll(): NormalizedTool[] {
    return Array.from(this.#tools.values());
  }

  getActiveTools(activeSkills?: string[]): NormalizedTool[] {
    const normalizedActiveSkills = normalizeActiveSkills(activeSkills);
    return this.getAll().filter((tool) => isToolVisibleToModel(tool, normalizedActiveSkills));
  }

  copyFrom(registry: ToolRegistry): void {
    for (const tool of registry.#tools.values()) {
      this.#tools.set(tool.name, tool);
    }
  }
}
