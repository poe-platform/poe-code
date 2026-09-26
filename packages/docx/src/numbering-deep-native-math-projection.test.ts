import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it, onTestFinished } from "vitest";

import { nativeModule, nativeModuleLoader } from "../tests/fixtures/native-module.js";

const fixture = new URL("../tests/fixtures/deep-numbering-native-math-worker.ts", import.meta.url);
let source: string;
beforeAll(async () => {
  source = await nativeModule(`import { run } from ${JSON.stringify(fixture.href)}; console.log(JSON.stringify(await run(process.argv.slice(2))));`);
});
async function projection(...args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", nativeModuleLoader, fileURLToPath(fixture), ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    onTestFinished(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.stdin.on("error", reject);
    child.on("close", status => status === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify(source) + "\n");
  });
}


for (const strict of [false, true])
it(`preserves admitted native math deeper than the original section scan through numbering projection; strict=${strict}`, async () => {
  const stdout = await projection(strict ? "strict" : "transitional", "1792");
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true });
});

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"])
for (const action of ["edit", "dry"])
it(`preserves native math through public deep numbering projection; strict=${strict}; route=${route}; action=${action}`, async () => {
  const stdout = await projection(strict ? "strict" : "transitional", "1792", route, action);
  expect(JSON.parse(stdout)).toEqual({ strict, radicals: 1792, exactNativeMathAndNumberingPreservation: true, route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});
