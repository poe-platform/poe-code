import { describe, expect, it } from "vitest";

import experimentExample from "../examples/experiment.md";

import { createBrokenPipeSink, createSink } from "../test/sinks.js";
import { runExampleFile } from "./example-runner.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("runExampleFile", () => {
  it.each([
    ["script", experimentExample],
    ["fallback", experimentExample.slice(0, experimentExample.indexOf("```js"))]
  ])("retains experiment metrics and attempt selection in the %s path", async (_kind, source) => {
    const stdout = createSink();
    const stderr = createSink();
    const exitCode = await runExampleFile("/repo/experiment.md", {
      readFile: async () => source,
      stdout,
      stderr
    });
    expect(exitCode).toBe(0);
    expect(stderr.output()).toBe("");
    const entries = stdout
      .output()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.slice(0, 3)).toMatchObject([
      { type: "event", name: "attempt.discarded", payload: { attempt: 1, score: 9 } },
      { type: "event", name: "attempt.kept", payload: { attempt: 2, score: 12 } },
      { type: "event", name: "attempt.kept", payload: { attempt: 3, score: 13 } }
    ]);
    expect(entries[3]).toEqual({
      ok: true,
      returnValue: { kind: "experiment", kept: 2, baseline: 10 }
    });
    expect(entries).toHaveLength(4);
  });

  it("removes Git from the example registry", async () => {
    const stdout = createSink();
    const stderr = createSink();
    const exitCode = await runExampleFile("/repo/example.md", {
      readFile: async () =>
        ["```js", 'import { checkpoint } from "git";', "return typeof checkpoint;", "```"].join(
          "\n"
        ),
      stdout,
      stderr
    });
    expect(exitCode).toBe(1);
    expect(stderr.output()).toContain("Unknown module 'git'.");
    expect(stdout.output()).toBe("");
  });

  it("prints own messages from thrown non-Error values", async () => {
    const stderr = createSink();

    const exitCode = await runExampleFile("/repo/example.md", {
      readFile: async () => {
        throw { message: "configured failure" };
      },
      stderr,
      stdout: createSink()
    });

    expect(exitCode).toBe(1);
    expect(stderr.output()).toBe("configured failure\n");
  });

  it("ignores inherited messages from thrown non-Error values", async () => {
    const stderr = createSink();

    await withObjectPrototypeProperties({ message: "polluted failure" }, async () => {
      const exitCode = await runExampleFile("/repo/example.md", {
        readFile: async () => {
          throw {};
        },
        stderr,
        stdout: createSink()
      });

      expect(exitCode).toBe(1);
      expect(stderr.output()).toBe("[object Object]\n");
    });
  });

  it("treats stdout EPIPE as a clean early exit", async () => {
    const stdout = createBrokenPipeSink({ failAfterWrites: 1 });
    const stderr = createSink();
    const source = [
      "```js",
      'import { info } from "log";',
      'info("one");',
      'info("two");',
      "return 1;",
      "```"
    ].join("\n");

    const exitCode = await runExampleFile("/repo/example.md", {
      readFile: async () => source,
      stderr,
      stdout
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      type: "info",
      args: ["one"]
    });
    expect(stderr.output()).toBe("");
  });
});
