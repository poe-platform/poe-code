import { describe, it, expect } from "vitest";
import {
  createServiceRegistry,
  type ProviderService
} from "./service-registry.js";
import { createProviderStub } from "../../tests/provider-stub.js";

function createAdapter(name: string, label: string): ProviderService {
  return createProviderStub({
    name,
    label
  });
}

describe("ServiceRegistry", () => {
  it("allows providers to self-register and be retrieved by name", () => {
    const registry = createServiceRegistry();
    const adapter = createAdapter("codex", "Codex");

    registry.register(adapter);

    expect(registry.get("codex")).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
  });

  it("resolves provider aliases to the canonical provider", () => {
    const registry = createServiceRegistry();
    const adapter = createProviderStub({
      name: "claude-code",
      label: "Claude Code",
      aliases: ["claude"]
    });

    registry.register(adapter);

    expect(registry.get("claude")).toBe(adapter);
    expect(registry.require("claude")).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
  });

  it("prevents alias registrations that collide with existing provider ids", () => {
    const registry = createServiceRegistry();
    registry.register(
      createProviderStub({ name: "claude-code", label: "Claude Code" })
    );

    expect(() =>
      registry.register(
        createProviderStub({
          name: "codex",
          label: "Codex",
          aliases: ["claude-code"]
        })
      )
    ).toThrowError(/already registered/i);
  });

  it("prevents duplicate provider registrations", () => {
    const registry = createServiceRegistry();
    const adapter = createAdapter("codex", "Codex");

    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrowError(
      /"codex" is already registered/i
    );
  });

  it("throws when trying to resolve an unknown provider", () => {
    const registry = createServiceRegistry();

    expect(() => registry.require("unknown"))
      .toThrowError(/unknown provider "unknown"/i);
  });
});
