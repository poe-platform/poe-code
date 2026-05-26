# Agent defs mutable exported list splits enumeration from id resolution

## Summary

The exported `@poe-code/agent-defs` registry exposes its canonical `allAgents` array as mutable state, while `resolveAgentId()` uses a lookup map populated only once at module initialization. Appending an agent through the public array makes the package enumerate that agent but leaves its id and aliases unresolvable through the package's paired resolution API.

## Reproduction

Create the disposable probe `packages/agent-defs/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allAgents, resolveAgentId } from "./registry.js";

describe("mutable canonical agent registry", () => {
  it("lists an appended agent whose id resolver cannot find it", () => {
    allAgents.push({
      id: "late-agent",
      name: "late-agent",
      label: "Late Agent",
      summary: "Added after registry initialization.",
      binaryName: "late-agent",
      configPath: "~/.late-agent/config.json",
      branding: { colors: { dark: "#000000", light: "#ffffff" } }
    });

    const listed = allAgents.map((agent) => agent.id).includes("late-agent");
    const resolved = resolveAgentId("late-agent");
    console.log(JSON.stringify({ listed, resolved }));
    expect(listed).toBe(true);
    expect(resolved).toBeUndefined();
  });
});
```

Run the targeted test, then delete the probe:

```sh
npm exec -- vitest run packages/agent-defs/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-defs/src/__probe__.test.ts
```

The probe passes and prints that the appended agent is visible in enumeration while `resolved` is omitted because it is `undefined`:

```text
{"listed":true}
✓ packages/agent-defs/src/__probe__.test.ts > mutable canonical agent registry > lists an appended agent whose id resolver cannot find it
```

## Observed Behavior

`allAgents` is exported as a mutable `AgentDefinition[]` at `packages/agent-defs/src/registry.ts:12`. The module fills the separate `lookup` map by iterating the initial array once at `packages/agent-defs/src/registry.ts:23`, and `resolveAgentId()` consults only that map at `packages/agent-defs/src/registry.ts:35`. An SDK caller can therefore append a valid agent definition to the exported canonical list and immediately observe it there, but `resolveAgentId("late-agent")` still returns `undefined`.

## Expected Behavior

The canonical agent registry should provide one coherent public view. Either `allAgents` must be immutable/read-only at runtime, or mutations must update the resolver index so every exported agent can be resolved by its declared id and aliases.

## Impact

Callers that compose or extend the exported agent list can display an available agent, offer it in selection or compatibility flows, and then fail later when normalization or configuration resolves the selected id as unknown. Runtime mutation can also introduce unresolved aliases or duplicate identifiers without passing the registry's initial consistency checks.
