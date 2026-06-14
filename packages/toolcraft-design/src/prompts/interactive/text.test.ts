import { describe, expect, it } from "vitest";
import { isCancel } from "./cancel-symbol.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick } from "./test-helpers.js";

describe("textPrompt", () => {
  it("returns typed input on submit", async () => {
    const { input, output } = createPromptHarness();
    const result = textPrompt({ message: "Name?", input, output });

    await tick();
    input.write("Ada");
    input.write("\r");

    await expect(result).resolves.toBe("Ada");
  });

  it("treats spaces and hjkl characters as text input", async () => {
    const { input, output } = createPromptHarness();
    const result = textPrompt({ message: "Name?", input, output });

    await tick();
    input.write("hi jk l");
    input.write("\r");

    await expect(result).resolves.toBe("hi jk l");
  });

  it("supports terminal line editing keys", async () => {
    const { input, output } = createPromptHarness();
    const result = textPrompt({ message: "Path?", initialValue: ".poe-code/harnesses/demo", input, output });

    await tick();
    input.write("\x15");
    input.write("custom hjkl dir");
    input.write("\r");

    await expect(result).resolves.toBe("custom hjkl dir");
  });

  it("returns defaultValue when submitted empty", async () => {
    const { input, output } = createPromptHarness();
    const result = textPrompt({ message: "Name?", defaultValue: "default", input, output });

    await tick();
    input.write("\r");

    await expect(result).resolves.toBe("default");
  });

  it("renders validation errors and keeps editing", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const result = textPrompt({
      message: "Name?",
      input,
      output,
      validate: (value) => value.endsWith("ok") ? undefined : "Use ok"
    });

    await tick();
    input.write("no");
    input.write("\r");
    await tick();
    expect(getOutput()).toContain("Use ok");
    input.write("ok");
    input.write("\r");

    await expect(result).resolves.toBe("nook");
  });

  it("renders placeholder while empty", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const result = textPrompt({ message: "Name?", placeholder: "my-app", input, output });

    await tick();
    expect(getOutput()).toContain("my-app");
    input.write("\x03");

    expect(isCancel(await result)).toBe(true);
  });

  it("resolves cancel for escape and aborted signals", async () => {
    const escaped = createPromptHarness();
    const escapeResult = textPrompt({ message: "Name?", input: escaped.input, output: escaped.output });
    await tick();
    escaped.input.write("\x1b");
    expect(isCancel(await escapeResult)).toBe(true);

    const controller = new AbortController();
    controller.abort();
    const { input, output } = createPromptHarness();
    expect(isCancel(await textPrompt({ message: "Name?", input, output, signal: controller.signal }))).toBe(true);
  });

  it("does not write terminal cleanup for pre-aborted prompts", async () => {
    const controller = new AbortController();
    controller.abort();
    const { input, output, getOutput, rawModes } = createPromptHarness();

    expect(isCancel(await textPrompt({ message: "Name?", input, output, signal: controller.signal }))).toBe(true);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it("reads one line from non-TTY input", async () => {
    const { input, output } = createPromptHarness({ tty: false });
    const result = textPrompt({ message: "Name?", input, output });
    input.write("piped\nrest");

    await expect(result).resolves.toBe("piped");
  });

  it("returns non-TTY input that ends without a newline", async () => {
    const { input, output } = createPromptHarness({ tty: false });
    const result = textPrompt({ message: "Name?", input, output });
    input.end("piped");

    await expect(result).resolves.toBe("piped");
  });
});
