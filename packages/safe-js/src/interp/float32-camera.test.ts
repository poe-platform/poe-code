import { describe, expect, it } from "vitest";
import { run } from "../run.js";
import { Budget } from "./budget.js";
import fixture from "./fixtures/float32-camera.json" with { type: "json" };

describe("Float32Array camera workflows", () => {
  const native = Function(
    `${fixture.source.slice("export default ".length)}\nreturn cameraWorkflow;`
  )() as (input: (typeof fixture.cases)[number]["fixture"]) => unknown;

  it.each(fixture.cases.map(entry => [entry.caseId, entry] as const))("preserves the complete recorded native trace for %s", (_caseId, entry) => {
    expect(JSON.parse(JSON.stringify(native(entry.fixture)))).toEqual(entry.expected);
  });

  const batches = fixture.cases.flatMap((entry) => {
    const entries = [];
    for (let offset = 0; offset < entry.fixture.points.length; offset += 2) {
      const points = entry.fixture.points.slice(offset, offset + 2);
      const trace = entry.expected.trace.flatMap((event) => {
        const [stage, sample] = event.stage?.split(":") ?? [];
        if (sample === undefined) return [event];
        const index = Number(sample);
        if (index < offset || index >= offset + points.length) return [];
        return [{ ...event, stage: `${stage}:${index - offset}` }];
      });
      entries.push({
        caseId: `${entry.caseId}:samples-${offset}-${offset + points.length - 1}`,
        fixture: { ...entry.fixture, points },
        expected: {
          ...entry.expected,
          semantic: {
            ...entry.expected.semantic,
            samples: entry.expected.semantic.samples.slice(offset, offset + points.length)
          },
          trace
        }
      });
    }
    return entries;
  });

  it.each(batches.map(entry => [entry.caseId, entry] as const))("matches the complete native and recorded batch trace for %s", async (_caseId, entry) => {
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
    expect(result.returnValue).toEqual(native(entry.fixture));
    expect(JSON.parse(JSON.stringify(result.returnValue))).toEqual(entry.expected);
  });
});
