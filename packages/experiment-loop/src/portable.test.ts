import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs a complete experiment simulation from the portable public entrypoints", async () => {
  const bundled = await build({ stdin: { resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    contents: 'export * from "./index.ts"; export * from "./testing/index.ts";' },
    bundle: true, write: false, platform: "browser", conditions: ["workerd"], format: "iife", globalName: "experiment", logLevel: "silent" });
  const runtime = new Function(`${bundled.outputFiles[0].text}; return experiment;`)();
  const simulation = runtime.createExperimentLoopSimulation({ maxExperiments: 1,
    metricResults: { "node scripts/metric-tests.mjs": [runtime.metricResult({ score: 1 }), runtime.metricResult({ score: 2 })] },
    turns: [runtime.agentOutput({ stdout: "Improved café." })] });
  const result = await simulation.run();
  expect(result.result.experimentsCompleted).toBe(1);
  expect(await result.readJournal()).toHaveLength(1);
  expect(result.prompts[0]).toContain("Metrics");
});
