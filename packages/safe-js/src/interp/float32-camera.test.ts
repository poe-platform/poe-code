import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import fixture from "./fixtures/float32-camera.json" with { type: "json" };

describe("Float32Array camera workflows", () => {
  it.each(fixture.cases)("matches the complete native trace for $caseId", async (entry) => {
    const result = await run(fixture.source, {
      entryPointArgs: [entry.fixture],
      randomSeed: 827,
      budget: new Budget({
        maxSteps: 600000,
        maxCallDepth: 128,
        stringLength: 65536,
        arrayLength: 8192,
        dataSize: 8000000
      })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const native = Function(
      `${fixture.source.slice("export default ".length)}\nreturn cameraWorkflow;`
    )() as (input: typeof entry.fixture) => unknown;
    expect(result.returnValue).toEqual(native(entry.fixture));
    expect(JSON.parse(JSON.stringify(result.returnValue))).toEqual(entry.expected);
  });
});
