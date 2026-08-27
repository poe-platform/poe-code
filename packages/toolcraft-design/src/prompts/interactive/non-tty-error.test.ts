import { getEventListeners } from "node:events";
import * as readline from "node:readline";
import { Stream } from "node:stream";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { password, text } from "../index.js";
import { CANCEL } from "./cancel-symbol.js";
import { Prompt } from "./core.js";
import { createPromptHarness, tick } from "./test-helpers.js";

vi.mock("node:readline", async (importOriginal) => {
  const actual = await importOriginal<typeof readline>();
  return { ...actual, createInterface: vi.fn(actual.createInterface) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["text", text],
  ["password", password]
] as const)("%s non-TTY input errors", (_name, prompt) => {
  it.each(["", "private e\u0301🔒value"])("rejects the original error for pending input %j", async (partial) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => { input.end(); });
    const controller = new AbortController();
    const error = new Error(partial ? "" : "Input failed");
    const validate = vi.fn();
    const emit = vi.spyOn(Prompt.prototype, "emit");
    const resolved = vi.fn();
    const rejected = vi.fn();
    void prompt({
      message: "Value?", input, output, validate,
      signal: partial ? controller.signal : undefined
    }).then(resolved, rejected);
    input.write(partial);

    expect(() => input.emit("error", error)).not.toThrow();
    await tick();

    expect(rejected).toHaveBeenCalledExactlyOnceWith(error);
    expect(resolved).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);

    controller.abort();
    input.end("later\n");
    await tick();
    expect(rejected).toHaveBeenCalledExactlyOnceWith(error);
    expect(resolved).not.toHaveBeenCalled();
  });

  it.each(["", "private e\u0301🔒value"])("handles real destroy(error) with pending input %j", async (partial) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    const controller = new AbortController();
    const error = new Error("Input failed");
    const validate = vi.fn();
    const pending = prompt({
      message: "Value?", input, output, validate,
      signal: partial ? controller.signal : undefined
    });
    const rejected = expect(pending).rejects.toBe(error);
    input.write(partial);

    input.destroy(error);

    await rejected;
    await tick();
    expect(input.destroyed).toBe(true);
    expect(input.closed).toBe(true);
    expect(input.errored).toBe(error);
    expect(validate).not.toHaveBeenCalled();
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
    expect(input.listenerCount("close")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });
});

it.each(["error", "line", "EOF", "abort", "close"])("removes only owned legacy readline listeners on %s settlement", async (ending) => {
  const { output, getOutput, rawModes } = createPromptHarness({ tty: false });
  const input = new Stream() as NodeJS.ReadableStream;
  input.readable = true;
  input.pause = vi.fn(() => input);
  input.resume = vi.fn(() => input);
  const controller = new AbortController();
  const foreignInputError = vi.fn();
  const foreignInputClose = vi.fn();
  const foreignData = vi.fn();
  const foreignEnd = vi.fn();
  const foreignAbort = vi.fn();
  input.on("error", foreignInputError);
  input.on("close", foreignInputClose);
  input.on("data", foreignData);
  input.on("end", foreignEnd);
  controller.signal.addEventListener("abort", foreignAbort);
  const reader = readline.createInterface({ input, terminal: false });
  onTestFinished(() => {
    reader.close();
    input.emit("end");
  });
  vi.spyOn(readline, "createInterface").mockReturnValueOnce(reader);
  const foreignReaderError = vi.fn();
  const foreignLine = vi.fn();
  const foreignReaderClose = vi.fn();
  reader.on("error", foreignReaderError);
  reader.on("line", foreignLine);
  reader.on("close", foreignReaderClose);
  const readerCloseListeners = reader.listeners("close");
  const close = reader.close.bind(reader);
  const listenersAtClose: unknown[][] = [];
  vi.spyOn(reader, "close").mockImplementation(() => {
    listenersAtClose.push([
      reader.listeners("error"), reader.listeners("line"), reader.listeners("close"),
      input.listeners("close"), getEventListeners(controller.signal, "abort")
    ]);
    close();
  });
  const error = new Error("Input failed");
  const rawValue = "private e\u0301🔒value";
  const validate = vi.fn();
  const resolved = vi.fn();
  const rejected = vi.fn();
  void text({ message: "Value?", input, output, signal: controller.signal, validate }).then(resolved, rejected);
  input.emit("data", Buffer.from(rawValue));

  if (ending === "error") input.emit("error", error);
  if (ending === "line") input.emit("data", Buffer.from("\n"));
  if (ending === "EOF") input.emit("end");
  if (ending === "abort") controller.abort();
  if (ending === "close") input.emit("close");
  await tick();

  expect(reader.listeners("error")).toEqual([foreignReaderError]);
  expect(reader.listeners("line")).toEqual([foreignLine]);
  expect(reader.listeners("close")).toEqual([foreignReaderClose]);
  expect(input.listeners("error")).toEqual([foreignInputError]);
  expect(input.listeners("close")).toEqual([foreignInputClose]);
  expect(input.listeners("data")).toEqual([foreignData]);
  expect(input.listeners("end")).toEqual([foreignEnd]);
  expect(getEventListeners(controller.signal, "abort")).toEqual([foreignAbort]);
  expect(listenersAtClose.at(-1)).toEqual([
    [foreignReaderError], [foreignLine], ending === "EOF" ? [foreignReaderClose] : readerCloseListeners,
    [foreignInputClose], [foreignAbort]
  ]);

  const laterError = new Error("Later error");
  input.emit("error", laterError);
  reader.emit("error", laterError);
  reader.emit("line", "later");
  input.emit("close");
  controller.abort();
  await tick();

  if (ending === "error") {
    expect(rejected).toHaveBeenCalledExactlyOnceWith(error);
    expect(resolved).not.toHaveBeenCalled();
  } else {
    expect(resolved).toHaveBeenCalledExactlyOnceWith(ending === "line" || ending === "EOF" ? rawValue : CANCEL);
    expect(rejected).not.toHaveBeenCalled();
  }
  if (ending === "line" || ending === "EOF") {
    expect(validate).toHaveBeenCalledExactlyOnceWith(rawValue);
  } else {
    expect(validate).not.toHaveBeenCalled();
  }
  expect(foreignInputError).toHaveBeenLastCalledWith(laterError);
  expect(foreignReaderError).toHaveBeenLastCalledWith(laterError);
  expect(foreignLine).toHaveBeenLastCalledWith("later");
  expect(foreignReaderClose).toHaveBeenCalledTimes(1);
  expect(getOutput()).toBe("");
  expect(rawModes).toEqual([]);
});
