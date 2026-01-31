import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";

const scriptPath = "../../scripts/workflows/determine-provider.ts";

describe("determine provider workflow script", () => {
  let writes: string[];
  let originalAppend: typeof fs.appendFileSync;

  beforeEach(() => {
    writes = [];
    vi.resetModules();
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
    process.env.LABEL_NAME = "agent:claude-code";
    process.env.ISSUE_NUMBER = "42";
  });

  afterEach(() => {
    vi.resetModules();
    fs.appendFileSync = originalAppend;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.LABEL_NAME;
    delete process.env.ISSUE_NUMBER;
  });

  it("emits metadata for agent-prefixed labels", async () => {
    await import(scriptPath);
    const output = writes.join("");
    expect(output).toContain("service=claude-code");
    expect(output).toContain("branch=agent/claude-code/issue-42");
    expect(output).toContain("pr_label=agent:claude-code");
  });
});
