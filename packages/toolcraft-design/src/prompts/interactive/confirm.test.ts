import { describe, expect, it } from "vitest";
import { isCancel } from "./cancel-symbol.js";
import { confirmPrompt } from "./confirm.js";
import { createPromptHarness, tick } from "./test-helpers.js";

describe("confirmPrompt", () => {
  it("submits the initial value with enter", async () => {
    const { input, output } = createPromptHarness();
    const result = confirmPrompt({ message: "Continue?", initialValue: false, input, output });

    await tick();
    input.write("\r");

    await expect(result).resolves.toBe(false);
  });

  it("flips with arrows and supports y/n shortcuts", async () => {
    const flipped = createPromptHarness();
    const flippedResult = confirmPrompt({
      message: "Continue?",
      initialValue: true,
      input: flipped.input,
      output: flipped.output
    });
    await tick();
    flipped.input.write("\x1b[B");
    flipped.input.write("\r");
    await expect(flippedResult).resolves.toBe(false);

    const shortcut = createPromptHarness();
    const shortcutResult = confirmPrompt({ message: "Continue?", input: shortcut.input, output: shortcut.output });
    await tick();
    shortcut.input.write("y");
    await expect(shortcutResult).resolves.toBe(true);
  });

  it("returns cancel on ctrl-c", async () => {
    const { input, output } = createPromptHarness();
    const result = confirmPrompt({ message: "Continue?", input, output });
    await tick();
    input.write("\x03");

    expect(isCancel(await result)).toBe(true);
  });
});
