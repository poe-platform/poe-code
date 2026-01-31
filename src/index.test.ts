import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isCliInvocation } from "./index.js";

describe("entrypoint module", () => {
  it("imports CLI program with ESM extension", async () => {
    const sourcePath = path.join(process.cwd(), "src", "index.ts");
    const source = await readFile(sourcePath, "utf8");
    expect(source).toContain('./cli/program.js');
  });

  it("detects direct invocation path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/index.js"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(true);
  });

  it("detects invocation through symlinked path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/usr/bin/poe-code"];
    const resolver = (value: string) =>
      value === "/usr/bin/poe-code" ? "/app/dist/index.js" : value;
    expect(isCliInvocation(argv, moduleUrl, resolver)).toBe(true);
  });
});
