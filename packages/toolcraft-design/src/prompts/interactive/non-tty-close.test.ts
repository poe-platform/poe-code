import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { password, text } from "../index.js";
import { CANCEL } from "./cancel-symbol.js";
import { passwordPrompt } from "./password.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick } from "./test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["textPrompt", textPrompt],
  ["passwordPrompt", passwordPrompt],
  ["text wrapper", text],
  ["password wrapper", password]
] as const)("%s non-TTY input close", (_name, prompt) => {
  it.each([
    ["destroy", "", false],
    ["destroy", "partial e\u0301😀", false],
    ["destroy", "partial e\u0301😀", true],
    ["close", "", false],
    ["close", "partial e\u0301😀", false],
    ["close", "partial e\u0301😀", true]
  ] as const)("cancels %s with input %j and signal=%s", async (ending, partial, withSignal) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.emit("end");
    });
    const controller = new AbortController();
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, ...(withSignal ? { signal: controller.signal } : {}) }).then(settled);

    await tick();
    input.write(partial);
    if (ending === "destroy") {
      input.destroy();
    } else {
      input.emit("close");
    }
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
    input.emit("close");
    controller.abort();
    await tick();
    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
  });

  it.each(["destroyed", "destroyed with buffered data", "consumed EOF"])("settles already %s without starting another input consumer", async (initialState) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.emit("end");
    });
    if (initialState === "consumed EOF") {
      input.end("already consumed");
      input.resume();
    } else {
      if (initialState === "destroyed with buffered data") {
        input.write("foreign buffer");
      }
      input.destroy();
    }
    await tick();
    const buffered = input.readableLength;
    const resume = vi.spyOn(input, "resume");
    const read = vi.spyOn(input, "read");
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output }).then(settled);
    await tick();

    expect(input.destroyed).toBe(true);
    expect(input.readableEnded).toBe(initialState === "consumed EOF");
    expect(settled).toHaveBeenCalledExactlyOnceWith(initialState === "consumed EOF" ? "" : CANCEL);
    expect(resume).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(input.readableLength).toBe(buffered);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each([
    ["line", "value\n", false, "value"],
    ["empty line", "\n", false, ""],
    ["partial EOF", "partial e\u0301😀", true, "partial e\u0301😀"],
    ["empty EOF", "", true, ""]
  ] as const)("preserves normal %s including automatic input destruction", async (_label, chunk, eof, expected) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.end();
    });
    const controller = new AbortController();
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);

    if (eof) {
      input.end(chunk);
    } else {
      input.write(chunk);
    }
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(expected);
    if (eof) {
      expect(input.readableEnded).toBe(true);
      expect(input.destroyed).toBe(true);
    }
    expect(input.listenerCount("close")).toBe(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    controller.abort();
    input.emit("close");
    await tick();
    expect(settled).toHaveBeenCalledExactlyOnceWith(expected);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each(["buffered e\u0301😀\n", "buffered e\u0301😀"])("reads unconsumed buffered input %j before EOF", async (chunk) => {
    const { input, output } = createPromptHarness({ tty: false });
    input.end(chunk);
    expect(input.readableEnded).toBe(false);
    expect(input.destroyed).toBe(false);
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output }).then(settled);
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith("buffered e\u0301😀");
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
  });

  it.each(["destroy", "close", "abort"])("cancels %s during readline setup without leaking late-installed listeners", async (ending) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.emit("end");
    });
    const controller = new AbortController();
    const resume = input.resume.bind(input);
    vi.spyOn(input, "resume").mockImplementationOnce(() => {
      if (ending === "destroy") {
        input.destroy();
      } else if (ending === "close") {
        input.emit("close");
      } else {
        controller.abort();
      }
      return resume();
    });
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expect(input.listenerCount("close")).toBe(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each(["close then line", "line then destroy", "close then abort", "abort then close", "queued EOF then close"])("settles once for %s", async (order) => {
    const { input, output } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.emit("end");
    });
    const controller = new AbortController();
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);

    await tick();
    if (order === "line then destroy") {
      input.write("value\n");
      input.destroy();
    } else if (order === "close then line") {
      input.emit("close");
      input.write("value\n");
    } else if (order === "abort then close") {
      controller.abort();
      input.emit("close");
    } else if (order === "close then abort") {
      input.emit("close");
      controller.abort();
    } else {
      input.end("partial");
      input.emit("close");
    }
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(order === "line then destroy" ? "value" : CANCEL);
    expect(input.listenerCount("close")).toBe(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it.each(["line", "close", "abort"])("preserves unrelated listeners and the remaining consumer after %s", async (ending) => {
    const { input, output } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.emit("end");
    });
    const controller = new AbortController();
    const foreignClose = vi.fn();
    const foreignData = vi.fn();
    const foreignEnd = vi.fn();
    const foreignAbort = vi.fn();
    input.on("close", foreignClose);
    input.on("data", foreignData);
    input.on("end", foreignEnd);
    controller.signal.addEventListener("abort", foreignAbort);
    const pause = input.pause.bind(input);
    const listenersAtClose: unknown[][] = [];
    vi.spyOn(input, "pause").mockImplementation(() => {
      listenersAtClose.push([input.listeners("close"), getEventListeners(controller.signal, "abort")]);
      return pause();
    });
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);

    await tick();
    if (ending === "line") {
      input.write("first\n");
    } else if (ending === "close") {
      input.write("partial");
      input.emit("close");
    } else {
      input.write("partial");
      controller.abort();
    }
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(ending === "line" ? "first" : CANCEL);
    expect(listenersAtClose).toEqual([[[foreignClose], [foreignAbort]]]);
    expect(input.listeners("close")).toEqual([foreignClose]);
    expect(input.listeners("data")).toEqual([foreignData]);
    expect(input.listeners("end")).toEqual([foreignEnd]);
    expect(getEventListeners(controller.signal, "abort")).toEqual([foreignAbort]);
    foreignData.mockClear();
    const remaining = "remaining e\u0301😀";
    input.write(remaining);
    expect(input.readableLength).toBe(Buffer.byteLength(remaining));
    expect(foreignData).not.toHaveBeenCalled();
    input.resume();
    await tick();

    expect(foreignData).toHaveBeenCalledExactlyOnceWith(Buffer.from(remaining));
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
