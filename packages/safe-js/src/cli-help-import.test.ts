import { expect, it, vi } from "vitest";

const loadInterpreter = vi.hoisted(() => vi.fn(() => {
  throw new Error("Help must not initialize the interpreter.");
}));
vi.mock("./interp/globals.js", loadInterpreter);

it("prints help without loading interpreter globals", async () => {
  const { runCli } = await import("./cli.js");
  const output: string[] = [];
  const stream = { write: (text: string) => { output.push(text); return true; } };
  expect(await runCli(["--help"], { stdout: stream, stderr: stream })).toBe(0);
  expect(output.join("")).toContain("Usage: poe-safe-js");
  expect(loadInterpreter).not.toHaveBeenCalled();
});
