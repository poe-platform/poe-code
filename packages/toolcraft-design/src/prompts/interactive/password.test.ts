import { describe, expect, it } from "vitest";
import { passwordPrompt } from "./password.js";
import { createPromptHarness, tick } from "./test-helpers.js";

describe("passwordPrompt", () => {
  it("masks output but returns the actual typed value", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const result = passwordPrompt({ message: "Token?", input, output });

    await tick();
    input.write("sekret");
    await tick();
    expect(getOutput()).toContain("••");
    expect(getOutput()).not.toContain("sekret");
    input.write("\r");

    await expect(result).resolves.toBe("sekret");
  });

  it("supports clearing hidden input with terminal line editing keys", async () => {
    const { input, output } = createPromptHarness();
    const result = passwordPrompt({ message: "Token?", input, output });

    await tick();
    input.write("wrong-secret");
    input.write("\x15");
    input.write("sekret");
    input.write("\r");

    await expect(result).resolves.toBe("sekret");
  });

  it("validates submitted passwords", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const result = passwordPrompt({
      message: "Token?",
      input,
      output,
      validate: (value) => value.length >= 3 ? undefined : "Too short"
    });

    await tick();
    input.write("x");
    input.write("\r");
    await tick();
    expect(getOutput()).toContain("Too short");
    input.write("yz");
    input.write("\r");

    await expect(result).resolves.toBe("xyz");
  });
});
