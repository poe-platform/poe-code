import { wrapAnsi } from "fast-wrap-ansi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { color } from "../../components/color.js";
import { displayWidth } from "../../dashboard/terminal-width.js";
import { stripAnsi } from "../../internal/strip-ansi.js";
import { CANCEL } from "./cancel-symbol.js";
import { GLYPHS } from "./glyphs.js";
import { multiselectPrompt } from "./multiselect.js";
import { passwordPrompt } from "./password.js";
import { selectPrompt } from "./select.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick } from "./test-helpers.js";

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  { name: "text", prompt: textPrompt, masked: false, mask: undefined },
  { name: "password", prompt: passwordPrompt, masked: true, mask: undefined },
  { name: "password with lock mask", prompt: passwordPrompt, masked: true, mask: "🔒" }
])("$name value-body wrapping", ({ prompt, masked, mask }) => {
  it.each(["active-end", "active-middle", "error", "submit", "cancel"])("prefixes every %s body row and preserves styles and the raw value", async (state) => {
    const { input, output, getOutput } = createPromptHarness({ columns: 20 });
    const value = "abcdefghijklmnopqrstuvwx😀e\u0301👩‍💻";
    const glyph = mask ?? GLYPHS.passwordMask;
    const payload = masked ? glyph.repeat(27) : value;
    const validate = vi.fn().mockReturnValueOnce(state === "error" ? "Invalid" : undefined);
    const result = prompt({ message: "Value?", mask, validate, input, output });

    await tick();
    input.write(value);
    if (state === "active-middle") {
      input.write("\x1b[D\x1b[D\x1b[D");
    } else if (state === "error" || state === "submit") {
      input.write("\r");
    } else if (state === "cancel") {
      input.write("\x03");
    }
    const finished = state === "submit" || state === "cancel";
    const frame = output.frames.at(finished ? -2 : -1) ?? "";
    if (!finished) {
      input.write("\r");
    }

    await expect(result).resolves.toBe(state === "cancel" ? CANCEL : value);
    const cursorPayload = state === "active-middle"
      ? `${masked ? glyph.repeat(24) : "abcdefghijklmnopqrstuvwx"}${color.inverse(masked ? glyph : "😀")}${masked ? glyph.repeat(2) : "e\u0301👩‍💻"}`
      : `${payload}${color.inverse("█")}`;
    const styled = state === "submit" ? color.dim(payload) : state === "cancel" ? color.dim.strikethrough(payload) : cursorPayload;
    const prefix = `${finished ? color.gray(GLYPHS.bar) : state === "error" ? color.yellow(GLYPHS.bar) : color.cyan(GLYPHS.bar)}  `;
    const lines = frame.split("\n").slice(1, -1);

    expect(lines).toEqual(wrapAnsi(styled, 17, { hard: true, trim: false }).split("\n").map((line) => `${prefix}${line}`));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(displayWidth(stripAnsi(line))).toBeLessThanOrEqual(20);
    }
    if (state === "error") {
      expect(validate).toHaveBeenNthCalledWith(1, value);
      expect(validate).toHaveBeenCalledTimes(2);
      expect(frame).toContain(color.yellow("Invalid"));
    }
    if (masked) {
      expect(getOutput()).not.toContain("abcd");
      expect(getOutput()).not.toContain("😀");
      expect(getOutput()).not.toContain("👩‍💻");
    }
    expect(getOutput()).not.toContain("\ufffd");
  });

  it("preserves unwrapped active and submitted bodies at eighty columns", async () => {
    const { input, output } = createPromptHarness({ columns: 80 });
    const value = "abcdefghijklmnopqrstuvwx😀e\u0301👩‍💻";
    const payload = masked ? (mask ?? GLYPHS.passwordMask).repeat(27) : value;
    const result = prompt({ message: "Value?", mask, input, output });

    await tick();
    input.write(value);
    const activeFrame = output.frames.at(-1) ?? "";
    input.write("\r");

    await expect(result).resolves.toBe(value);
    const submittedFrame = output.frames.at(-2) ?? "";
    expect(activeFrame.split("\n").slice(1, -1)).toEqual([`${color.cyan(GLYPHS.bar)}  ${payload.normalize("NFC")}${color.inverse("█")}`]);
    expect(submittedFrame.split("\n").slice(1, -1)).toEqual([`${color.gray(GLYPHS.bar)}  ${color.dim(payload.normalize("NFC"))}`]);
    expect(displayWidth(stripAnsi(activeFrame.split("\n")[1]))).toBeLessThanOrEqual(80);
  });
});

describe("text multiline values and placeholders", () => {
  it.each(["active", "error", "submit", "cancel"])("prefixes explicit blank lines in an initial %s value", async (state) => {
    const { input, output } = createPromptHarness({ columns: 20 });
    const value = "Alpha\n\nabcdefghijklmnopqrstuvwx\n\n😀e\u0301👩‍💻";
    const validate = vi.fn().mockReturnValueOnce(state === "error" ? "Invalid" : undefined);
    const result = textPrompt({ message: "Value?", initialValue: value, validate, input, output });

    await tick();
    if (state === "submit" || state === "error") {
      input.write("\r");
    } else if (state === "cancel") {
      input.write("\x03");
    }
    const finished = state === "submit" || state === "cancel";
    const frame = output.frames.at(finished ? -2 : -1) ?? "";
    if (!finished) {
      input.write("\r");
    }

    await expect(result).resolves.toBe(state === "cancel" ? CANCEL : value);
    const styled = state === "submit" ? color.dim(value) : state === "cancel" ? color.dim.strikethrough(value) : `${value}${color.inverse("█")}`;
    const prefix = `${finished ? color.gray(GLYPHS.bar) : state === "error" ? color.yellow(GLYPHS.bar) : color.cyan(GLYPHS.bar)}  `;
    const lines = frame.split("\n").slice(1, -1);
    expect(lines).toEqual(wrapAnsi(styled, 17, { hard: true, trim: false }).split("\n").map((line) => `${prefix}${line}`));
    expect(lines.map(stripAnsi).filter((line) => line === `${GLYPHS.bar}  `)).toHaveLength(2);
    for (const line of lines) {
      expect(displayWidth(stripAnsi(line))).toBeLessThanOrEqual(20);
    }
  });

  it.each(["active", "error"])("wraps a long %s placeholder with its cursor and dim styling", async (state) => {
    const { input, output } = createPromptHarness({ columns: 20 });
    const placeholder = "😀abcdefghijklmnopqrstuvwx\n\nhint";
    const validate = vi.fn().mockReturnValueOnce(state === "error" ? "Invalid" : undefined);
    const result = textPrompt({ message: "Value?", placeholder, validate, input, output });

    await tick();
    if (state === "error") {
      input.write("\r");
    }
    const frame = output.frames.at(-1) ?? "";
    input.write("\r");

    await expect(result).resolves.toBe("");
    const styled = `${color.inverse("😀")}${color.dim("abcdefghijklmnopqrstuvwx\n\nhint")}`;
    const prefix = `${state === "error" ? color.yellow(GLYPHS.bar) : color.cyan(GLYPHS.bar)}  `;
    const lines = frame.split("\n").slice(1, -1);
    expect(lines).toEqual(wrapAnsi(styled, 17, { hard: true, trim: false }).split("\n").map((line) => `${prefix}${line}`));
    expect(lines.map(stripAnsi)).toContain(`${GLYPHS.bar}  `);
    expect(validate).toHaveBeenNthCalledWith(1, "");
    for (const line of lines) {
      expect(displayWidth(stripAnsi(line))).toBeLessThanOrEqual(20);
    }
  });
});

describe.each([
  { name: "select", prompt: selectPrompt<string>, multiple: false },
  { name: "multiselect", prompt: multiselectPrompt<string>, multiple: true }
])("$name final value wrapping", ({ prompt, multiple }) => {
  it.each([
    ["submit", 20, "abcdefghijklmnopqrstuvwx😀e\u0301👩‍💻"],
    ["cancel", 20, "abcdefghijklmnopqrstuvwx😀e\u0301👩‍💻"],
    ["submit", 80, "abcdefghijklmnopqrstuvwx😀e\u0301👩‍💻"],
    ["cancel", 80, "abcdefghijklmnopqrstuvwx😀e\u0301👩‍💻"],
    ["submit", 20, "Alpha\n\nabcdefghijklmnopqrstuvwx\n\nEcho"],
    ["cancel", 20, "Alpha\n\nabcdefghijklmnopqrstuvwx\n\nEcho"]
  ] as const)("prefixes the %s body at width %i for label %j", async (state, columns, label) => {
    const { input, output } = createPromptHarness({ columns });
    const value = "raw e\u0301👩‍💻";
    const result = prompt({
      message: "Value?",
      options: [{ value, label }],
      ...(multiple ? { initialValues: [value] } : {}),
      input,
      output
    });

    await tick();
    input.write(state === "submit" ? "\r" : "\x03");

    await expect(result).resolves.toEqual(state === "cancel" ? CANCEL : multiple ? [value] : value);
    const frame = output.frames.at(-2) ?? "";
    const styled = state === "submit" ? color.dim(label) : color.dim.strikethrough(label);
    const lines = frame.split("\n").slice(1, -1);
    expect(lines).toEqual(wrapAnsi(styled, columns - 3, { hard: true, trim: false }).split("\n").map((line) => `${color.gray(GLYPHS.bar)}  ${line}`));
    if (columns === 80) {
      expect(lines).toHaveLength(1);
    }
    if (label.includes("\n\n")) {
      expect(lines.map(stripAnsi).filter((line) => line === `${GLYPHS.bar}  `)).toHaveLength(2);
    }
    for (const line of lines) {
      expect(displayWidth(stripAnsi(line))).toBeLessThanOrEqual(columns);
    }
  });
});

describe("multiselect count summaries", () => {
  it.each(["submit", "cancel"])("preserves the unwrapped %s count summary", async (state) => {
    const { input, output } = createPromptHarness({ columns: 80 });
    const options = Array.from({ length: 4 }, (_, index) => ({ value: index, label: `Long selected option label ${index}` }));
    const values = options.map((option) => option.value);
    const result = multiselectPrompt({ message: "Value?", options, initialValues: values, input, output });

    await tick();
    input.write(state === "submit" ? "\r" : "\x03");

    await expect(result).resolves.toEqual(state === "cancel" ? CANCEL : values);
    const styled = state === "submit" ? color.dim("4 selected") : color.dim.strikethrough("4 selected");
    const frame = output.frames.at(-2) ?? "";
    expect(frame.split("\n").slice(1, -1)).toEqual([`${color.gray(GLYPHS.bar)}  ${styled}`]);
    expect(frame).not.toContain("Long selected option label");
  });
});
