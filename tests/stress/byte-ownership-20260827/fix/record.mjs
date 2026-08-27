import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const directory = "tests/stress/byte-ownership-20260827/fix/";
const audit = "tests/stress/byte-ownership-20260827/";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const canonical = ["tests/commands/internal.test.ts", "tests/commands/streams.test.ts"];
const original = JSON.parse(readFileSync(`${audit}source-public-before.json`, "utf8"));
const originalPaths = git("ls-files", "--", audit).split("\n").filter(path => path && !path.startsWith(`${audit}independent/`) && !path.startsWith(directory));
const authorBindings = ["record.mjs", "binding.mjs", "observations.mjs", "tsconfig.json"].map(path => directory + path);
const paths = [...new Set([...Object.keys(original.hashes), ...git("ls-files", "src").split("\n"), ...originalPaths, ...canonical, ...authorBindings])].sort();
function snapshot() {
  return {
    at: new Date().toISOString(), head: git("rev-parse", "HEAD"), node: process.version,
    platform: process.platform, arch: process.arch,
    tooling: Object.fromEntries(["tsx", "typescript"].map(name => [name, JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version])),
    status: git("status", "--short"), staged: git("diff", "--cached", "--name-only"),
    hashes: Object.fromEntries(paths.map(path => [path, hash(path)])),
    originalFixtureHashes: Object.fromEntries([`${audit}ownership.test.ts`, `${audit}expectations.ts`].map(path => {
      assert.equal(hash(path), original.hashes[path]);
      return [path, hash(path)];
    })),
  };
}
function add(name, text) {
  const path = directory + name;
  assert.equal(existsSync(path), false, `refuse to overwrite ${path}`);
  execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`], { stdio: "inherit" });
}
const mode = process.argv[2];
if (mode === "snapshot") {
  assert.match(process.argv[3], /^[a-z-]+\.json$/);
  add(process.argv[3], JSON.stringify(snapshot(), null, 2));
} else {
  const tests = files => [process.execPath, "--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...files];
  const commands = {
    "canonical-initial": tests(canonical),
    "canonical-before": tests(canonical),
    canonical: tests(canonical),
    existing: tests(["tests/contracts/io.test.ts", "tests/shell/streaming.test.ts", "tests/commands/text.test.ts", "tests/commands/stream-format/rev.test.ts"]),
    typecheck: ["node_modules/.bin/tsc", "-p", `${directory}tsconfig.json`],
    "typecheck-candidate": ["node_modules/.bin/tsc", "-p", `${directory}tsconfig.json`],
    "original-manifest-rejects": [process.execPath, `${audit}binding.mjs`],
    original20: [process.execPath, "--unhandled-rejections=strict", "--import", `./${directory}binding.mjs`, "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", `${audit}ownership.test.ts`],
    observations: [process.execPath, "--unhandled-rejections=strict", "--expose-gc", "--import", "tsx", `${directory}observations.mjs`],
  };
  const command = commands[mode];
  assert.ok(command, `unknown mode ${mode}`);
  const before = snapshot();
  const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
  const after = snapshot();
  add(`evidence/${mode}.txt`, `COMMAND ${JSON.stringify(command)}\nEXIT ${result.status} SIGNAL ${result.signal}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  add(`evidence/${mode}.json`, JSON.stringify({ command, status: result.status, signal: result.signal, error: result.error?.message, before, after }, null, 2));
  assert.deepEqual(after.hashes, before.hashes, "source/fixture changed during run");
  console.log(`${mode}: exit ${result.status}; transcript ${directory}evidence/${mode}.txt`);
  process.exitCode = result.status ?? 1;
}
