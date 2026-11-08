import { expect, it } from "vitest";
import { createSink } from "../test/sinks.js";
import { runCli } from "./cli.js";

// Native parser stack capacity varies across Node and Vitest. Exercise the
// unlocated error contract deterministically at the CLI's startup boundary.
it("renders an unlocated source error without fabricating coordinates or exposing its stack", async () => {
  const stderr = createSink();
  const error = Object.assign(new RangeError("Maximum call stack size exceeded"), {
    filename: "nested.ajs"
  });
  error.stack = "RangeError: Maximum call stack size exceeded\n    at parser (/host/private/parser.ts:10:2)";
  expect(await runCli(["nested.ajs"], {
    cwd: "/guest", readFile: async () => { throw error; },
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(1);
  expect(stderr.output()).toBe("RangeError: nested.ajs\n\nMaximum call stack size exceeded\n");
});

it.each([new Error("read failed"), "read failed"])("preserves an ordinary startup failure: %s", async error => {
  const stderr = createSink();
  expect(await runCli(["input.ajs"], {
    cwd: "/guest", readFile: async () => { throw error; },
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(1);
  expect(stderr.output()).toBe("read failed\n");
});

it("runs the shallow neighboring source", async () => {
  const stderr = createSink();
  expect(await runCli(["nested.ajs"], {
    cwd: "/guest", readFile: async () => "void (((1 + 2)));",
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(0);
  expect(stderr.output()).toBe("");
});
