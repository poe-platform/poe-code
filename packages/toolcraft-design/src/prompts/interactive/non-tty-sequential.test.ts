import { getEventListeners } from "node:events";
import { Readable, Stream } from "node:stream";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { password, text } from "../index.js";
import { CANCEL } from "./cancel-symbol.js";
import { createPromptHarness, tick } from "./test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each([["text", text], ["password", password]] as const)("sequential text → %s", (_name, second) => {
  it.each([0, 6, 7, 8, 9, 10, 13, 17])("preserves answers with a byte boundary at %s", async (split) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => { input.end(); });
    const bytes = Buffer.from("first\n😀second\n");
    const pending = (async () => [
      await text({ message: "First?", input, output }),
      await second({ message: "Second?", input, output })
    ])();

    input.write(bytes.subarray(0, split));
    await tick();
    input.end(bytes.subarray(split));

    await expect(pending).resolves.toEqual(["first", "😀second"]);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
    for (const event of ["readable", "data", "end", "close", "error"]) {
      expect(input.listenerCount(event)).toBe(0);
    }
  });
});

it.each([
  ["first\nsecond\n", ["first", "second"]],
  ["first\rsecond\r", ["first", "second"]],
  ["first\r\nsecond\r\n", ["first", "second"]],
  ["first\nsecond", ["first", "second"]],
  ["\n\n", ["", ""]],
  ["first\r\n\n", ["first", ""]],
  ["first\n", ["first", ""]],
  ["", ["", ""]]
])("reads prebuffered lines and EOF from %j", async (value, expected) => {
  const { input, output } = createPromptHarness({ tty: false });
  input.end(value);

  const answers = [
    await text({ message: "First?", input, output }),
    await password({ message: "Second?", input, output })
  ];

  expect(answers).toEqual(expected);
});

it.each([
  ["strings", ["first\n😀second\n"]],
  ["buffers", [Buffer.from("first\n😀second\n")]],
  ["bare CR strings", ["first\r😀second\r"]],
  ["CRLF buffers", [Buffer.from("first\r\n😀second\r\n")]],
  ["empty string between CRLF", ["first\r", "", "\n😀second\n"]],
  ["empty buffer between CRLF", [Buffer.from("first\r"), Buffer.alloc(0), Buffer.from("\n😀second\n")]]
])("preserves object-mode Readable.from %s", async (_name, chunks) => {
  const { output, getOutput } = createPromptHarness({ tty: false });
  const input = Readable.from(chunks);
  expect(input.readableObjectMode).toBe(true);

  expect([
    await text({ message: "First?", input, output }),
    await password({ message: "Second?", input, output })
  ]).toEqual(["first", "😀second"]);
  expect(getOutput()).toBe("");
});

it.each([
  ["utf8", false], ["utf8", true], ["utf16le", false], ["utf16le", true]
] as const)("preserves existing %s stream decoding and CR lookahead (split=%s)", async (encoding, split) => {
  const { input, output } = createPromptHarness({ tty: false });
  input.setEncoding(encoding);
  const setEncoding = vi.spyOn(input, "setEncoding");
  const bytes = Buffer.from("first\r😀e\u0301second\n", encoding);
  const pending = (async () => [
    await text({ message: "First?", input, output }),
    await password({ message: "Second?", input, output })
  ])();
  if (split) {
    for (const byte of bytes) {
      input.write(Buffer.from([byte]));
      await tick();
    }
    input.end();
  } else {
    input.end(bytes);
  }

  await expect(pending).resolves.toEqual(["first", "😀e\u0301second"]);
  expect(setEncoding).not.toHaveBeenCalled();
  expect(input.readableEncoding).toBe(encoding);
});

it.each(["\n", "\r", "\r\n"])("keeps three answers identical across every byte boundary with %j", async (separator) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1000);
  const bytes = Buffer.from(`😀first${separator}${separator}e\u0301second${separator}`);
  for (let split = 0; split <= bytes.length; split += 1) {
    const { input, output } = createPromptHarness({ tty: false });
    const pending = (async () => [
      await text({ message: "First?", input, output }),
      await password({ message: "Second?", input, output }),
      await text({ message: "Third?", input, output })
    ])();
    input.write(bytes.subarray(0, split));
    await tick();
    input.end(bytes.subarray(split));

    await expect(pending).resolves.toEqual(["😀first", "", "e\u0301second"]);
  }
});

it.each([90, 100, 101])("uses the 100ms CRLF delay across prompts at %sms", async (delay) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1000);
  const { input, output } = createPromptHarness({ tty: false });
  const first = text({ message: "First?", input, output });
  input.write("first\r");
  await expect(first).resolves.toBe("first");
  const second = password({ message: "Second?", input, output });

  vi.setSystemTime(1000 + delay);
  input.end("\nsecond\n");

  await expect(second).resolves.toBe(delay <= 100 ? "second" : "");
  if (delay > 100) {
    await expect(text({ message: "Third?", input, output })).resolves.toBe("second");
  }
});

it("consumes buffered CRLF framing before an idle gap between prompts", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1000);
  const { input, output } = createPromptHarness({ tty: false });
  input.end("first\r\nsecond\n");
  await expect(text({ message: "First?", input, output })).resolves.toBe("first");

  vi.setSystemTime(2000);

  await expect(password({ message: "Second?", input, output })).resolves.toBe("second");
});

it("leaves later bytes in the original stream after invalid-first validation", async () => {
  const { input, output, getOutput } = createPromptHarness({ tty: false });
  const controller = new AbortController();
  const error = new Error("Invalid default");
  const validate = vi.fn(() => {
    for (const event of ["readable", "data", "end", "close", "error"]) {
      expect(input.listenerCount(event)).toBe(0);
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    return error;
  });
  input.end("\n😀second\n");

  await expect(text({ message: "First?", input, output, defaultValue: "fallback", validate, signal: controller.signal })).rejects.toBe(error);

  expect(validate).toHaveBeenCalledExactlyOnceWith("fallback");
  expect(input.readableLength).toBe(Buffer.byteLength("😀second\n"));
  await expect(password({ message: "Second?", input, output })).resolves.toBe("😀second");
  expect(getOutput()).toBe("");
});

it("leaves later bytes available to a different input consumer", async () => {
  const { input, output } = createPromptHarness({ tty: false });
  input.end("first\n😀second\n");
  await expect(text({ message: "First?", input, output })).resolves.toBe("first");

  expect(input.read()).toEqual(Buffer.from("😀second\n"));
});

it.each([
  [[0xf0], "\n"],
  [[0xf0], "\r"],
  [[0xf0, 0x9f], "\r\n"],
  [[0xe2, 0x82], "\n"],
  [[0xc2], "\r"]
] as const)("preserves replacement text and framing after incomplete UTF-8 %j + %j", async (prefix, terminator) => {
  const { input, output } = createPromptHarness({ tty: false });
  input.end(Buffer.concat([Buffer.from(prefix), Buffer.from(`${terminator}second\n`)]));

  expect([
    await text({ message: "First?", input, output }),
    await password({ message: "Second?", input, output })
  ]).toEqual(["�", "second"]);
});

it("keeps unread answers paused when unrelated data listeners remain", async () => {
  const { input, output } = createPromptHarness({ tty: false });
  const foreignData = vi.fn();
  input.on("data", foreignData);
  const first = text({ message: "First?", input, output });
  input.write("first\n😀second\n");
  await expect(first).resolves.toBe("first");
  await tick();

  expect(input.listeners("data")).toEqual([foreignData]);
  expect(input.readableLength).toBe(Buffer.byteLength("😀second\n"));
  expect(foreignData).toHaveBeenCalledExactlyOnceWith(Buffer.from("first\n😀second\n"));
  foreignData.mockClear();
  input.end();
  await expect(password({ message: "Second?", input, output })).resolves.toBe("😀second");
  expect(foreignData).toHaveBeenCalledExactlyOnceWith(Buffer.from("😀second\n"));
});

it.each(["abort", "destroy", "error"])("cleans pending sequential input on %s without validation", async (ending) => {
  const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
  onTestFinished(() => { input.destroy(); });
  const controller = new AbortController();
  const error = new Error("Input failed");
  const validate = vi.fn();
  const foreignClose = vi.fn();
  const foreignError = vi.fn();
  const foreignAbort = vi.fn();
  input.on("close", foreignClose);
  input.on("error", foreignError);
  controller.signal.addEventListener("abort", foreignAbort);
  const first = text({ message: "First?", input, output });
  input.write("first\npartial");
  await expect(first).resolves.toBe("first");
  const second = password({ message: "Second?", input, output, signal: controller.signal, validate });
  const result = ending === "error" ? expect(second).rejects.toBe(error) : expect(second).resolves.toBe(CANCEL);
  await tick();

  if (ending === "abort") controller.abort();
  if (ending === "destroy") input.destroy();
  if (ending === "error") input.destroy(error);

  await result;
  await tick();
  expect(validate).not.toHaveBeenCalled();
  expect(input.listeners("close")).toEqual([foreignClose]);
  expect(input.listeners("error")).toEqual([foreignError]);
  expect(getEventListeners(controller.signal, "abort")).toEqual([foreignAbort]);
  expect(input.listenerCount("readable")).toBe(0);
  expect(input.listenerCount("data")).toBe(0);
  expect(input.listenerCount("end")).toBe(0);
  expect(getOutput()).toBe("");
  expect(rawModes).toEqual([]);
});

it.each(["line", "EOF", "abort", "error"])("retains legacy event-stream compatibility for %s", async (ending) => {
  const { output, getOutput } = createPromptHarness({ tty: false });
  const input = new Stream() as NodeJS.ReadableStream;
  input.readable = true;
  input.pause = vi.fn(() => input);
  input.resume = vi.fn(() => input);
  const controller = new AbortController();
  const error = new Error("Legacy input failed");
  const pending = text({ message: "Value?", input, output, signal: controller.signal });
  const result = ending === "error"
    ? expect(pending).rejects.toBe(error)
    : expect(pending).resolves.toBe(ending === "abort" ? CANCEL : "value");
  input.emit("data", Buffer.from("value"));
  if (ending === "line") input.emit("data", Buffer.from("\n"));
  if (ending === "EOF") input.emit("end");
  if (ending === "abort") controller.abort();
  if (ending === "error") input.emit("error", error);

  await result;
  for (const event of ["readable", "data", "end", "close", "error"]) {
    expect(input.listenerCount(event)).toBe(0);
  }
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  expect(getOutput()).toBe("");
});
