import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { lint } from "../lint.js";
import { run } from "../run.js";
import {
  createSandboxArguments,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  isSandboxArguments,
  measureSandboxData
} from "./values.js";

describe("strict function arguments", () => {
  it("preserves argument objects across host boundary copies", () => {
    const args = createSandboxArguments([5, 6]);
    args.self = args;
    Object.freeze(args);
    const host = deepCopyFromSandbox(args) as Record<string, unknown>;
    const restored = deepCopyToSandbox(host);
    expect(host).not.toBe(args);
    expect(host.self).toBe(host);
    expect(host.length).toBe(2);
    expect(Object.isFrozen(host)).toBe(true);
    expect(isSandboxArguments(restored)).toBe(true);
    if (!isSandboxArguments(restored)) return;
    expect(restored.length).toBe(2);
    expect(restored.self).toBe(restored);
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it("passes array-like arguments to registered host functions", async () => {
    await expect(
      run(
        'import { count } from "test"; function read() { return count(arguments); } return read(5, 6);',
        {
          modules: { test: { count: (args: { length: number }) => args.length } }
        }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: 2 });
  });

  it("counts retained data in non-enumerable argument properties", () => {
    const args = createSandboxArguments([]);
    args.length = "x".repeat(100);
    expect(measureSandboxData([args])).toBeGreaterThanOrEqual(100);
  });

  it.each([
    "function read(value) { return [arguments.length, arguments[0], value]; } return read(5, 6);",
    "function read(value) { arguments[0] = 9; value = 7; return [arguments[0], value]; } return read(5);",
    "function read() { return [Array.isArray(arguments), Object.keys(arguments), [...arguments]]; } return read(5, 6);",
    "function read(value = arguments[1]) { return value; } return read(undefined, 5);",
    "function read(value) { const nested = () => arguments[0]; return nested; } return read(5)();",
    "function read() { function nested() { return arguments.length; } return [nested(), arguments.length]; } return read(5, 6);",
    "function read() { arguments.length = 1; return [arguments.length, arguments[1], [...arguments]]; } return read(5, 6);",
    "function read() { delete arguments[0]; return [Object.keys(arguments), arguments.length, [...arguments]]; } return read(5, 6);",
    "function read() { try { return arguments.callee; } catch (error) { return error.name; } } return read();",
    "async function read() { await Promise.resolve(); return arguments[0]; } return await read(5);",
    "function* read() { yield arguments[0]; yield arguments.length; } return Array.from(read(5, 6));"
  ])("matches native JavaScript: %s", async (source) => {
    const expected = structuredClone(
      await runInNewContext(`(async () => { "use strict"; ${source} })()`)
    );
    expect(lint(source).filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    await expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: expected });
  });
});
