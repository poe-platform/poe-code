import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const directory = fileURLToPath(new URL("./", import.meta.url));
const artifacts = new URL("./artifacts/", import.meta.url);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const pin = JSON.parse(readFileSync(new URL("./source-pin.json", import.meta.url), "utf8"));
const fixturePaths = ["expectations.json", "direct-curl.test.ts", "run.mjs", "source-pin.json", "README.md"];
const relativeDirectory = "tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/";
const sourceInventory = () => {
  const files = git("ls-files", "src").split("\n").sort();
  return { count: files.length, sha256: sha256(files.map(file => `${file}\0${sha256(readFileSync(`${root}${file}`))}\n`).join("")) };
};
const snapshot = () => ({
  head: git("rev-parse", "HEAD"),
  files: Object.fromEntries(Object.keys(pin.files).map(file => [file, sha256(readFileSync(`${root}${file}`))])),
  sourceInventory: sourceInventory(),
  fixtures: Object.fromEntries(fixturePaths.map(file => [file, sha256(readFileSync(`${directory}${file}`))])),
  sourceStatus: git("status", "--porcelain", "--", "src", "package.json", "tsconfig.json", "AGENTS.md"),
});

assert.equal(existsSync(artifacts), false, "Retain first execution evidence; do not overwrite or silently rerun");
for (const file of fixturePaths) {
  const name = relativeDirectory + file;
  assert.equal(sha256(execFileSync("git", ["show", `HEAD:${name}`], { cwd: root })), sha256(readFileSync(`${directory}${file}`)), `Fixture not committed: ${file}`);
}
const before = snapshot();
assert.deepEqual(before.files, pin.files, "Read-source hashes changed after freeze");
assert.deepEqual(before.sourceInventory, pin.sourceInventory, "Tracked source inventory changed after freeze");
assert.equal(before.sourceStatus, "", "Do not certify a dirty source profile");
mkdirSync(artifacts);
writeFileSync(new URL("before.json", artifacts), JSON.stringify(before, null, 2) + "\n");
const args = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", `${relativeDirectory}direct-curl.test.ts`];
const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let watchdogFired = false;
let hardStop;
const watchdog = setTimeout(() => {
  watchdogFired = true;
  child.kill("SIGTERM");
  hardStop = setTimeout(() => child.kill("SIGKILL"), 2_000);
}, 20_000);
child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
const outcome = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
}).finally(() => { clearTimeout(watchdog); clearTimeout(hardStop); });
const after = snapshot();
writeFileSync(new URL("raw.tap", artifacts), stdout);
writeFileSync(new URL("stderr.txt", artifacts), stderr);
writeFileSync(new URL("after.json", artifacts), JSON.stringify(after, null, 2) + "\n");
writeFileSync(new URL("run.json", artifacts), JSON.stringify({
  profile: "Direct public-root source-import registered curl; NOT Shell; NOT packed",
  node: process.version, platform: process.platform, arch: process.arch,
  command: [process.execPath, ...args], fixtureFreezeCommit: git("log", "-1", "--format=%H", "--", ...fixturePaths.map(file => relativeDirectory + file)),
  outcome, watchdogFired, childClosed: true,
  sourceHashesUnchanged: JSON.stringify(before.files) === JSON.stringify(after.files),
  sourceInventoryUnchanged: JSON.stringify(before.sourceInventory) === JSON.stringify(after.sourceInventory),
  fixtureHashesUnchanged: JSON.stringify(before.fixtures) === JSON.stringify(after.fixtures),
}, null, 2) + "\n");
process.stdout.write(stdout);
process.stderr.write(stderr);
assert.deepEqual(after.files, before.files);
assert.deepEqual(after.sourceInventory, before.sourceInventory);
assert.deepEqual(after.fixtures, before.fixtures);
assert.equal(after.sourceStatus, "");
assert.equal(watchdogFired, false);
process.exitCode = outcome.code ?? 1;
