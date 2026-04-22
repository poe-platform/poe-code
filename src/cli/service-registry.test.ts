import { describe, it, expect } from "vitest";
import { createServiceRegistry } from "./service-registry.js";
import type { ProviderService } from "./service-registry.js";

function makeAdapter(name: string, aliases?: string[]): ProviderService {
  return {
    id: name,
    name,
    label: name,
    aliases,
    summary: `${name} service`,
    configure: async () => {},
    unconfigure: async () => false
  };
}

describe("createServiceRegistry", () => {
  it("registers an adapter and retrieves it by name", () => {
    const registry = createServiceRegistry();
    const adapter = makeAdapter("codex");
    registry.register(adapter);
    expect(registry.get("codex")).toBe(adapter);
  });

  it("resolves adapter by alias", () => {
    const registry = createServiceRegistry();
    const adapter = makeAdapter("claude-code", ["claude"]);
    registry.register(adapter);
    expect(registry.get("claude")).toBe(adapter);
  });

  it("throws when registering a duplicate name", () => {
    const registry = createServiceRegistry();
    registry.register(makeAdapter("codex"));
    expect(() => registry.register(makeAdapter("codex"))).toThrow('already registered');
  });

  it("returns undefined for unknown adapter", () => {
    const registry = createServiceRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("require throws for unknown adapter", () => {
    const registry = createServiceRegistry();
    expect(() => registry.require("unknown")).toThrow('Unknown provider "unknown"');
  });

  it("lists all registered adapters", () => {
    const registry = createServiceRegistry();
    registry.register(makeAdapter("codex"));
    registry.register(makeAdapter("claude-code"));
    const names = registry.list().map((a) => a.name);
    expect(names).toContain("codex");
    expect(names).toContain("claude-code");
  });

  it("discover skips already-registered adapters", () => {
    const registry = createServiceRegistry();
    const original = makeAdapter("codex");
    registry.register(original);
    registry.discover([makeAdapter("codex"), makeAdapter("opencode")]);
    expect(registry.get("codex")).toBe(original);
    expect(registry.get("opencode")).toBeDefined();
  });

  it("invoke resolves service and calls the runner", async () => {
    const registry = createServiceRegistry();
    const adapter = makeAdapter("codex");
    registry.register(adapter);
    const result = await registry.invoke("codex", "configure", async (entry) => entry.name);
    expect(result).toBe("codex");
  });

  it("invoke throws for unknown service", async () => {
    const registry = createServiceRegistry();
    await expect(
      registry.invoke("unknown", "configure", async () => {})
    ).rejects.toThrow('Unknown provider "unknown"');
  });
});
