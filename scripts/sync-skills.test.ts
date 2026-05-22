import { describe, expect, it } from "vitest";
import { allAgents } from "../packages/agent-defs/src/index.js";
import { agentTemplateSets } from "./sync-skills.js";

describe("sync-skills agent templates", () => {
  it("declares templates or an explicit empty entry for every agent definition", () => {
    for (const agent of allAgents) {
      expect(agentTemplateSets).toHaveProperty(agent.id);
      expect(Array.isArray(agentTemplateSets[agent.id])).toBe(true);
    }
  });

  it("declares the Gemini CLI template set", () => {
    expect(agentTemplateSets["gemini-cli"]).toEqual([
      "src/templates/gemini-cli/SKILL_poe-code-plan.md",
      "src/templates/gemini-cli/SKILL_poe-code-pipeline-plan.md",
      "src/templates/gemini-cli/SKILL_stop-slop.md"
    ]);
  });

});
