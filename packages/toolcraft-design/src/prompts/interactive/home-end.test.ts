import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLYPHS } from "./glyphs.js";
import { passwordPrompt } from "./password.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick } from "./test-helpers.js";

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["text", textPrompt],
  ["password", passwordPrompt]
] as const)("%s Home/End navigation", (_name, prompt) => {
  it.each([
    ["CSI Home", "\x1b[H", "Xabcd"],
    ["SS3 Home", "\x1bOH", "Xabcd"],
    ["Home 1~", "\x1b[1~", "Xabcd"],
    ["Home 7~", "\x1b[7~", "Xabcd"],
    ["CSI End", "\x1b[F", "abcdX"],
    ["SS3 End", "\x1bOF", "abcdX"],
    ["End 4~", "\x1b[4~", "abcdX"],
    ["End 8~", "\x1b[8~", "abcdX"],
    ["Ctrl+A", "\x01", "Xabcd"],
    ["Ctrl+E", "\x05", "abcdX"]
  ])("inserts at the correct boundary after %s", async (_label, key, expected) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write("abcd\x1b[D\x1b[D");
    input.write(key);
    input.write("X\r");

    await expect(result).resolves.toBe(expected);
  });

  it.each(["😀", "e\u0301", "👩‍💻", "🇺🇸", "👍🏽"])("preserves %s while inserting at both boundaries", async (grapheme) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write(`A${grapheme}B`);
    input.write("\x1b[D\x1b[D\x1b[HX\x1b[FY\r");

    await expect(result).resolves.toBe(`XA${grapheme}BY`);
  });

  it.each([
    ["empty input", "", "\x1b[H\x1b[H\x1b[F\x1b[FX", "X"],
    ["repeated Home and left", "abcd", "\x1b[H\x1b[H\x1b[DX", "Xabcd"],
    ["repeated End and right", "abcd", "\x1b[D\x1b[D\x1b[F\x1b[F\x1b[CX", "abcdX"]
  ])("keeps %s within the input boundaries", async (_label, value, keys, expected) => {
    const { input, output } = createPromptHarness();
    const result = prompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    input.write(keys);
    input.write("\r");

    await expect(result).resolves.toBe(expected);
  });
});

describe("text initial values and cursor frames", () => {
  it.each([
    ["Home", "\x1b[H", "XA😀B"],
    ["End", "\x1b[F", "A😀BX"]
  ])("moves %s across a Unicode initial value", async (_label, key, expected) => {
    const { input, output } = createPromptHarness();
    const result = textPrompt({ message: "Value?", initialValue: "A😀B", input, output });

    await tick();
    input.write("\x1b[D\x1b[D");
    input.write(key);
    input.write("X\r");

    await expect(result).resolves.toBe(expected);
  });

  it("renders the whole first grapheme at Home and the trailing cursor at End", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const value = "😀e\u0301👩‍💻";
    const result = textPrompt({ message: "Value?", input, output });

    await tick();
    input.write(value);
    input.write("\x1b[D\x1b[H");
    const homeFrame = output.frames.at(-1);
    input.write("\x1b[F");
    const endFrame = output.frames.at(-1);
    input.write("\r");

    await expect(result).resolves.toBe(value);
    expect(homeFrame).toContain("\x1b[7m😀\x1b[0m");
    expect(endFrame).toContain("👩‍💻\x1b[7m█\x1b[0m");
    expect(getOutput()).not.toContain("\ufffd");
  });
});

describe("password boundary cursor frames", () => {
  it.each([undefined, "**"])("preserves grapheme mask counts and positions with mask %j", async (mask) => {
    const { input, output, getOutput } = createPromptHarness();
    const value = "😀e\u0301👩‍💻";
    const glyph = mask ?? GLYPHS.passwordMask;
    const result = passwordPrompt({ message: "Value?", mask, input, output });

    await tick();
    input.write(value);
    input.write("\x1b[D\x1b[H");
    const homeFrame = output.frames.at(-1) ?? "";
    input.write("\x1b[F");
    const endFrame = output.frames.at(-1) ?? "";
    input.write("\r");

    await expect(result).resolves.toBe(value);
    expect(homeFrame).toContain(`\x1b[7m${glyph}\x1b[0m${glyph.repeat(2)}`);
    expect(endFrame).toContain(`${glyph.repeat(3)}\x1b[7m█\x1b[0m`);
    expect(stripVTControlCharacters(homeFrame).split("\n")[1]).toBe(`${GLYPHS.bar}  ${glyph.repeat(3)}`);
    expect(stripVTControlCharacters(endFrame).split("\n")[1]).toBe(`${GLYPHS.bar}  ${glyph.repeat(3)}█`);
    expect(stripVTControlCharacters(output.frames.at(-2) ?? "").split("\n")[1]).toBe(`${GLYPHS.bar}  ${glyph.repeat(3)}`);
    expect(getOutput()).not.toContain("😀");
    expect(getOutput()).not.toContain("👩‍💻");
    expect(getOutput()).not.toContain("\ufffd");
  });
});
