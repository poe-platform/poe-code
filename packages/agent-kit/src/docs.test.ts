import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const README_PATH = path.resolve(import.meta.dirname, "..", "README.md");

describe("agent-kit docs", () => {
  it("does not advertise removed poe-code compatibility subpaths", () => {
    const readme = fs.readFileSync(README_PATH, "utf8");

    expect(readme).not.toContain("poe-code/agent-kit");
  });
});
