import { describe, expect, it, vi } from "vitest";
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

  it.each([
    { name: "empty input uses the default", initialValue: undefined, typed: "", defaultValue: "demo", expected: "demo" },
    { name: "Ctrl+U clears the initial value to the default", initialValue: "initial", typed: "\x15", defaultValue: "demo", expected: "demo" },
    { name: "typed input overrides the default", initialValue: undefined, typed: "Ada", defaultValue: "demo", expected: "Ada" },
    { name: "initial input overrides the default", initialValue: "Grace", typed: "", defaultValue: "demo", expected: "Grace" },
    { name: "typed whitespace overrides the default", initialValue: undefined, typed: "   ", defaultValue: "demo", expected: "   " },
    { name: "whitespace default is preserved", initialValue: undefined, typed: "", defaultValue: "   ", expected: "   " }
  ])("validates the exact submitted value when $name", async ({ initialValue, typed, defaultValue, expected }) => {
    const { input, output } = createPromptHarness();
    const validate = vi.fn((value: string) => value.length > 0 ? undefined : "Name is required");
    const result = textPrompt({ message: "Name?", initialValue, defaultValue, validate, input, output });

    try {
      await tick();
      input.write(typed);
      input.write("\r");
      await tick();

      expect(validate).toHaveBeenCalledExactlyOnceWith(expected);
      await expect(result).resolves.toBe(expected);
    } finally {
      input.write("\x03");
      await result;
    }
  });

  it("rejects an invalid default and allows a typed replacement", async () => {
    const { input, output, getOutput } = createPromptHarness();
    const validate = vi.fn((value: string) => value === "bad" ? "Choose another name" : undefined);
    const settled = vi.fn();
    const result = textPrompt({ message: "Name?", defaultValue: "bad", validate, input, output });
    void result.then(settled);

    try {
      await tick();
      input.write("\r");
      await tick();

      expect(validate).toHaveBeenCalledExactlyOnceWith("bad");
      expect(getOutput()).toContain("Choose another name");
      expect(settled).not.toHaveBeenCalled();

      input.write("good");
      input.write("\r");

      await expect(result).resolves.toBe("good");
      expect(validate.mock.calls).toEqual([["bad"], ["good"]]);
    } finally {
      input.write("\x03");
      await result;
    }
  });

  it.each([{}, { defaultValue: "" }, { placeholder: "demo" }])(
    "validates empty input without a usable default (%j)",
    async (options) => {
      const { input, output, getOutput } = createPromptHarness();
      const validate = vi.fn((value: string) => value.length > 0 ? undefined : "Name is required");
      const settled = vi.fn();
      const result = textPrompt({ message: "Name?", ...options, validate, input, output });
      void result.then(settled);

      try {
        await tick();
        input.write("\r");
        await tick();

        expect(validate).toHaveBeenCalledExactlyOnceWith("");
        expect(getOutput()).toContain("Name is required");
        expect(settled).not.toHaveBeenCalled();

        input.write("Ada");
        input.write("\r");

        await expect(result).resolves.toBe("Ada");
        expect(validate.mock.calls).toEqual([[""], ["Ada"]]);
      } finally {
        input.write("\x03");
        await result;
      }
    }
  );

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
