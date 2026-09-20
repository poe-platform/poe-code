import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

for (const strict of [false, true])
it(`preserves admitted native math deeper than the original section scan through numbering projection; strict=${strict}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-native-math-worker.ts", import.meta.url)), strict ? "strict" : "transitional", "1792"]);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true });
});

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const action of ["edit", "dry"])
it(`preserves native math through public deep numbering projection; strict=${strict}; route=${route}; action=${action}`, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../tests/fixtures/deep-numbering-native-math-worker.ts", import.meta.url)), strict ? "strict" : "transitional", "1792", route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});
