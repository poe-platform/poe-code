import { describe, it, expect } from "vitest";
import { deriveWrapBinaryAliases } from "./binary-aliases.js";
import type { ProviderService } from "./service-registry.js";

function provider(
  name: string,
  agentBinary?: string
): ProviderService {
  return {
    id: name,
    summary: name,
    name,
    label: name,
    isolatedEnv: agentBinary
      ? { agentBinary, configProbe: { kind: "isolatedDir" }, env: {} }
      : undefined,
    async configure() {},
    async remove() {
      return false;
    }
  };
}

describe("deriveWrapBinaryAliases", () => {
  it("derives poe-<agentBinary> for isolated providers", () => {
    const aliases = deriveWrapBinaryAliases([
      provider("claude-code", "claude"),
      provider("codex", "codex"),
      provider("opencode", "opencode"),
      provider("kimi")
    ]);

    expect(aliases).toEqual([
      { binName: "poe-claude", serviceName: "claude-code", agentBinary: "claude" },
      { binName: "poe-codex", serviceName: "codex", agentBinary: "codex" },
      { binName: "poe-opencode", serviceName: "opencode", agentBinary: "opencode" }
    ]);
  });

  it("rejects duplicate derived names", () => {
    expect(() =>
      deriveWrapBinaryAliases([
        provider("a", "codex"),
        provider("b", "codex")
      ])
    ).toThrow(/Duplicate wrapper binary name/);
  });
});

