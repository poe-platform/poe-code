import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("SKILL_memory template", () => {
  it("exists and documents CLI and MCP surfaces tersely", () => {
    const template = readFileSync(resolve(import.meta.dirname, "templates", "SKILL_memory.md"), "utf8");

    expect(template).toContain("## CLI — `poe-code memory <subcommand>`");
    expect(template).toMatch(/\| `query "<question>"`\s+\| answer a question from memory only, with citations\s+\|/);
    expect(template).toMatch(/\| `list_pages`\s+\| enumerate pages \(preferred over shelling out to `memory ls`\)\s+\|/);
    expect(template).toContain("Never call `memory clear` without explicit user request");
  });
});
