import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

export function runNativeTests(packageDirectory) {
  const tests = readdirSync(path.join(packageDirectory, "tests"))
    .filter(name => name.endsWith(".test.mjs"))
    .sort()
    .map(name => path.join("tests", name));
  // The test deadline reports unsettled callbacks. The process deadline also
  // catches leaked handles and synchronous native calls that block the event loop.
  const result = spawnSync(process.execPath, ["--test", "--test-timeout=60000", ...tests], {
    cwd: packageDirectory,
    env: process.env,
    stdio: "inherit",
    timeout: 120000,
    killSignal: "SIGKILL"
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`Native tests in ${packageDirectory} exceeded 120000ms, including process cleanup`, { cause: result.error });
  }
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Native tests in ${packageDirectory} were interrupted by ${result.signal}`);
  if (result.status !== 0) throw new Error(`Native tests in ${packageDirectory} exited with status ${result.status}`);
}
