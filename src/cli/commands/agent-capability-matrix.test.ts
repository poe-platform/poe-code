import { describe, it, expect } from "vitest";
import { listAgentsWithCapability } from "@poe-code/agent-defs";
import { listSpawnableAgents } from "@poe-code/agent-spawn";
import { supportedAgents as skillAgents } from "@poe-code/agent-skill-config";
import { supportedAgents as mcpAgents } from "@poe-code/agent-mcp-config";
import { getDefaultProviders } from "../../providers/index.js";

const providers = getDefaultProviders();

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

/**
 * The capability matrix in agent-defs is the single published source for which
 * agents each command accepts. These assertions fail if a registry gains or
 * loses an agent without the matrix being updated, so spawn/configure/install/
 * test/skill/mcp cannot drift apart.
 */
describe("agent capability matrix matches the real registries", () => {
  it("matches the spawn registry", () => {
    expect(sorted(listAgentsWithCapability("spawn"))).toEqual(
      sorted(listSpawnableAgents().map((agent) => agent.id))
    );
  });

  it("matches the provider registry for configure", () => {
    expect(sorted(listAgentsWithCapability("configure"))).toEqual(
      sorted(providers.map((provider) => provider.id))
    );
  });

  it("matches the providers implementing install", () => {
    expect(sorted(listAgentsWithCapability("install"))).toEqual(
      sorted(
        providers.filter((provider) => typeof provider.install === "function").map((p) => p.id)
      )
    );
  });

  it("matches the providers implementing test", () => {
    expect(sorted(listAgentsWithCapability("test"))).toEqual(
      sorted(providers.filter((provider) => typeof provider.test === "function").map((p) => p.id))
    );
  });

  it("matches the skill config registry", () => {
    expect(sorted(listAgentsWithCapability("skill"))).toEqual(sorted(skillAgents));
  });

  it("matches the mcp config registry", () => {
    expect(sorted(listAgentsWithCapability("mcp"))).toEqual(sorted(mcpAgents));
  });
});
