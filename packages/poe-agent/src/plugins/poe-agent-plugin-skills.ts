import { discoverSkillsAsync } from "@poe-code/agent-skill-config";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import type { ToolRegistry } from "../runtime/tools.js";

type SkillDefinition =
  | string[]
  | {
      tools?: string[];
      tags?: string[];
    };

export type SkillsPluginOptions = {
  definitions?: Record<string, SkillDefinition>;
  directories?: string[];
  skills?: string[] | (() => string[] | undefined);
  toolRegistry?: Pick<ToolRegistry, "getActiveTools">;
};

type NormalizedSkillDefinition = {
  name: string;
  tools: string[];
  tags: string[];
};

const skills = (options: SkillsPluginOptions = {}): AgentPlugin => {
  const definitions = normalizeDefinitions(options.definitions ?? {});

  return {
    name: "skills",
    async prompt(ctx, runtime) {
      const activeSkills = normalizeStringList(
        typeof options.skills === "function" ? options.skills() : options.skills,
      );
      const activeDefinitions = activeSkills
        .map(skillName => definitions.get(skillName))
        .filter((definition): definition is NormalizedSkillDefinition => definition !== undefined);
      const activeTools =
        options.toolRegistry?.getActiveTools(activeSkills).map(tool => tool.name) ?? [];

      const guidance = buildSkillGuidance(activeDefinitions, activeTools);

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
              system,
            }),
        metadata: {
          ...ctx.metadata,
          skills: {
            active: activeSkills,
            tools: activeTools,
          },
        },
      };
    },
  };
};

function buildSkillGuidance(
  activeDefinitions: NormalizedSkillDefinition[],
  activeTools: string[],
): string | undefined {
  if (activeDefinitions.length === 0) {
    return undefined;
  }

  const lines = [
    `Active skills: ${activeDefinitions.map(definition => definition.name).join(", ")}`,
    ...activeDefinitions.flatMap(definition => {
      const details: string[] = [];

      if (definition.tools.length > 0) {
        details.push(`tools: ${definition.tools.join(", ")}`);
      }

      if (definition.tags.length > 0) {
        details.push(`tags: ${definition.tags.join(", ")}`);
      }

      if (details.length === 0) {
        return [];
      }

      return [`- ${definition.name}: ${details.join(" | ")}`];
    }),
    ...(activeTools.length > 0 ? [`Available skill tools for this run: ${activeTools.join(", ")}`] : []),
    "Use active-skill tools when they directly help with the current task.",
  ];

  return lines.join("\n");
}

function normalizeDefinitions(
  definitions: NonNullable<SkillsPluginOptions["definitions"]>,
): Map<string, NormalizedSkillDefinition> {
  const normalized = new Map<string, NormalizedSkillDefinition>();

  for (const [rawName, rawDefinition] of Object.entries(definitions)) {
    const name = rawName.trim();
    if (name.length === 0 || normalized.has(name)) {
      continue;
    }

    const tools = normalizeStringList(
      Array.isArray(rawDefinition) ? rawDefinition : rawDefinition.tools,
    );
    const tags = normalizeStringList(Array.isArray(rawDefinition) ? [] : rawDefinition.tags);

    normalized.set(name, {
      name,
      tools,
      tags,
    });
  }

  return normalized;
}

function normalizeStringList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function requireRuntime(runtime: import("../runtime/filesystem.js").AgentRuntime | undefined) {
  if (!runtime) throw new Error("File skills require an agent runtime filesystem.");
  return { fs: runtime.fs, cwd: runtime.cwd, homeDir: runtime.homeDir,
    signal: runtime.signal, nativePaths: !runtime.customFs };
}

export default skills;
