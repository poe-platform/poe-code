import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("memory package docs", () => {
  it("README documents the shipped CLI, config knobs, layout, confidence tags, MCP, and install flow", () => {
    const readme = readFileSync(resolve(import.meta.dirname, "..", "README.md"), "utf8");

    expect(readme).toContain("# @poe-code/memory");
    expect(readme).toContain("## CLI");
    expect(readme).toContain("poe-code memory install");
    expect(readme).not.toContain("memory lint [--fix]");
    expect(readme).toContain("memory.ingestAgent");
    expect(readme).toContain(".poe-code/memory/");
    expect(readme).toContain("<!-- memory:extracted");
    expect(readme).toContain("poe-code-memory");
    expect(readme).toContain("## Install walkthrough");
  });

  it("QA checklist exists and covers the manual verification flow", () => {
    const qa = readFileSync(resolve(import.meta.dirname, "..", "QA.md"), "utf8");

    expect(qa).toContain("# Memory QA");
    expect(qa).toContain("poe-code memory init");
    expect(qa).toContain("poe-code memory ingest <a local markdown file>");
    expect(qa).toContain("poe-code memory lint");
    expect(qa).toContain("poe-code memory install --agent claude-code");
    expect(qa).toContain("poe-code memory query \"<something answerable from memory>\"");
    expect(qa).toContain("poe-code memory clear --yes");
  });

  it("skill template does not advertise unimplemented lint repair", () => {
    const template = readFileSync(
      resolve(import.meta.dirname, "templates", "SKILL_memory.md"),
      "utf8"
    );

    expect(template).toContain("`lint`");
    expect(template).not.toContain("`lint [--fix]`");
  });
});
