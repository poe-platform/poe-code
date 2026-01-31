import { describe, it, expect } from "vitest";
import type { ProviderService } from "./service-registry.js";
import {
  collectSpawnLabels,
  normalizeColor,
  renderLabelDocument
} from "../tools/label-generator.js";
import { createProviderStub } from "../../tests/provider-stub.js";

describe("label generator", () => {
  it("collects spawn labels and normalizes colors", () => {
    const providers: ProviderService[] = [
      createProviderStub({
        name: "alpha",
        label: "Alpha",
        spawn: async () => undefined,
        branding: { colors: { light: "#abc123" } }
      }),
      createProviderStub({
        name: "beta",
        label: "Beta",
        branding: { colors: { light: "#ffffff" } }
      })
    ];

    const labels = collectSpawnLabels(providers);
    expect(labels).toEqual([
      {
        service: "alpha",
        displayName: "Alpha",
        label: "agent:alpha",
        color: "ABC123",
        description: "Alpha automation label"
      }
    ]);
  });

  it("renders markdown document with workflow JSON", () => {
    const markdown = renderLabelDocument([
      {
        service: "alpha",
        displayName: "Alpha",
        label: "agent:alpha",
        color: "ABC123",
        description: "Alpha automation label"
      }
    ]);
    expect(markdown).toContain("agent:alpha");
    expect(markdown).toContain('"color": "ABC123"');
    expect(markdown).toContain("| Alpha | `agent:alpha` | `#ABC123` |");
  });

  it("normalizes invalid color inputs", () => {
    expect(normalizeColor("")).toBe("000000");
    expect(normalizeColor("#12")).toBe("120000");
    expect(normalizeColor("g!#hijk")).toBe("000000");
  });
});
