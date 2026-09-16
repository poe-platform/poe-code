import {expect, it} from "vitest";
import {inspectCommand} from "./inspection.js";
it("returns help/version without conversion capabilities and rejects mixed modes", () => {
  expect(inspectCommand(["--help", "-h"])).toContain("--yes");
  expect(inspectCommand(["--help"])).toContain("serif/sans unavailable");
  expect(inspectCommand(["--version"])).toContain("TypeScript");
  expect(inspectCommand(["-f", "commonmark"])).toBeUndefined();
  expect(inspectCommand(["-f", "commonmark", "-t", "plain", "-o", "--help"])).toBeUndefined();
  expect(inspectCommand(["-f", "commonmark", "-t", "plain", "--", "--help", "--version", "--list-input-formats"])).toBeUndefined();
  for (const args of [["--help", "-o", "out"], ["--version", "file"], ["--list-input-formats", "file"]])
    expect(() => inspectCommand(args)).toThrow();
});
