import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { confirm, multiselect, password, select, text } from "../index.js";
import { CANCEL } from "./cancel-symbol.js";
import { passwordPrompt } from "./password.js";
import { textPrompt } from "./text.js";
import { createPromptHarness, tick } from "./test-helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each([
  ["textPrompt", textPrompt],
  ["passwordPrompt", passwordPrompt],
  ["text wrapper", text],
  ["password wrapper", password]
] as const)("%s non-TTY abort", (_name, prompt) => {
  it.each(["", "partial e\u0301😀"])("cancels pending input %j without waiting for EOF", async (partial) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.end();
    });
    const controller = new AbortController();
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);

    await tick();
    input.write(partial);
    controller.abort();
    controller.abort();
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("keypress")).toBe(0);
    expect(output.listenerCount("resize")).toBe(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);

    input.end("later\n");
    await tick();
    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
  });

  it.each([
    ["line", "value\nrest", false, "value"],
    ["empty line", "\nrest", false, ""],
    ["partial EOF", "partial e\u0301😀", true, "partial e\u0301😀"],
    ["empty EOF", "", true, ""]
  ] as const)("preserves %s settlement and ignores late abort", async (_label, chunk, eof, expected) => {
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
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    controller.abort();
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(expected);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it("preserves pre-abort without attaching stream or signal listeners", async () => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    const controller = new AbortController();
    controller.abort();

    await expect(prompt({ message: "Value?", input, output, signal: controller.signal })).resolves.toBe(CANCEL);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each(["abort then line", "line then abort", "abort then EOF", "queued EOF then abort"])("settles once for %s", async (order) => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.end();
    });
    const controller = new AbortController();
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);

    await tick();
    if (order === "line then abort") {
      input.write("value\n");
      controller.abort();
    } else if (order === "queued EOF then abort") {
      input.end("partial");
      controller.abort();
    } else {
      controller.abort();
      if (order === "abort then line") {
        input.write("value\n");
      } else {
        input.end("partial");
      }
    }
    controller.abort();
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(order === "line then abort" ? "value" : CANCEL);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it("rechecks a signal aborted during readline setup", async () => {
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.end();
    });
    const controller = new AbortController();
    const resume = input.resume.bind(input);
    vi.spyOn(input, "resume").mockImplementationOnce(() => {
      controller.abort();
      return resume();
    });
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);
    await tick();

    expect(controller.signal.aborted).toBe(true);
    expect(settled).toHaveBeenCalledExactlyOnceWith(CANCEL);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });

  it.each(["line", "abort"])("removes only its own abort listener before closing readline on %s", async (ending) => {
    const { input, output } = createPromptHarness({ tty: false });
    onTestFinished(() => {
      input.end();
    });
    const controller = new AbortController();
    const unrelated = vi.fn();
    controller.signal.addEventListener("abort", unrelated);
    const pause = input.pause.bind(input);
    const listenersAtClose: unknown[][] = [];
    vi.spyOn(input, "pause").mockImplementation(() => {
      listenersAtClose.push(getEventListeners(controller.signal, "abort"));
      return pause();
    });
    const settled = vi.fn();
    void prompt({ message: "Value?", input, output, signal: controller.signal }).then(settled);

    await tick();
    if (ending === "line") {
      input.write("value\n");
    } else {
      input.write("partial");
      controller.abort();
    }
    await tick();

    expect(settled).toHaveBeenCalledExactlyOnceWith(ending === "line" ? "value" : CANCEL);
    expect(listenersAtClose).toEqual([[unrelated]]);
    expect(getEventListeners(controller.signal, "abort")).toEqual([unrelated]);
    controller.abort();
    expect(unrelated).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  { name: "select", prompt: select<string>, expected: "first" },
  { name: "confirm", prompt: confirm, expected: true },
  { name: "multiselect", prompt: multiselect<string>, expected: [] }
])("$name non-TTY controls", ({ prompt, expected }) => {
  it.each(["0", "1"])("preserves rejection/default behavior with POE_NO_PROMPT=%s", async (noPrompt) => {
    vi.stubEnv("POE_NO_PROMPT", noPrompt);
    const { input, output, getOutput, rawModes } = createPromptHarness({ tty: false });
    const controller = new AbortController();
    const result = prompt({ message: "Value?", options: [{ value: "first", label: "First" }], input, output, signal: controller.signal });

    if (noPrompt === "1") {
      await expect(result).resolves.toEqual(expected);
    } else {
      await expect(result).rejects.toThrow("Interactive prompt requires a TTY");
    }
    controller.abort();
    await tick();

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(input.listenerCount("data")).toBe(0);
    expect(getOutput()).toBe("");
    expect(rawModes).toEqual([]);
  });
});
