import assert from "node:assert/strict";
import test from "node:test";
import { compilePattern } from "./shell/pattern.js";

for (const steps of [0, 127]) {
  for (const [pattern, pathnameMatch] of [
    ["*.log", false],
    ["logs/*.log", true],
    ["logs?run.log", false],
    ["logs[/]run.log", true],
    ["logs*", true],
    ["@(*.log|missing)", false],
    ["logs/@(*.log|missing)", true],
    ["!(keep.txt)", true],
  ] as const) {
    test(`pathname pattern ${pattern} (checkpoint=${steps})`, async () => {
      for (const pathname of [false, true]) {
        const work = { signal: new AbortController().signal, remaining: 10000, steps: 0, exhausted(): never { throw new Error("exhausted"); } };
        const match = await compilePattern(pattern, work, false, true, pathname);
        work.steps = steps;
        assert.equal(await match("logs/run.log"), pathname ? pathnameMatch : true);
      }
    });
  }
}
