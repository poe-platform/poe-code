import { expect, it } from "vitest";
import { useNativeProcess } from "../tests/native-process.js";

const execute = useNativeProcess(["--import", "tsx", "--input-type=module", "-e", `
import { run } from ${JSON.stringify(new URL("../tests/fixtures/deep-numbering-native-math-worker.ts", import.meta.url).href)};
import { createInterface } from "node:readline";
console.log(JSON.stringify({ ready: true }));
for await (const line of createInterface({ input: process.stdin })) {
  console.log(JSON.stringify(await run(JSON.parse(line))));
}
`]);

for (const strict of [false, true])
it(`preserves admitted native math deeper than the original section scan through numbering projection; strict=${strict}`, async () => {
  const result = await execute([strict ? "strict" : "transitional", "1792"]);
  expect(result).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true });
});

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const action of ["edit", "dry"])
it(`preserves native math through public deep numbering projection; strict=${strict}; route=${route}; action=${action}`, async () => {
  const result = await execute([strict ? "strict" : "transitional", "1792", route, action]);
  expect(result).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});
