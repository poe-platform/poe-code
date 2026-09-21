import type { AgentPlugin } from "./plugin-types.js";
import type { ToolRegistry } from "./tools.js";
type SkillDefinition =
  | string[]
  | {
      tools?: string[];
      tags?: string[];
    };
type SkillsPluginOptions = {
  definitions: Record<string, SkillDefinition>;
  skills?: string[] | (() => string[] | undefined);
  toolRegistry?: Pick<ToolRegistry, "getActiveTools">;
};
declare const skills: (options: SkillsPluginOptions) => AgentPlugin;
export default skills;
