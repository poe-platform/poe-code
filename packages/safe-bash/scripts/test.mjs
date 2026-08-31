import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, loadBoundaries } from "./integration-inputs.mjs";

export function selectNativeTests(files, lane = "all", platform = process.platform) {
  assert(["all", "linux", "darwin"].includes(lane), "unknown native test lane");
  assert.equal(new Set(files).size, files.length, "duplicate test discovery");
  if (lane === "all") return files;
  assert.equal(platform, lane, "native lane requires its qualified host");
  const { darwinTestFiles } = JSON.parse(readFileSync(new URL("../tests/native-gnu-profiles.json", import.meta.url), "utf8"));
  assert(Array.isArray(darwinTestFiles) && darwinTestFiles.length > 0);
  const required = new Set(darwinTestFiles);
  assert.equal(required.size, darwinTestFiles.length, "duplicate Darwin obligation");
  for (const file of required) assert(files.includes(file), `required Darwin test missing from discovery: ${file}`);
  const selected = files.filter(file => required.has(file) === (lane === "darwin"));
  assert(selected.length > 0, "empty native test lane");
  console.log(`# safe-bash native lane ${lane}: ${selected.length} selected; ${files.length - selected.length} delegated to required ${lane === "linux" ? "darwin" : "linux"} lane`);
  return selected;
}

export function runTests(root, args, spawn = spawnSync, fileSystem, lane = "all") {
  const boundaries = loadBoundaries(root, fileSystem);
  const files = selectNativeTests(discoverTests(root, boundaries, fileSystem), lane);
  console.log(`# safe-bash discovery: ${files.length} active TypeScript test files; ${boundaries.fixtureDirectories.length} authenticated fixture roots; ${boundaries.heldEvidenceDirectories.length} held evidence roots`);
  const concurrency = args.some(argument => argument === "--test-concurrency" || argument.startsWith("--test-concurrency=")) ? [] : ["--test-concurrency=1"];
  const result = spawn(process.execPath, ["--import", "tsx", "--test", ...concurrency, ...args, ...files], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTests(fileURLToPath(new URL("../", import.meta.url)), process.argv.slice(2), spawnSync, undefined, process.env.SAFE_BASH_NATIVE_LANE ?? "all");
}
