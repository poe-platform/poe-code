import assert from "node:assert/strict";
import { it } from "vitest";
import * as own from "@poe-code/agent-defs-rust";

it("Native agent catalog subpath matches reference exports and own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/agent-defs"),
    import("toolcraft/agent-defs")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], own[name], name);
  const catalog = (api) =>
    api.allAgents.map((agent) => ({
      ...agent,
      otelCapture: agent.otelCapture && {
        ...agent.otelCapture,
        args: agent.otelCapture.args?.('https://example.test/雪?q="quoted"', true)
      }
    }));
  assert.deepEqual(catalog(native), catalog(reference));
  assert.equal(Object.isFrozen(native.allAgents), Object.isFrozen(reference.allAgents));
});

it("Native catalog subpath preserves aliases, capability lists and model specifiers", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/agent-defs"),
    import("toolcraft/agent-defs")
  ]);
  for (const agent of reference.allAgents) {
    for (const name of [agent.id, ...(agent.aliases ?? [])]) {
      const input = ` ${name.toUpperCase()}:Provider/Model `;
      assert.equal(native.normalizeAgentId(input), reference.normalizeAgentId(input));
      assert.deepEqual(native.parseAgentSpecifier(input), reference.parseAgentSpecifier(input));
      for (const capability of ["spawn", "configure", "install", "test", "skill", "mcp"]) {
        assert.equal(
          native.agentSupportsCapability(name, capability),
          reference.agentSupportsCapability(name, capability)
        );
      }
    }
  }
  for (const capability of ["spawn", "configure", "install", "test", "skill", "mcp"]) {
    assert.deepEqual(
      native.listAgentsWithCapability(capability, { includeAliases: true }),
      reference.listAgentsWithCapability(capability, { includeAliases: true })
    );
    const first = native.listAgentsWithCapability(capability);
    first.push("caller-owned");
    assert.deepEqual(
      native.listAgentsWithCapability(capability),
      reference.listAgentsWithCapability(capability)
    );
    assert.equal(
      native.formatAgentCapabilityError({ agent: "unknown-agent", capability }),
      reference.formatAgentCapabilityError({ agent: "unknown-agent", capability })
    );
  }
});
