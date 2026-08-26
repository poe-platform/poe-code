import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANCEL } from "./cancel-symbol.js";
import { Prompt } from "./core.js";
import { passwordPrompt } from "./password.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick } from "./test-helpers.js";

const unicodeGraphemes = ["😀", "e\u0301", "👩‍💻", "🇺🇸", "👍🏽"];

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["text", textPrompt],
  ["password", passwordPrompt]
] as const)("%s Unicode editing", (_name, prompt) => {
  it.each(unicodeGraphemes)("backspace removes the whole %s grapheme", async (value) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    input.write("\x7f\r");

    await expect(result).resolves.toBe("");
  });

  it.each(unicodeGraphemes)("delete removes the whole %s grapheme", async (value) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    input.write("\x01\x1b[3~\r");

    await expect(result).resolves.toBe("");
  });

  it.each([
    ["left and insertion", "A😀B", "\x1b[D\x1b[DX", "AX😀B"],
    ["right and insertion", "A👩‍💻B", "\x01\x1b[C\x1b[CX", "A👩‍💻XB"],
    ["Ctrl+U", "A🇺🇸B", "\x1b[D\x15", "B"],
    ["Ctrl+K", "A👍🏽B", "\x1b[D\x1b[D\x0b", "A"],
    ["Ctrl+E and backspace", "Ae\u0301", "\x01\x05\x7f", "A"],
    ["left at start", "😀B", "\x01\x1b[D\x7fX", "X😀B"],
    ["right at end", "A😀", "\x1b[C\x1b[3~X", "A😀X"],
    ["ASCII editing", "abc", "\x1b[D\x7fX\x1b[3~", "aX"]
  ])("supports %s without splitting graphemes", async (_label, value, keys, expected) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    input.write(keys);
    input.write("\r");

    await expect(result).resolves.toBe(expected);
  });

  it.each([
    ["combining suffix", "\u0301B", "\x01e\x7f", "B"],
    ["ZWJ insertion", "👩💻B", "\x01\x1b[C\u200d\x7f", "B"],
    ["regional indicator insertion", "🇺B", "\x01🇸\x7f", "B"],
    ["skin tone suffix", "🏽B", "\x01👍\x7f", "B"],
    ["regional indicator re-pairing", "🇦🇧🇨B", "\x01🇩\x1b[C\x7f", "🇩🇦B"],
    ["delete joining regional indicators", "🇦X🇧B", "\x01\x1b[C\x1b[3~\x7f", "B"],
    ["backspace joining regional indicators", "🇦X🇧B", "\x01\x1b[C\x1b[C\x7f\x7f", "B"]
  ])("keeps the cursor at a boundary after %s", async (_label, value, keys, expected) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    input.write(keys);
    input.write("\r");

    await expect(result).resolves.toBe(expected);
  });

  it("merges graphemes typed across separate stream writes", async () => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    for (const chunk of ["e", "\u0301", "\x7f", "👩", "\u200d", "💻", "\x7f", "🇺", "🇸", "\x7f", "👍", "🏽", "\x7f"]) {
      input.write(chunk);
    }
    input.write("\r");

    await expect(result).resolves.toBe("");
  });

  it("validates intact Unicode input and permits further editing", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const validate = vi.fn((value: string) => value === "😀" ? "Try again" : undefined);
    const result = prompt({ message: "Value?", input, output, validate });

    await tick();
    input.write("😀\r");
    expect(getOutput()).toContain("Try again");
    input.write("\x7f👩‍💻\r");

    await expect(result).resolves.toBe("👩‍💻");
    expect(validate.mock.calls).toEqual([["😀"], ["👩‍💻"]]);
  });

  it("cancels Unicode input", async () => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write("😀\x03");

    await expect(result).resolves.toBe(CANCEL);
  });

  it("preserves non-TTY Unicode input without rendering", async () => {
    const { input, output, getOutput } = createPromptHarness({ tty: false });
    const result = prompt({ message: "Value?", input, output });
    input.end("e\u0301👩‍💻🇺🇸👍🏽");

    await expect(result).resolves.toBe("e\u0301👩‍💻🇺🇸👍🏽");
    expect(getOutput()).toBe("");
  });
});

describe("Unicode text rendering", () => {
  it.each(unicodeGraphemes)("highlights the whole %s grapheme in initial input", async (value) => {
    const { input, output, getOutput } = createPromptHarness();
    const result = textPrompt({ message: "Value?", initialValue: `A${value}B`, input, output });

    await tick();
    input.write("\x1b[D\x1b[D");
    const frame = output.frames.at(-1);
    input.write("X\r");

    await expect(result).resolves.toBe(`AX${value}B`);
    expect(frame).toContain(`A\x1b[7m${value.normalize("NFC")}\x1b[0mB`);
    expect(getOutput()).not.toContain("\ufffd");
  });

  it.each(unicodeGraphemes)("highlights the whole initial %s placeholder grapheme", async (value) => {
    const { input, output, getOutput } = createPromptHarness();
    const result = textPrompt({ message: "Value?", placeholder: `${value} hint`, input, output });

    await tick();
    const frame = output.frames.at(-1);
    input.write("\r");

    await expect(result).resolves.toBe("");
    expect(frame).toContain(`\x1b[7m${value.normalize("NFC")}\x1b[0m\x1b[2m hint\x1b[0m`);
    expect(getOutput()).not.toContain("\ufffd");
  });

  it("uses the default after deleting an initial Unicode grapheme", async () => {
    const { input, output } = createPromptHarness();
    const result = textPrompt({ message: "Value?", initialValue: "😀", defaultValue: "fallback", input, output });

    await tick();
    input.write("\x7f\r");

    await expect(result).resolves.toBe("fallback");
  });
});

describe("Unicode password rendering", () => {
  it.each(unicodeGraphemes)("renders one mask for %s", async (value) => {
    const { input, output, getOutput } = createPromptHarness();
    const result = passwordPrompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    const frame = stripVTControlCharacters(output.frames.at(-1) ?? "");
    input.write("\r");

    await expect(result).resolves.toBe(value);
    expect(frame.split("\n")[1]).toBe("│  •█");
    expect(stripVTControlCharacters(output.frames.at(-2) ?? "").split("\n")[1]).toBe("│  •");
    expect(getOutput()).not.toContain(value);
  });

  it.each(["•", "**", "🔒", "e\u0301", ""])("aligns the %j mask with grapheme cursor positions", async (mask) => {
    const { input, output, getOutput } = createPromptHarness();
    const result = passwordPrompt({ message: "Value?", mask, input, output });

    await tick();
    input.write("A😀B");
    input.write("\x1b[D\x1b[D");
    const frame = output.frames.at(-1);
    input.write("\r");

    await expect(result).resolves.toBe("A😀B");
    const renderedMask = mask.normalize("NFC");
    expect(frame).toContain(`${renderedMask}\x1b[7m${renderedMask || "█"}\x1b[0m${renderedMask}`);
    expect(stripVTControlCharacters(output.frames.at(-2) ?? "").split("\n")[1]).toBe(`│  ${renderedMask.repeat(3)}`);
    expect(getOutput()).not.toContain("😀");
    expect(getOutput()).not.toContain("\ufffd");
  });
});

class InputPrompt extends Prompt<string> {
  public override setUserInput = super.setUserInput;
}

describe("setUserInput Unicode cursor boundaries", () => {
  it.each([
    ["😀B", 1, 2],
    ["e\u0301B", 1, 2],
    ["👩‍💻B", 2, 5],
    ["🇺🇸B", 2, 4],
    ["👍🏽B", 2, 4],
    ["😀B", 0, 0],
    ["A😀B", 1, 1],
    ["😀", 4, 2],
    ["", 4, 0]
  ])("snaps %j offset %i to %i before emitting input", (value, offset, expected) => {
    const { input, output } = createPromptHarness();
    const prompt = new InputPrompt({ input, output, initialUserInput: "a".repeat(offset), render: () => "" });
    const updates: Array<[string, number]> = [];
    prompt.on("userInput", (userInput: string) => updates.push([userInput, prompt.cursor]));

    prompt.setUserInput(value);

    expect(prompt.userInput).toBe(value);
    expect(prompt.cursor).toBe(expected);
    expect(updates).toEqual([[value, expected]]);
  });

  it("does not reinterpret an untracked option cursor as a grapheme offset", () => {
    const { input, output } = createPromptHarness();
    const prompt = new InputPrompt({ input, output, initialUserInput: "a", render: () => "" }, false);

    prompt.setUserInput("😀B");

    expect(prompt.cursor).toBe(1);
  });
});
