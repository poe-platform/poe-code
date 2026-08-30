import { after, test } from "node:test";
import { writeFile } from "node:fs/promises";
import { cases } from "./fixtures.js";
import { probe, verify } from "./helpers.js";

const observations: Awaited<ReturnType<typeof probe>>[] = [];
after(async () => {
  if (process.env.CANDIDATE_EVIDENCE) await writeFile(process.env.CANDIDATE_EVIDENCE, `${JSON.stringify(observations, null, 2)}\n`, { flag: "wx" });
});
for (const { fixture, mode } of cases) {
  test(`${fixture.policy ? "selected-path safety" : "GNU candidate parity"}: ${fixture.name} [${mode}]`, { timeout: 10_000 }, async () => {
    const observation = await probe(fixture, mode);
    observations.push(observation);
    verify(fixture, mode, observation);
  });
}
