import { expect, it } from "vitest";
import { nativeModule, nativeModuleLoader } from "../tests/fixtures/native-module.js";
import { useNativeProcess } from "../tests/native-process.js";

const fixture = new URL("../tests/fixtures/deep-numbering-carrier-worker.ts", import.meta.url);
const execute = useNativeProcess(["--input-type=module", "-e", nativeModuleLoader], await nativeModule(fixture));

for (const strict of [false, true])
it(`adds a list while preserving original admitted deep carriers; strict=${strict}`, async () => {
  const observed = await execute([strict ? "strict" : "transitional"]);
  expect(observed).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true });
});

for (const strict of [false, true]) for (const scenario of ["story", "inactive-numbering", "unused-level"])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const action of ["edit", "dry"])
it(`executes original admitted deep numbering public parity; strict=${strict}; scenario=${scenario}; route=${route}; action=${action}`, async () => {
  const observed = await execute([strict ? "strict" : "transitional", scenario, route, action]);
  expect(observed).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true, ...(scenario === "story" ? {} : { scenario }), route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});

for (const strict of [false, true]) for (const scenario of ["inactive-numbering", "unused-level"])
it(`preserves original deep numbering interaction; strict=${strict}; scenario=${scenario}`, async () => {
  const observed = await execute([strict ? "strict" : "transitional", scenario]);
  expect(observed).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true, scenario });
});
