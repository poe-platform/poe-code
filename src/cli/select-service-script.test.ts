import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = fileURLToPath(new URL(
  "../../scripts/workflows/select-service.cjs",
  import.meta.url
));

function runScript(env: Record<string, string>): string {
  const outputFile = `/tmp/github-output-${process.pid}-${Date.now()}`;
  try {
    execSync(`node "${scriptPath}"`, {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        ...env
      }
    });
    return require("node:fs").readFileSync(outputFile, "utf8");
  } finally {
    try { require("node:fs").unlinkSync(outputFile); } catch { /* ignore */ }
  }
}

describe("select service workflow script", () => {
  it("selects the default service when no agent label present", () => {
    const output = runScript({
      ISSUE_LABELS: JSON.stringify([{ name: "enhancement" }])
    });
    expect(output).toContain("service=claude-code");
    expect(output).toContain("menu_label=false");
  });

  it("prefers agent labels when available", () => {
    const output = runScript({
      ISSUE_LABELS: JSON.stringify([
        { name: "agent:codex" },
        { name: "poe-code" }
      ])
    });
    expect(output).toContain("service=codex");
    expect(output).toContain("menu_label=true");
  });
});
