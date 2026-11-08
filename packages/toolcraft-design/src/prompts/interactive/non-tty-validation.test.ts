import { getEventListeners } from "node:events";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { multiselect, password, text } from "../index.js";
import { CANCEL } from "./cancel-symbol.js";
import { createPromptHarness, tick } from "./test-helpers.js";

describe.each([
  ["text", text],
  ["password", password]
] as const)("%s non-TTY validation", (_name, prompt) => {
  it.each([
    ["first line", "  e\u0301😀  \nignored\n", false, "  e\u0301😀  "],
    ["partial EOF", "  e\u0301😀  ", true, "  e\u0301😀  "],
    ["empty line", "\n", false, ""],
    ["empty EOF", "", true, ""]
  ] as const)("validates %s exactly once after transport cleanup", async (_label, chunk, eof, expected) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => { input.destroy(); });
    const controller = new AbortController();
    const validate = vi.fn(() => {
      expect(input.listenerCount("data")).toBe(0);
      expect(input.listenerCount("end")).toBe(0);
      expect(input.listenerCount("close")).toBe(0);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      return "";
    });
    const pending = prompt({ message: "Value?", input, output, signal: controller.signal, validate });

    if (eof) input.end(chunk);
    else input.write(chunk);

    await expect(pending).resolves.toBe(expected);
    controller.abort();
    input.destroy();
    await tick();
    expect(validate).toHaveBeenCalledExactlyOnceWith(expected);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each(["message", "error", "empty error", "throw"])("rejects a validator %s without waiting for EOF", async (failure) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => { input.destroy(); });
    const controller = new AbortController();
    const error = new Error(failure === "empty error" ? "" : "Invalid value");
    const rawValue = "  private e\u0301🔒value  ";
    const validate = vi.fn(() => {
      if (failure === "throw") throw error;
      return failure === "message" ? error.message : error;
    });
    const pending = prompt({ message: "Value?", input, output, signal: controller.signal, validate });
    const rejected = failure === "message"
      ? expect(pending).rejects.toEqual(error)
      : expect(pending).rejects.toBe(error);

    input.write(`${rawValue}\n`);

    await rejected;
    expect(validate).toHaveBeenCalledExactlyOnceWith(rawValue);
    expect(input.readableEnded).toBe(false);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each(["pre-abort", "abort", "destroy", "pre-destroy"])("skips validation for %s cancellation", async (action) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => { input.destroy(); });
    const controller = new AbortController();
    const validate = vi.fn(() => "Must not validate cancellation");
    if (action === "pre-abort") controller.abort();
    if (action === "pre-destroy") input.destroy();
    const pending = prompt({ message: "Value?", input, output, signal: controller.signal, validate });

    if (action === "abort" || action === "destroy") {
      input.write("partial");
      if (action === "abort") controller.abort();
      else input.destroy();
    }

    await expect(pending).resolves.toBe(CANCEL);
    expect(validate).not.toHaveBeenCalled();
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it("validates already-consumed EOF as empty input", async () => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    input.end("consumed");
    input.resume();
    await tick();
    expect(input.readableEnded).toBe(true);
    expect(input.destroyed).toBe(true);
    const validate = vi.fn();

    await expect(prompt({ message: "Value?", input, output, validate })).resolves.toBe("");

    expect(validate).toHaveBeenCalledExactlyOnceWith("");
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });
});

describe("text non-TTY defaults", () => {
  it.each([
    ["empty line", "\n", "line", "fallback", "fallback"],
    ["empty EOF", "", "EOF", "fallback", "fallback"],
    ["consumed EOF", "", "consumed", "fallback", "fallback"],
    ["empty default", "\n", "line", "", ""],
    ["no default", "", "EOF", undefined, ""],
    ["raw whitespace", "  \n", "line", "fallback", "  "]
  ] as const)("validates and returns the effective value for %s", async (_label, chunk, transport, defaultValue, expected) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => { input.destroy(); });
    if (transport === "consumed") {
      input.end();
      input.resume();
      await tick();
    }
    const validate = vi.fn();
    const pending = text({
      message: "Value?", input, output, validate, defaultValue,
      initialValue: "initial", placeholder: "placeholder"
    });

    if (transport === "line") input.write(chunk);
    if (transport === "EOF") input.end(chunk);

    await expect(pending).resolves.toBe(expected);
    expect(validate).toHaveBeenCalledExactlyOnceWith(expected);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it("rejects an invalid default at EOF", async () => {
    const { input, output, getOutput } = createPromptHarness({ tty: false });
    const validate = vi.fn(() => "Invalid default");
    const pending = text({ message: "Value?", input, output, defaultValue: "fallback", validate });
    const rejected = expect(pending).rejects.toThrowError("Invalid default");

    input.end();

    await rejected;
    expect(validate).toHaveBeenCalledExactlyOnceWith("fallback");
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getOutput()).toBe("");
  });
});

it("preserves required multiselect defaults when prompts are disabled", async () => {
  vi.stubEnv("POE_NO_PROMPT", "1");
  onTestFinished(() => { vi.unstubAllEnvs(); });
  const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });

  await expect(multiselect({
    message: "Values?", input, output, required: true,
    options: [{ value: "first", label: "First" }]
  })).resolves.toEqual([]);

  expect(input.listenerCount("data")).toBe(0);
  expect(getOutput()).toBe("");
  expect(rawModes).toEqual([]);
});
