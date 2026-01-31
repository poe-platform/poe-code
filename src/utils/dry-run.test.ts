import { describe, it, expect } from "vitest";
import { renderUnifiedDiff } from "./dry-run.js";

describe("dry run diff redaction", () => {
  it("redacts api key values in JSON diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.poe-code/credentials.json",
      null,
      "{\n  \"apiKey\": \"sk-test\"\n}\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-test");
    expect(output).toContain("<redacted>");
  });

  it("redacts api key helper commands in JSON diffs", () => {
    const diff = renderUnifiedDiff(
      "/home/test/.claude/settings.json",
      null,
      "{\n  \"apiKeyHelper\": \"echo sk-test\"\n}\n"
    );
    const output = diff.join("\n");
    expect(output).not.toContain("sk-test");
    expect(output).toContain("echo <redacted>");
  });

  it("redacts auth keys and bearer tokens in auth diffs", () => {
    const authDiff = renderUnifiedDiff(
      "/home/test/.config/opencode/auth.json",
      null,
      "{\n  \"type\": \"api\",\n  \"key\": \"sk-test\"\n}\n"
    );
    const authOutput = authDiff.join("\n");
    expect(authOutput).not.toContain("sk-test");
    expect(authOutput).toContain("\"key\": \"<redacted>\"");

    const tomlDiff = renderUnifiedDiff(
      "/home/test/.codex/config.toml",
      null,
      "experimental_bearer_token = \"sk-test\"\n"
    );
    const tomlOutput = tomlDiff.join("\n");
    expect(tomlOutput).not.toContain("sk-test");
    expect(tomlOutput).toContain("<redacted>");
  });
});
