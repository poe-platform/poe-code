import { native } from "./native.js";
import { assertValidToolName } from "./tool-names.js";
import { DuplicateToolError } from "./errors.js";
export function normalizeTool(tool) {
  assertValidToolName(tool.name);
  const name = native.agentTrim(tool.name),
    call = tool.call.bind(tool);
  return {
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    visibility: tool.visibility ?? "model",
    policy: tool.policy,
    invoke(args, ctx) {
      try {
        const result = call(args, ctx);
        if (
          typeof result === "object" &&
          result !== null &&
          typeof result.next === "function" &&
          typeof result.return === "function" &&
          typeof result.throw === "function" &&
          typeof result[Symbol.asyncIterator] === "function"
        )
          return result;
        // A terminal-only invocation adapts promises/errors without emitting tool events.
        // eslint-disable-next-line require-yield
        return (async function* () {
          return await result;
        })();
      } catch (error) {
        // A terminal-only invocation adapts promises/errors without emitting tool events.
        // eslint-disable-next-line require-yield
        return (async function* () {
          throw error;
        })();
      }
    }
  };
}
export class ToolRegistry {
  #catalog = new native.NativeAgentToolCatalog();
  #values = [];
  register(tool) {
    const normalized = Object.freeze(normalizeTool(tool));
    if (this.#catalog.get(normalized.name) != null) throw new DuplicateToolError(normalized.name);
    this.#values[this.#catalog.upsert(normalized.name)] = normalized;
  }
  get(name) {
    const index = this.#catalog.get(name);
    return index == null ? undefined : this.#values[index];
  }
  getAll() {
    return this.#values.slice();
  }
  getActiveTools(activeSkills) {
    const skills = [];
    for (const skill of activeSkills ?? []) skills.push(skill.trim());
    return this.#catalog
      .active(
        this.#values.map((tool) => (typeof tool.visibility === "string" ? tool.visibility : "")),
        skills
      )
      .map((index) => this.#values[index]);
  }
  copyFrom(registry) {
    for (const tool of registry.#values) this.#values[this.#catalog.upsert(tool.name)] = tool;
  }
}
