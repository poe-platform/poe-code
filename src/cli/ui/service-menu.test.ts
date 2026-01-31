import { describe, it, expect } from "vitest";
import { renderServiceMenu } from "./service-menu.js";
import type { ProviderService } from "../service-registry.js";
import { createProviderStub } from "../../../tests/provider-stub.js";

function createAdapter(
  name: string,
  label: string,
  branding?: ProviderService["branding"]
): ProviderService {
  return createProviderStub({
    name,
    label,
    branding
  });
}

describe("renderServiceMenu", () => {
  it("renders service menu with themed styling", () => {
    const services = [
      createAdapter("claude-code", "Claude Code"),
      createAdapter("codex", "Codex", {
        colors: { dark: "#5bc0ff", light: "#0053a6" }
      })
    ];

    const lines = renderServiceMenu(services, { themeName: "dark" });

    expect(lines.length).toBeGreaterThan(4);
    expect(lines[3]).toContain("Pick an agent to configure:");
    expect(lines[4]).toContain("Claude Code");
    expect(lines[5]).toContain("Codex");
  });
});
