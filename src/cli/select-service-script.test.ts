import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const scriptPath = "../../scripts/workflows/select-service.cjs";

describe("select service workflow script", () => {
  let originalAppend: typeof fs.appendFileSync;
  let writes: string[];

  beforeEach(() => {
    vi.resetModules();
    writes = [];
    originalAppend = fs.appendFileSync;
    fs.appendFileSync = ((_, content: string | NodeJS.ArrayBufferView) => {
      const text =
        typeof content === "string"
          ? content
          : Buffer.isBuffer(content)
          ? content.toString("utf8")
          : String(content);
      writes.push(text);
    }) as typeof fs.appendFileSync;
    process.env.GITHUB_OUTPUT = "/tmp/output";
  });

  afterEach(() => {
    fs.appendFileSync = originalAppend;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.ISSUE_LABELS;
    vi.resetModules();
  });

  it("selects the default service when no agent label present", async () => {
    process.env.ISSUE_LABELS = JSON.stringify([{ name: "enhancement" }]);
    await import(scriptPath);
    const output = writes.join("");
    expect(output).toContain("service=claude-code");
    expect(output).toContain("menu_label=false");
  });

  it("prefers agent labels when available", async () => {
    process.env.ISSUE_LABELS = JSON.stringify([
      { name: "agent:codex" },
      { name: "poe-code" }
    ]);
    await import(scriptPath);
    const output = writes.join("");
    expect(output).toContain("service=codex");
    expect(output).toContain("menu_label=true");
  });
});
