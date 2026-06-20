import { describe, expect, it } from "vitest";
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
});
