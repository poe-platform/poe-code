import { expect, it } from "vitest";
import { mainThreadFixture } from "../tests/main-thread.js";

const run = mainThreadFixture(new URL("../tests/fixtures/deep-numbering-native-math-worker.ts", import.meta.url));

for (const strict of [false, true])
it(`preserves deeply nested native math beside list allocation; strict=${strict}`, async () => {
  const stdout = await run([strict ? "strict" : "transitional"]);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1280, exactNativeMathAndNumberingPreservation: true });
});

for (const strict of [false, true]) for (const radicals of [32, 1280])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const action of ["edit", "dry"])
it(`preserves native math under default/trusted public list dispatch; strict=${strict}; radicals=${radicals}; route=${route}; action=${action}`, async () => {
  const stdout = await run([strict ? "strict" : "transitional", String(radicals), route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});
