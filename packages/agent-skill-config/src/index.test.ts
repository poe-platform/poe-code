import { describe, it, expect } from "bun:test";
import * as agentSkillConfig from "@poe-code/agent-skill-config";

describe('@poe-code/agent-skill-config', () => {
  it("exports configure SDK surface", () => {
    expect(agentSkillConfig.supportedAgents.length).toBeGreaterThan(0);
    expect(typeof agentSkillConfig.resolveAgentSupport).toBe("function");
    expect(typeof agentSkillConfig.getAgentConfig).toBe("function");
    expect(typeof agentSkillConfig.resolveSkillDir).toBe("function");
    expect(typeof agentSkillConfig.configure).toBe("function");
    expect(typeof agentSkillConfig.unconfigure).toBe("function");
    expect(typeof agentSkillConfig.UnsupportedAgentError).toBe("function");
  });
});
