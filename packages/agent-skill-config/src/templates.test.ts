import { describe, expect, it } from "bun:test";
import { createTemplateLoader } from "./templates.js";

describe("createTemplateLoader", () => {
  it("loads bundled templates by id", async () => {
    const loader = createTemplateLoader();
    const template = await loader("poe-generate.md");

    expect(template).toContain("# poe-code generate");
    expect(template).toContain("poe-code generate");
  });

  it("throws when template does not exist", async () => {
    const loader = createTemplateLoader();
    await expect(loader("nonexistent.md")).rejects.toThrow();
  });
});

