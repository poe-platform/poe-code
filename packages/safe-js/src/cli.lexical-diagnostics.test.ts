import { expect, it } from "vitest";
import { createSink } from "../test/sinks.js";
import { runCli } from "./cli.js";

it.each(["agent", "module"])("renders %s syntax diagnostics from original source", async grammar => {
  const stderr = createSink();
  const stdout = createSink();
  const code = await runCli([...(grammar === "module" ? ["--source-type", "module"] : []), "broken.ajs"], {
    cwd: "/guest", readFile: async () => 'const 𐐀 = 1;\r\nconst broken = );',
    stat: async () => ({ isFile: () => true }), stderr, stdout
  });
  expect(code).toBe(2);
  expect(stdout.output()).toBe("");
  expect(stderr.output()).toContain("ParseError: broken.ajs:2:16");
  expect(stderr.output()).not.toContain("/guest/");
  expect(stderr.output()).toContain("1 | const 𐐀 = 1;\n2 | const broken = );\n  |                ^");
  expect(stderr.output()).not.toContain("node_modules");
});

it.each(["agent", "module"])("executes the valid %s neighbor", async grammar => {
  const stderr = createSink();
  expect(await runCli([...(grammar === "module" ? ["--source-type", "module"] : []), "valid.ajs"], {
    cwd: "/guest", readFile: async () => 'const 𐐀 = 1;\r\nconst valid = 2; void (𐐀 + valid);',
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(0);
  expect(stderr.output()).toBe("");
});

it("keeps guest-thrown SyntaxError a runtime failure", async () => {
  const stderr = createSink();
  expect(await runCli(["runtime.ajs"], {
    cwd: "/guest", readFile: async () => 'throw new SyntaxError("guest failure")',
    stat: async () => ({ isFile: () => true }), stderr, stdout: createSink()
  })).toBe(1);
  expect(stderr.output()).toContain("guest failure");
});
