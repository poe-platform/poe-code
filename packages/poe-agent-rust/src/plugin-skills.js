import { native } from "./native.js";
const skills = (options) => {
  const definitions = normalizeDefinitions(options.definitions);
  return {
    name: "skills",
    prompt(ctx) {
      const activeSkills = normalizeStringList(
        typeof options.skills === "function" ? options.skills() : options.skills
      );
      const activeTools =
        options.toolRegistry?.getActiveTools(activeSkills).map((tool) => tool.name) ?? [];
      const nativeGuidance = definitions.guidance(activeSkills, () =>
        activeTools.length > 0 ? activeTools.join(", ") : null
      );
      const guidance = nativeGuidance === null ? undefined : nativeGuidance;
      return {
        ...ctx,
        ...(guidance === undefined
          ? {}
          : {
              system: [ctx.system, guidance].filter(Boolean).join("\n\n")
            }),
        metadata: {
          ...ctx.metadata,
          skills: {
            active: activeSkills,
            tools: activeTools
          }
        }
      };
    }
  };
};
function normalizeDefinitions(definitions) {
  const normalized = new native.NativeAgentSkillCatalog();
  for (const [rawName, rawDefinition] of Object.entries(definitions)) {
    const name = rawName.trim();
    if (name.length === 0 || normalized.contains(name)) {
      continue;
    }
    const tools = normalizeStringList(
      Array.isArray(rawDefinition) ? rawDefinition : rawDefinition.tools
    );
    const tags = normalizeStringList(Array.isArray(rawDefinition) ? [] : rawDefinition.tags);
    normalized.insert(name, tools, tags);
  }
  return normalized;
}
function normalizeStringList(values) {
  const seen = new native.NativeAgentStringSet();
  const normalized = [];
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (!seen.admit(trimmed)) {
      continue;
    }

    normalized.push(trimmed);
  }
  return normalized;
}
export default skills;
