import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it, onTestFinished } from "vitest";

import { nativeModule, nativeModuleLoader } from "../tests/fixtures/native-module.js";

const fixture = new URL("../tests/fixtures/deep-numbering-carrier-worker.ts", import.meta.url);
let source: string;
beforeAll(async () => { source = await nativeModule(fixture); });
async function carrier(...args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", nativeModuleLoader, fileURLToPath(fixture), ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    onTestFinished(() => { if (child.exitCode === null) child.kill(); });
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject); child.stdin.on("error", reject);
    child.on("close", status => status === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(JSON.stringify(source) + "\n");
  });
}

for (const strict of [false, true])
it(`adds a list while preserving original admitted deep carriers; strict=${strict}`, async () => {
  const stdout = await carrier(strict ? "strict" : "transitional");
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true });
});

for (const strict of [false, true]) for (const scenario of ["story", "inactive-numbering", "unused-level"])
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"]) for (const action of ["edit", "dry"])
it(`executes original admitted deep numbering public parity; strict=${strict}; scenario=${scenario}; route=${route}; action=${action}`, async () => {
  const stdout = await carrier(strict ? "strict" : "transitional", scenario, route, action);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true, ...(scenario === "story" ? {} : { scenario }), route, dryRun: action === "dry", actualPublicDispatchAndRetention: true });
});

for (const strict of [false, true]) for (const scenario of ["inactive-numbering", "unused-level"])
it(`preserves original deep numbering interaction; strict=${strict}; scenario=${scenario}`, async () => {
  const stdout = await carrier(strict ? "strict" : "transitional", scenario);
  expect(JSON.parse(stdout)).toEqual({ strict, depth: 4096, exactNumberingPublicationAndCarrierRetention: true, scenario });
});
