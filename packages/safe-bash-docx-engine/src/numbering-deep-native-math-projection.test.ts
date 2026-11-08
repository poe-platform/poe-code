import { expect, it } from "vitest";
import { mainThreadFixture } from "../tests/main-thread.js";

const run = mainThreadFixture(new URL("../../safe-bash-command-docx/tests/tests/fixtures/deep-numbering-native-math-worker.js", import.meta.url));

for (const strict of [false, true])
it(`preserves admitted native math deeper than the original section scan through numbering projection; strict=${strict}`, async () => {
  const stdout = await run([strict ? "strict" : "transitional", "1792"]);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true });
});

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const action of ["edit", "dry"])
it(`preserves native math through public deep numbering projection; strict=${strict}; route=${route}; action=${action}`, async () => {
  const stdout = await run([strict ? "strict" : "transitional", "1792", route, action]);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});
