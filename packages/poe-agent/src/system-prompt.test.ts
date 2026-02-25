import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadSystemPrompt, loadSystemPromptSync } from "./system-prompt.js";

describe("poe-agent system prompt", () => {
  it("reads the bundled prompt asynchronously", async () => {
    const expectedPrompt = await readFile(
      new URL("./SYSTEM_PROMPT.md", import.meta.url),
      "utf8"
    );

    await expect(loadSystemPrompt()).resolves.toBe(expectedPrompt);
  });

  it("reads the bundled prompt synchronously", async () => {
    const expectedPrompt = await readFile(
      new URL("./SYSTEM_PROMPT.md", import.meta.url),
      "utf8"
    );

    expect(loadSystemPromptSync()).toBe(expectedPrompt);
  });

  it("contains the recovered behavioral instructions", async () => {
    const prompt = await loadSystemPrompt();

    expect(prompt).toContain("You are a Poe agent, built by Poe");
    expect(prompt).toContain("Assist with defensive security only");
  });
});
