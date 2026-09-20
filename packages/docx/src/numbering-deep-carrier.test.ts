import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

for (const strict of [false, true])
it(`adds a list while preserving original admitted deep carriers; strict=${strict}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-carrier-worker.ts", import.meta.url)), strict ? "strict" : "transitional"]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true });
});

for (const strict of [false, true]) for (const scenario of ["story", "inactive-numbering", "unused-level"])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const action of ["edit", "dry"])
it(`executes original admitted deep numbering public parity; strict=${strict}; scenario=${scenario}; route=${route}; action=${action}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-carrier-worker.ts", import.meta.url)), strict ? "strict" : "transitional", scenario, route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true, ...(scenario === "story" ? {} : { scenario }), route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});

for (const strict of [false, true]) for (const scenario of ["inactive-numbering", "unused-level"])
it(`preserves original deep numbering interaction; strict=${strict}; scenario=${scenario}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-carrier-worker.ts", import.meta.url)), strict ? "strict" : "transitional", scenario]);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true, scenario });
});
