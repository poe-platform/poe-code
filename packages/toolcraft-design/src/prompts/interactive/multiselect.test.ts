import { describe, expect, it } from "vitest";
import { wrapAnsi } from "fast-wrap-ansi";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { GLYPHS } from "./glyphs.js";
import { multiselectPrompt } from "./multiselect.js";
import { createPromptHarness, tick } from "./test-helpers.js";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma", disabled: true }
];

describe("multiselectPrompt", () => {
  it("toggles values with space and submits selected values", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const result = multiselectPrompt({ message: "Pick", options, input, output });

    await tick();
    input.write(" ");
    await tick();
    expect(getOutput()).toContain("[x]");
    expect(getOutput()).toContain("[ ]");
    input.write("\x1b[B");
    input.write(" ");
    input.write("\r");

    await expect(result).resolves.toEqual(["a", "b"]);
  });

  it("supports toggle all and invert shortcuts", async () => {
    const all = createPromptHarness();
    const allResult = multiselectPrompt({ message: "Pick", options, input: all.input, output: all.output });
    await tick();
    all.input.write("a");
    all.input.write("\r");
    await expect(allResult).resolves.toEqual(["a", "b"]);

    const inverted = createPromptHarness();
    const invertResult = multiselectPrompt({
      message: "Pick",
      options,
      initialValues: ["a"],
      input: inverted.input,
      output: inverted.output
    });
    await tick();
    inverted.input.write("i");
    inverted.input.write("\r");
    await expect(invertResult).resolves.toEqual(["b"]);
  });

  it("summarizes large submitted selections by count", async () => {
    const manyOptions = Array.from({ length: 13 }, (_, index) => ({
      value: `value-${index + 1}`,
      label: `VeryLongSelectedOption-${index + 1}`
    }));
    const { input, output } = createPromptHarness();
    const result = multiselectPrompt({
      message: "Pick",
      options: manyOptions,
      initialValues: manyOptions.map((option) => option.value),
      input,
      output
    });

    await tick();
    input.write("\r");

    await expect(result).resolves.toEqual(manyOptions.map((option) => option.value));
    const submittedFrame = [...output.frames].reverse().find((frame) => frame.includes("Pick")) ?? "";
    expect(submittedFrame).toContain("13 selected");
    expect(submittedFrame).not.toContain("VeryLongSelectedOption-13");
  });

  it("blocks empty submit when required", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const result = multiselectPrompt({ message: "Pick", options, required: true, input, output });

    await tick();
    input.write("\r");
    await tick();
    expect(getOutput()).toContain("Please select at least one option.");
    input.write(" ");
    input.write("\r");

    await expect(result).resolves.toEqual(["a"]);
  });

  it("throws when every option is disabled", () => {
    const { input, output } = createPromptHarness();

    expect(() => multiselectPrompt({
      message: "Pick",
      input,
      output,
      options: [{ value: "a", label: "Alpha", disabled: true }]
    })).toThrow("Multiselect prompt requires at least one enabled option.");
  });

  it("keeps Echo visible when toggling in a seven-row terminal", async () => {
    const { input, output } = createPromptHarness({ rows: 7, columns: 80 });
    const choices = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((label) => ({ value: label, label }));
    const result = multiselectPrompt({ message: "Pick", options: choices, input, output });

    await tick();
    input.write("\x1b[B".repeat(4));
    const focused = stripAnsi(output.frames.at(-1) ?? "");
    input.write(" ");
    const toggled = stripAnsi(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toEqual(["Echo"]);
    expect(focused).toContain(`${GLYPHS.checkboxActive} Echo`);
    expect(toggled).toContain(`${GLYPHS.checkboxSelected} Echo`);
    expect(toggled).toContain("...");
    expect(toggled).not.toContain("Alpha");
  });

  it("visibly toggles the wrapped active Charlie label", async () => {
    const { input, output } = createPromptHarness({ rows: 10, columns: 12 });
    const choices = ["Alpha long label", "Bravo long label", "Charlie long label"].map((label) => ({ value: label, label }));
    const result = multiselectPrompt({ message: "Pick", options: choices, input, output });

    await tick();
    input.write("\x1b[B\x1b[B");
    const focused = stripAnsi(output.frames.at(-1) ?? "");
    input.write(" ");
    const toggled = stripAnsi(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toEqual(["Charlie long label"]);
    expect(focused).toContain(wrapAnsi(`${GLYPHS.checkboxActive} Charlie long label`, 9, { hard: true, trim: false }));
    expect(toggled).toContain(wrapAnsi(`${GLYPHS.checkboxSelected} Charlie long label`, 9, { hard: true, trim: false }));
  });

  it.each([{ rows: 7, columns: 80 }, { rows: 10, columns: 12 }])("preserves focus and selection through resize to $rows rows/$columns columns and back", async (size) => {
    const { input, output } = createPromptHarness({ rows: 20, columns: 80 });
    const choices = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((label) => ({ value: label, label: `${label} long label` }));
    const result = multiselectPrompt({ message: "Pick", options: choices, input, output });

    await tick();
    input.write("\x1b[B".repeat(4));
    output.rows = size.rows;
    output.columns = size.columns;
    output.emit("resize");
    input.write(" ");
    const shrunk = stripAnsi(output.frames.at(-1) ?? "");
    output.rows = 20;
    output.columns = 80;
    output.emit("resize");
    const grown = stripAnsi(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toEqual(["Echo"]);
    expect(shrunk).toContain(wrapAnsi(`${GLYPHS.checkboxSelected} Echo long label`, size.columns - 3, { hard: true, trim: false }));
    expect(grown).toContain(`${GLYPHS.checkboxSelected} Echo long label`);
    for (const choice of choices) {
      expect(grown).toContain(choice.label);
    }
    expect(grown).not.toContain("...");
  });
});
