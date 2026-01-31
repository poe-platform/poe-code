import { describe, it, expect } from "vitest";
import { renderServiceMenu } from "./service-menu.js";
import type { MenuTheme } from "./theme.js";
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

const theme: MenuTheme = {
  name: "dark",
  palette: {
    header: (text) => `H:${text}`,
    divider: (text) => `D:${text}`,
    prompt: (text) => `P:${text}`,
    number: (value) => `N${value}`,
    providerFallback: (label) => label
  }
};

describe("renderServiceMenu", () => {
  it("renders using the provided theme", () => {
    const services = [
      createAdapter("claude-code", "Claude Code"),
      createAdapter("codex", "Codex", {
        colors: { dark: "#5bc0ff", light: "#0053a6" }
      })
    ];

    const lines = renderServiceMenu(services, { theme });

    expect(lines[0]).toContain("D:");
    expect(lines[1]).toContain("H:");
    expect(lines[2]).toContain("D:");
    expect(lines[3]).toBe("P:Pick an agent to configure:");
    expect(lines[4]).toBe("N1 Claude Code");
    expect(lines[4]).not.toContain("\u001b[");
    expect(lines[5]).toContain("\u001b[");
    expect(lines[5]).toContain("Codex");
  });
});
