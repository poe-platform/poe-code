import { afterEach, describe, expect, it } from "vitest";
import { nonTtyPromptMessage } from "./core.js";
import { selectPrompt } from "./select.js";
import { createPromptHarness } from "./test-helpers.js";

describe("nonTtyPromptMessage", () => {
  it("names --yes before the env var and includes the command being run", () => {
    const message = nonTtyPromptMessage(["node", "/usr/local/bin/poe-code", "configure", "claude"]);

    expect(message).toContain("configure claude");
    expect(message).toContain("--yes");
    expect(message).toContain("POE_NO_PROMPT=1");
    expect(message.indexOf("--yes")).toBeLessThan(message.indexOf("POE_NO_PROMPT"));
  });

  it("stops the command at the first flag so option values are not mistaken for subcommands", () => {
    const message = nonTtyPromptMessage([
      "node",
      "/usr/local/bin/poe-code",
      "gaslight",
      "ingest",
      "--limit",
      "1",
      "--since",
      "1d"
    ]);

    expect(message).toContain("gaslight ingest --yes");
    expect(message).not.toContain("1d");
  });

  it("omits the command when no subcommand was given", () => {
    const message = nonTtyPromptMessage(["node", "/usr/local/bin/poe-code"]);

    expect(message).toContain("--yes");
    expect(message).toContain("POE_NO_PROMPT=1");
  });
});

describe("promptNonTty rejection", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("guides non-TTY callers to --yes for the command being run", async () => {
    process.argv = ["node", "/usr/local/bin/poe-code", "test"];
    const { input, output } = createPromptHarness({ tty: false });

    await expect(
      selectPrompt({ message: "Pick", options: [{ value: "a", label: "Alpha" }], input, output })
    ).rejects.toThrow(/test --yes/);
  });
});
