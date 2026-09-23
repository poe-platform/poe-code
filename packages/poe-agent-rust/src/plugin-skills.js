import { discoverSkillsAsync } from "@poe-code/agent-skill-config";
import { native } from "./native.js";
const skills = (options = {}) => {
  const definitions = normalizeDefinitions(options.definitions ?? {});
  return {
    name: "skills",
    async prompt(ctx, runtime) {
      const activeSkills = normalizeStringList(
        typeof options.skills === "function" ? options.skills() : options.skills
      );
      const activeTools =
        options.toolRegistry?.getActiveTools(activeSkills).map((tool) => tool.name) ?? [];
      const nativeGuidance = definitions.guidance(activeSkills, () =>
        activeTools.length > 0 ? activeTools.join(", ") : null
      );
      const guidance = nativeGuidance === null ? undefined : nativeGuidance;
      const catalog = options.directories?.length
        ? await discoverSkillsAsync(options.directories, requireRuntime(runtime))
        : [];
      const catalogGuidance = catalog.length === 0 ? undefined : [
        "Available file skills:",
        ...catalog.map(skill => `- ${skill.name}: ${skill.file}`),
        "Read the full SKILL.md through the configured filesystem before using a skill."
      ].join("\n");
      const system = [ctx.system, guidance, catalogGuidance].filter(Boolean).join("\n\n");
      return {
        ...ctx,
        ...(guidance === undefined && catalogGuidance === undefined
          ? {}
          : {
              system
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
function requireRuntime(runtime) {
  if (!runtime) throw new Error("File skills require an agent runtime filesystem.");
  return { fs: runtime.fs, cwd: runtime.cwd, homeDir: runtime.homeDir,
    signal: runtime.signal, nativePaths: !runtime.customFs };
}

export default skills;
