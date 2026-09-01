import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CANCEL } from "./cancel-symbol.js";
import { confirmPrompt } from "./confirm.js";
import { Prompt } from "./core.js";
import { multiselectPrompt } from "./multiselect.js";
import { passwordPrompt } from "./password.js";
import { selectPrompt } from "./select.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick, type PromptHarness } from "./test-helpers.js";

function createLifecycleHarness() {
  vi.stubEnv("TERM", "xterm-256color");
  const harness = createPromptHarness();
  const controller = new AbortController();
  onTestFinished(() => controller.abort());
  return { ...harness, controller, signal: controller.signal };
}

function expectCleanup(harness: PromptHarness, signal: AbortSignal): void {
  expect(harness.input.listenerCount("keypress")).toBe(0);
  expect(harness.input.listenerCount("end")).toBe(0);
  expect(harness.input.listenerCount("close")).toBe(0);
  expect(harness.output.listenerCount("resize")).toBe(0);
  expect(getEventListeners(signal, "abort")).toHaveLength(0);
  expect(harness.rawModes.at(-1)).toBe(false);
  expect(harness.getOutput()).toContain("\x1b[?25l");
  expect(harness.getOutput().split("\x1b[?25h")).toHaveLength(2);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  { name: "text", prompt: textPrompt, submitted: "", typed: "abc" },
  { name: "password", prompt: passwordPrompt, submitted: "", typed: "abc" },
  { name: "select", prompt: selectPrompt<string>, submitted: "first", typed: "first" },
  { name: "confirm", prompt: confirmPrompt, submitted: true, typed: true },
  { name: "multiselect", prompt: multiselectPrompt<string>, submitted: [], typed: ["first"] }
])("$name TTY lifecycle", ({ prompt, submitted, typed }) => {
  const options = [{ value: "first", label: "First" }];

  it.each([
    ["Ctrl+D", ""],
    ["end", ""],
    ["end", "abc"],
    ["destroy", ""],
    ["destroy", "abc"]
  ])("cancels and cleans up on %s with input %j", async (ending, value) => {
    const harness = createLifecycleHarness();
    const { input, output, signal, controller } = harness;
    const settled = vi.fn();
    const result = prompt({ message: "Value?", options, input, output, signal });
    void result.then(settled);

    await tick();
    if (ending === "end") {
      input.end(value);
    } else {
      input.write(value);
      if (ending === "destroy") {
        input.destroy();
      } else {
        input.write("\x04");
      }
    }
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expectCleanup(harness, signal);
    const frames = [...output.frames];
    const rawModes = [...harness.rawModes];
    input.emit("close");
    input.emit("close");
    input.emit("keypress", "z", { name: "z" });
    output.emit("resize");
    controller.abort();
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expect(output.frames).toEqual(frames);
    expect(harness.rawModes).toEqual(rawModes);
    expectCleanup(harness, signal);
  });

  it.each(["submit", "cancel", "abort"])("preserves %s followed by stream closure", async (ending) => {
    const harness = createLifecycleHarness();
    const { input, output, signal, controller } = harness;
    const settled = vi.fn();
    const result = prompt({ message: "Value?", options, input, output, signal });
    void result.then(settled);

    await tick();
    if (ending === "abort") {
      controller.abort();
    } else {
      input.write(ending === "submit" ? "\r" : "\x03");
    }
    const frames = [...output.frames];
    const rawModes = [...harness.rawModes];
    input.end();
    input.destroy();
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(ending === "submit" ? submitted : CANCEL);
    expectCleanup(harness, signal);
    expect(output.frames).toEqual(frames);
    expect(harness.rawModes).toEqual(rawModes);
  });

  it("does not cancel Ctrl+D at the end of a nonempty readline buffer", async () => {
    const harness = createLifecycleHarness();
    const { input, output, signal } = harness;
    const settled = vi.fn();
    const result = prompt({ message: "Value?", options, input, output, signal });
    void result.then(settled);

    await tick();
    input.write("abc\x04");
    await tick();

    expect(settled).not.toHaveBeenCalled();
    expect(harness.getOutput()).not.toContain("\x1b[?25h");
    expect(harness.rawModes.at(-1)).toBe(true);
    input.write("\r");
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(typed);
    expectCleanup(harness, signal);
  });

  it("cancels Ctrl+D with a nonempty buffer on a dumb terminal", async () => {
    const harness = createLifecycleHarness();
    vi.stubEnv("TERM", "dumb");
    const { input, output, signal } = harness;
    const settled = vi.fn();
    void prompt({ message: "Value?", options, input, output, signal }).then(settled);

    await tick();
    input.write("abc\x04");
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expectCleanup(harness, signal);
  });

  it.each(["destroyed", "ended", "aborted"])("does not activate already %s input", async (ending) => {
    const { input, output, signal, controller, getOutput, rawModes } = createLifecycleHarness();
    if (ending === "destroyed") {
      input.destroy();
    } else if (ending === "ended") {
      input.end();
      input.resume();
    } else {
      controller.abort();
    }
    await tick();
    const settled = vi.fn();
    const result = prompt({ message: "Value?", options, input, output, signal });
    void result.then(settled);
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
    expect(input.listenerCount("keypress")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(output.listenerCount("resize")).toBe(0);
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });
});

describe("TTY finalization races", () => {
  it.each(["Ctrl+D", "submit", "cancel", "abort"])("finalizes once when %s triggers another close", async (ending) => {
    const harness = createLifecycleHarness();
    const { input, output, signal, controller } = harness;
    const prompt = new Prompt({ input, output, signal, initialValue: "value", render: (state) => state.state });
    const finalized = vi.fn(() => input.emit("close"));
    const submitted = vi.fn();
    const cancelled = vi.fn();
    const settled = vi.fn();
    prompt.on("finalize", finalized);
    prompt.on("submit", submitted);
    prompt.on("cancel", cancelled);
    void prompt.prompt().then(settled);

    await tick();
    if (ending === "abort") {
      controller.abort();
    } else {
      input.write(ending === "submit" ? "\r" : ending === "cancel" ? "\x03" : "\x04");
    }
    await tick();

    expect(finalized).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledExactlyOnceWith(ending === "submit" ? "value" : CANCEL);
    expect(submitted).toHaveBeenCalledTimes(ending === "submit" ? 1 : 0);
    expect(cancelled).toHaveBeenCalledTimes(ending === "submit" ? 0 : 1);
    expect(prompt.eventNames()).toEqual([]);
    expectCleanup(harness, signal);
  });

  it("cancels Ctrl+D with an initial value but an empty readline buffer", async () => {
    const harness = createLifecycleHarness();
    const { input, output, signal } = harness;
    const settled = vi.fn();
    void textPrompt({ message: "Value?", initialValue: "abc", input, output, signal }).then(settled);

    await tick();
    input.write("\x04");
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expectCleanup(harness, signal);
  });

  it("cancels EOF while a validation error is displayed", async () => {
    const harness = createLifecycleHarness();
    const { input, output, signal } = harness;
    const settled = vi.fn();
    void textPrompt({ message: "Value?", input, output, signal, validate: () => "Required" }).then(settled);

    await tick();
    input.write("\r");
    expect(harness.getOutput()).toContain("Required");
    input.end();
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expectCleanup(harness, signal);
  });
});

describe("non-TTY EOF controls", () => {
  it.each([
    ["text", "", textPrompt],
    ["text", "trailing text", textPrompt],
    ["password", "", passwordPrompt],
    ["password", "trailing text", passwordPrompt]
  ] as const)("returns %s EOF value %j", async (_name, value, prompt) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    const result = prompt({ message: "Value?", input, output });
    input.end(value);

    await expect(result).resolves.toBe(value);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it("preserves select rejection instead of cancelling closed non-TTY input", async () => {
    vi.stubEnv("POE_NO_PROMPT", "0");
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    input.destroy();
    await tick();

    await expect(selectPrompt({ message: "Value?", options: [{ value: "first", label: "First" }], input, output }))
      .rejects.toThrow("Interactive prompt requires a TTY");
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });
});
