import { afterEach, describe, expect, it } from "vitest";
import { selectPrompt } from "./select.js";
import { createPromptHarness, tick } from "./test-helpers.js";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", disabled: true },
  { value: "c", label: "Gamma", hint: "fast" }
];

describe("selectPrompt", () => {
  const originalNoPrompt = process.env.POE_NO_PROMPT;

  afterEach(() => {
    if (originalNoPrompt === undefined) {
      delete process.env.POE_NO_PROMPT;
    } else {
      process.env.POE_NO_PROMPT = originalNoPrompt;
    }
  });

  it("navigates through enabled options and returns the focused value", async () => {
    const { input, output } = createPromptHarness();
    const result = selectPrompt({ message: "Pick", options, input, output });

    await tick();
    input.write("\x1b[B");
    input.write("\r");

    await expect(result).resolves.toBe("c");
  });

  it("uses initialValue and wraps navigation", async () => {
    const { input, output } = createPromptHarness();
    const result = selectPrompt({ message: "Pick", options, initialValue: "c", input, output });

    await tick();
    input.write("\x1b[B");
    input.write("\r");

    await expect(result).resolves.toBe("a");
  });

  it("throws for non-TTY without POE_NO_PROMPT and returns default with it", async () => {
    const rejected = createPromptHarness({ tty: false });
    await expect(selectPrompt({ message: "Pick", options, input: rejected.input, output: rejected.output }))
      .rejects.toThrow("Interactive prompt requires a TTY");

    process.env.POE_NO_PROMPT = "1";
    const accepted = createPromptHarness({ tty: false });
    await expect(selectPrompt({ message: "Pick", options, input: accepted.input, output: accepted.output }))
      .resolves.toBe("a");
  });

  it("throws when every option is disabled", () => {
    const { input, output } = createPromptHarness();

    expect(() => selectPrompt({
      message: "Pick",
      input,
      output,
      options: [{ value: "a", label: "Alpha", disabled: true }]
    })).toThrow("Select prompt requires at least one enabled option.");
  });
});
