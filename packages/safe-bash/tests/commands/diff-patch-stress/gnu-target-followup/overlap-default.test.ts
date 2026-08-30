import test from "node:test";
import { assertDefaultParity } from "./evidence.js";
import { overlapDefaultProbes } from "./fixtures.js";

for (const probe of overlapDefaultProbes) test(`GNU default partial publication and diagnostics: ${probe.id}`, async () => {
  await assertDefaultParity(probe);
});
