import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const README_PATH = path.resolve(import.meta.dirname, "..", "README.md");

describe("toolcraft docs", () => {
  it("does not advertise the previous package names", () => {
    const readme = fs.readFileSync(README_PATH, "utf8");

    expect(readme).not.toContain("poe-code/agent-kit");
    expect(readme).not.toContain('"agent-kit"');
    expect(readme).not.toContain('"agent-kit-schema"');
  });

  it("documents the generated CLI output control", () => {
    const readme = fs.readFileSync(README_PATH, "utf8");

    expect(readme).not.toContain("`--json` switches to `json`");
    expect(readme).toContain("controls: { output: true }");
    expect(readme).toContain("--output json");
  });
});
