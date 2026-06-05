import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace, runRules, type LintFs, type Violation } from "./index.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const baselinePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../baseline.json");

const nodeFs: LintFs = {
  readFile: (p) => readFile(p, "utf8"),
  readdir: (p) =>
    readdir(p, { withFileTypes: true }) as Promise<{ name: string; isDirectory(): boolean }[]>
};

function sortViolations(violations: Violation[]): Violation[] {
  const key = (v: Violation) =>
    [v.rule, v.package, v.via ?? "", JSON.stringify(v.detail)].join(" ");
  return [...violations].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

describe("repo baseline", () => {
  it("finds exactly the committed baseline violations", async () => {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as {
      violations: Violation[];
    };
    const model = await loadWorkspace(nodeFs, rootDir);
    // No BuildView: build-aware rules are skipped, so the baseline stays stable
    // whether or not the bundle has been built.
    const result = runRules(model);
    expect(sortViolations(result.violations)).toEqual(sortViolations(baseline.violations));
  });
});
