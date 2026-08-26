import { afterEach, describe, expect, it, vi } from "vitest";
import { wrapAnsi } from "fast-wrap-ansi";
import { color } from "../../components/color.js";
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
    vi.unstubAllEnvs();
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
    expect(frame).toContain(wrapAnsi(`${GLYPHS.radioActive} Charlie long label`, 9, { hard: true, trim: false })
      .split("\n").map((line) => `${GLYPHS.bar}  ${line}`).join("\n"));
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
    expect(shrunk).toContain(wrapAnsi(`${GLYPHS.radioActive} Echo long label`, size.columns - 3, { hard: true, trim: false })
      .split("\n").map((line) => `${GLYPHS.bar}  ${line}`).join("\n"));
    expect(grown).toContain(`${GLYPHS.radioActive} Echo long label`);
    for (const choice of choices) {
      expect(grown).toContain(choice.label);
    }
    expect(grown).not.toContain("...");
  });

  it.each([4, 8, 12, 20, 80])("prefixes wrapped labels and hints at width %i without changing rows or ANSI", async (columns) => {
    vi.stubEnv("FORCE_COLOR", "1");
    const { input, output } = createPromptHarness({ columns, rows: 20 });
    const label = "Alpha long option label";
    const hint = "a long descriptive hint";
    const wrapped = wrapAnsi(`${color.green(GLYPHS.radioActive)} ${label}${color.dim(` (${hint})`)}`, columns - 3, { hard: true, trim: false }).split("\n");
    const result = selectPrompt({ message: "", options: [{ value: "alpha", label, hint }], input, output });

    await tick();
    const lines = (output.frames.at(-1) ?? "").split("\n").slice(1, -1);
    input.write("\r");

    await expect(result).resolves.toBe("alpha");
    expect(lines).toHaveLength(wrapped.length);
    expect(lines).toEqual(wrapped.map((line) => `${color.cyan(GLYPHS.bar)}  ${line}`));
  });

  it("prefixes explicit label/hint newlines including blank lines", async () => {
    const { input, output } = createPromptHarness({ columns: 80 });
    const result = selectPrompt({
      message: "Pick",
      options: [{ value: "alpha", label: "Alpha\n\nsecond label", hint: "first hint\n\nlast hint" }],
      input,
      output
    });

    await tick();
    const lines = stripAnsi(output.frames.at(-1) ?? "").split("\n").slice(1, -1);
    input.write("\r");

    await expect(result).resolves.toBe("alpha");
    expect(lines).toEqual([
      `${GLYPHS.bar}  ${GLYPHS.radioActive} Alpha`,
      `${GLYPHS.bar}  `,
      `${GLYPHS.bar}  second label (first hint`,
      `${GLYPHS.bar}  `,
      `${GLYPHS.bar}  last hint)`
    ]);
  });

  it("prefixes every wrapped omission-marker row", async () => {
    const { input, output } = createPromptHarness({ columns: 4, rows: 20 });
    const choices = Array.from({ length: 10 }, (_, index) => ({ value: index, label: String(index) }));
    const result = selectPrompt({ message: "Pick", options: choices, maxItems: 5, input, output });

    await tick();
    const lines = stripAnsi(output.frames.at(-1) ?? "").split("\n");
    input.write("\r");

    await expect(result).resolves.toBe(0);
    expect(lines.slice(-4, -1)).toEqual([`${GLYPHS.bar}  .`, `${GLYPHS.bar}  .`, `${GLYPHS.bar}  .`]);
  });
});
