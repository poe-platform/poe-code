import { afterEach, describe, expect, it } from "vitest";
import { wrapAnsi } from "fast-wrap-ansi";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { GLYPHS } from "./glyphs.js";
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

  it("keeps Echo visible after four down keys in a seven-row terminal", async () => {
    const { input, output } = createPromptHarness({ rows: 7, columns: 80 });
    const choices = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((label) => ({ value: label, label }));
    const result = selectPrompt({ message: "Pick", options: choices, input, output });

    await tick();
    input.write("\x1b[B".repeat(4));
    const frame = stripAnsi(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toBe("Echo");
    expect(frame).toContain(`${GLYPHS.radioActive} Echo`);
    expect(frame).toContain("...");
    expect(frame).not.toContain("Alpha");
  });

  it("keeps the wrapped active Charlie label visible before submission", async () => {
    const { input, output } = createPromptHarness({ rows: 10, columns: 12 });
    const choices = ["Alpha long label", "Bravo long label", "Charlie long label"].map((label) => ({ value: label, label }));
    const result = selectPrompt({ message: "Pick", options: choices, input, output });

    await tick();
    input.write("\x1b[B\x1b[B");
    const frame = stripAnsi(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toBe("Charlie long label");
    expect(frame).toContain(wrapAnsi(`${GLYPHS.radioActive} Charlie long label`, 9, { hard: true, trim: false }));
  });

  it.each([{ rows: 7, columns: 80 }, { rows: 10, columns: 12 }])("preserves focus through resize to $rows rows/$columns columns and back", async (size) => {
    const { input, output } = createPromptHarness({ rows: 20, columns: 80 });
    const choices = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((label) => ({ value: label, label: `${label} long label` }));
    const result = selectPrompt({ message: "Pick", options: choices, input, output });

    await tick();
    input.write("\x1b[B".repeat(4));
    output.rows = size.rows;
    output.columns = size.columns;
    output.emit("resize");
    const shrunk = stripAnsi(output.frames.at(-1) ?? "");
    output.rows = 20;
    output.columns = 80;
    output.emit("resize");
    const grown = stripAnsi(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toBe("Echo");
    expect(shrunk).toContain(wrapAnsi(`${GLYPHS.radioActive} Echo long label`, size.columns - 3, { hard: true, trim: false }));
    expect(grown).toContain(`${GLYPHS.radioActive} Echo long label`);
    for (const choice of choices) {
      expect(grown).toContain(choice.label);
    }
    expect(grown).not.toContain("...");
  });
});
