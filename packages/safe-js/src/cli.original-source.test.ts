import { expect, it } from "vitest";
import { createSink } from "../test/sinks.js";
import { runCli } from "./cli.js";

it("renders startup syntax errors from the original source and supplied filename", async () => {
  const stderr = createSink();
  const code = await runCli(["broken.ajs"], {
    cwd: "/guest", readFile: async () => 'const 𐐀 = 1;\r\nconst broken = );',
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  });
  expect(code).toBe(2);
  expect(stderr.output()).toContain("ParseError: broken.ajs:2:16");
  expect(stderr.output()).toContain("1 | const 𐐀 = 1;\n2 | const broken = );\n  |                ^");
  expect(stderr.output()).not.toContain("/guest/");
});

it("executes the valid neighboring declaration", async () => {
  const stderr = createSink();
  expect(await runCli(["valid.ajs"], {
    cwd: "/guest", readFile: async () => 'const 𐐀 = 1;\r\nvoid (𐐀 + 2);',
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(0);
  expect(stderr.output()).toBe("");
});

it("keeps a guest-thrown SyntaxError a runtime error", async () => {
  const stderr = createSink();
  expect(await runCli(["runtime.ajs"], {
    cwd: "/guest", readFile: async () => 'throw new SyntaxError("guest failure")',
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(1);
  expect(stderr.output()).toContain("guest failure");
  expect(stderr.output()).not.toContain("/guest/");
});

it.each([false, true])("renders lexer failures before lint suppression scanning (fix=%j)", async fix => {
  const stderr = createSink();
  const code = await runCli(["broken.ajs", ...(fix ? ["--fix"] : [])], {
    cwd: "/guest", readFile: async () => "/a\r\n/",
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink(),
    writeFile: async () => { throw new Error("Invalid source must not be rewritten"); }
  });
  expect(code).toBe(2);
  expect(stderr.output()).toContain("ParseError: broken.ajs:1:3");
  expect(stderr.output()).toContain("1 | /a\n2 | /\n  |   ^");
  expect(stderr.output()).not.toContain("/guest/");
});
