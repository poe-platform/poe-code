import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, loadBoundaries } from "./integration-inputs.mjs";
import { reporterArguments } from "./test-reporting.mjs";

export function runTests(root, args, spawn = spawnSync, fileSystem) {
  const boundaries = loadBoundaries(root, fileSystem);
  const files = discoverTests(root, boundaries, fileSystem);
  console.log(`# safe-bash discovery: ${files.length} active TypeScript test files; ${boundaries.fixtureDirectories.length} authenticated fixture roots; ${boundaries.heldEvidenceDirectories.length} held evidence roots`);
  const concurrency = args.some(argument => argument === "--test-concurrency" || argument.startsWith("--test-concurrency=")) ? [] : ["--test-concurrency=1"];
  const result = spawn(process.execPath, ["--import", "tsx", "--test", ...concurrency, ...args, ...files], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  process.exitCode = runTests(fileURLToPath(new URL("../", import.meta.url)), [...reporterArguments(args), ...args], spawnSync);
}
