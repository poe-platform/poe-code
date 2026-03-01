import { describe, it, expect } from "vitest";
import { collectChecks } from "./collect-checks.js";
import type { ProviderService } from "../../cli/service-registry.js";

function createProvider(
  overrides: Partial<ProviderService> = {}
): ProviderService {
  return {
    id: "test",
    name: "test",
    label: "Test",
    summary: "Test provider",
    configure: async () => {},
    unconfigure: async () => false,
    ...overrides
  };
}

describe("collectChecks", () => {
  it("includes system and auth checks for empty registry", () => {
    const checks = collectChecks([], {});
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("system.home-dir");
    expect(ids).toContain("system.config-valid");
    expect(ids).toContain("auth.api-key-present");
    expect(ids).toContain("auth.api-key-valid");
  });

  it("adds binary check when provider has isolatedEnv with agentBinary", () => {
    const provider = createProvider({
      name: "codex",
      isolatedEnv: {
        agentBinary: "codex",
        configProbe: { kind: "isolatedFile", relativePath: "config.toml" },
        env: {}
      }
    });
    const checks = collectChecks([provider], { codex: { files: [] } });
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("agent.codex.binary");
  });

  it("adds config-probe check when provider has configProbe and requiresConfig not false", () => {
    const provider = createProvider({
      name: "codex",
      isolatedEnv: {
        agentBinary: "codex",
        configProbe: { kind: "isolatedFile", relativePath: "config.toml" },
        env: {}
      }
    });
    const checks = collectChecks([provider], { codex: { files: [] } });
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("agent.codex.config-probe");
  });

  it("skips config-probe when requiresConfig is false", () => {
    const provider = createProvider({
      name: "claude-code",
      isolatedEnv: {
        agentBinary: "claude",
        requiresConfig: false,
        env: {}
      }
    });
    const checks = collectChecks([provider], { "claude-code": { files: [] } });
    const ids = checks.map((c) => c.id);
    expect(ids).not.toContain("agent.claude-code.config-probe");
  });

  it("adds model check when provider has configurePrompts.model", () => {
    const provider = createProvider({
      name: "codex",
      configurePrompts: {
        model: { label: "Model", defaultValue: "m1", choices: [] }
      },
      isolatedEnv: {
        agentBinary: "codex",
        env: {}
      }
    });
    const checks = collectChecks([provider], { codex: { files: [] } });
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("agent.codex.model");
  });

  it("skips unconfigured providers", () => {
    const provider = createProvider({
      name: "codex",
      isolatedEnv: {
        agentBinary: "codex",
        configProbe: { kind: "isolatedFile", relativePath: "config.toml" },
        env: {}
      }
    });
    const checks = collectChecks([provider], {});
    const ids = checks.map((c) => c.id);
    expect(ids).not.toContain("agent.codex.binary");
  });

  it("skips disabled providers", () => {
    const provider = createProvider({
      name: "codex",
      disabled: true,
      isolatedEnv: {
        agentBinary: "codex",
        env: {}
      }
    });
    const checks = collectChecks([provider], { codex: { files: [] } });
    const ids = checks.map((c) => c.id);
    expect(ids).not.toContain("agent.codex.binary");
  });

  it("does not generate agent checks for poe-agent (no isolatedEnv)", () => {
    const provider = createProvider({
      name: "poe-agent"
    });
    const checks = collectChecks([provider], { "poe-agent": { files: [] } });
    const ids = checks.map((c) => c.id);
    const agentChecks = ids.filter((id) => id.startsWith("agent."));
    expect(agentChecks).toHaveLength(0);
  });

  it("filters to a single agent when agentFilter is provided", () => {
    const codex = createProvider({
      name: "codex",
      isolatedEnv: { agentBinary: "codex", env: {} }
    });
    const claude = createProvider({
      name: "claude-code",
      isolatedEnv: { agentBinary: "claude", requiresConfig: false, env: {} }
    });
    const configured = {
      codex: { files: [] },
      "claude-code": { files: [] }
    };
    const checks = collectChecks([codex, claude], configured, "codex");
    const agentIds = checks
      .filter((c) => c.id.startsWith("agent."))
      .map((c) => c.id);
    expect(agentIds.every((id) => id.startsWith("agent.codex"))).toBe(true);
    // System/auth checks still included
    expect(checks.some((c) => c.id === "system.home-dir")).toBe(true);
  });
});
