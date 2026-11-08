import { describe, expect, it } from "vitest";
import { createSink } from "../test/sinks.js";
import { runCli } from "./cli.js";
import { lint } from "./lint/index.js";

describe("dynamic source through the default CLI lint gate", () => {
  it.each([
    ['return Function("a", "return a + 1")(2);', 3],
    ['const a = 2; return eval("a + 1");', 3],
    ['return (0, eval)("1 + 2");', 3],
    ['return Function("a", "return eval(\\"a + 1\\")")(2);', 3],
    ['return Function("return [typeof process, typeof require, typeof Buffer].join(\\",\\")")();', "undefined,undefined,undefined"],
    ['return eval("[typeof process, typeof require, typeof Buffer].join(\\",\\")");', "undefined,undefined,undefined"]
  ])("executes %s without suppressing lint", async (source, expected) => {
    expect(lint(source)).toEqual([]);
    const stdout = createSink();
    const stderr = createSink();
    const code = await runCli(["dynamic.ajs"], {
      readFile: async () => source,
      stat: async () => ({ isFile: () => true }),
      stdout,
      stderr
    });
    expect(stderr.output()).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(stdout.output())).toEqual({ ok: true, returnValue: expected });
  });
});
