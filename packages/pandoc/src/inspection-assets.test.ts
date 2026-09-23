import { expect, it, vi } from "vitest";
import { inspectCommand, createPandocCommand } from "./index.js";

it.each([
  [["--list-highlight-languages"], "javascript\n"],
  [["--list-highlight-styles"], "pygments\n"],
  [["-D", "html"], "<!DOCTYPE html>"],
  [["-Dhtml5"], "$body$"],
  [["--print-default-template=html"], "$body$"],
  [["--print-default-template", "html5"], "$body$"],
  [["--print-default-data-file=abbreviations"], "Mr."],
  [["--print-highlight-style=pygments"], '"text-styles"'],
  [["--completion=bash"], "complete "],
  [["--bash-completion"], "complete "]
])("inspects bundled data without conversion: %s", (args, expected) => {
  expect(inspectCommand(args)).toContain(expected);
});

it("returns a structured highlight theme and identical template aliases", () => {
  expect(JSON.parse(inspectCommand(["--print-highlight-style", "pygments"])!)).toHaveProperty("text-styles.Keyword");
  expect(inspectCommand(["-D", "html"])).toBe(inspectCommand(["-D", "html5"]));
});

it("rejects missing, mixed and unknown inspection requests", () => {
  for (const args of [["-D"], ["--print-default-data-file"], ["--list-highlight-styles", "file"], ["-D", "html", "-o", "file"], ["--completion=zsh"], ["--print-default-data-file=../../secret"], ["--print-highlight-style=unknown"], ["-D", "unknown"]])
    expect(() => inspectCommand(args)).toThrow();
});

it("shell inspection never opens input, filesystem or output destinations", async () => {
  const readFile = vi.fn(() => { throw new Error("unexpected read"); });
  const writeFile = vi.fn(() => { throw new Error("unexpected publication"); });
  const stdout = { write: vi.fn(async (_bytes: Uint8Array) => {}) };
  const stderr = { write: vi.fn(async (_bytes: Uint8Array) => {}) };
  const stdin = { async *[Symbol.asyncIterator]() { throw new Error("unexpected stdin"); yield new Uint8Array(); } };
  for (const args of [["-D", "html"], ["--print-default-data-file=abbreviations"], ["--print-highlight-style=pygments"], ["--list-highlight-languages"], ["--completion=bash"], ["--help"], ["--version"]]) {
    expect(await createPandocCommand().execute({ args, signal: new AbortController().signal, stdout, stderr, stdin, readFile, writeFile })).toEqual({ exitCode: 0 });
  }
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(stderr.write).not.toHaveBeenCalled();
});

it("every advertised highlighting style has bundled inspection data", () => {
  expect(inspectCommand(["--list-highlight-styles"])).toBe("pygments\ntango\nespresso\nzenburn\nkate\nmonochrome\nbreezedark\nhaddock\n");
  for (const style of inspectCommand(["--list-highlight-styles"])!.trim().split("\n"))
    expect(JSON.parse(inspectCommand(["--print-highlight-style=" + style])!)).toHaveProperty("text-styles.Keyword");
  const completion = inspectCommand(["--completion=bash"])!;
  expect(completion).toContain("--metadata");
  expect(completion).not.toContain("--lua-filter");
  expect(completion).not.toContain("-6..6");
});
