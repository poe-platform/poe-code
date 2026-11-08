import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const directory = "tests/commands/network-stress";
const owned = `${directory}/final-verification`;
const revision = "aa2da57a5d1be8571f450a27c7b971245c1b7025";
const expectedDigest = "886d7b03e4b280ab90bb1385f199f363c13349e3fe439fee0777bd274a1499a4";
const handoff = "deab14d9f4b3b6f0d73f96587c74a9de23091300";
const mode = process.argv[2];
const label = process.argv[3] ?? mode;
assert.match(label ?? "", /^[a-z0-9-]+$/);
const jobs = {
  core: [`${directory}/product-v2.ts`],
  supplement: [`${directory}/supplement-v2.ts`, "product"],
  retry: [`${directory}/retry-product.ts`],
  lifecycle: [`${directory}/retry-lifecycle.ts`],
  "lifecycle-v2": [`${directory}/retry-lifecycle-v2.ts`],
  cleanup: [`${directory}/cleanup-selfcheck.ts`],
  author: ["--test", "tests/commands/network/*.test.ts"],
  native: ["--test", `${directory}/oracle.test.ts`],
  "retry-replay": [`${directory}/retry-native.ts`],
  independent: [`${owned}/independent.ts`],
  types: ["node_modules/typescript/bin/tsc", "--noEmit", "-p", `${owned}/tsconfig.json`],
};
assert(jobs[mode], `Unknown job ${mode}`);
const target = `${owned}/${label}.json`;
await assert.rejects(readFile(target), { code: "ENOENT" });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result.sort();
}
async function networkSnapshot() {
  const hashes = [];
  for (const path of await files("src/commands/network")) hashes.push([path, digest(await readFile(path))]);
  return { at: new Date().toISOString(), hashes, digest: digest(JSON.stringify(hashes)) };
}
async function snapshot() {
  const paths = [...await files("src"), ...await files("tests/commands/network"), "package.json"];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(ts|mjs)$/.test(entry.name)) paths.push(`${directory}/${entry.name}`);
  }
  for (const name of ["oracle.json", "baseline.json", "handoff.json", "supplement-native.json", "supplement-pins.json", "retry-freeze.json", "retry-pins.json"])
    paths.push(`${directory}/${name}`);
  const hashes = {};
  for (const path of paths.sort()) hashes[path] = digest(await readFile(path));
  return { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), status: git("status", "--short"), hashes, network: await networkSnapshot(), fixtureRoots: (await readdir(directory)).filter((name) => name.startsWith(".native-") || name.startsWith(".supp-native-")) };
}
const before = await snapshot();
assert.equal(before.network.digest, expectedDigest);
assert.deepEqual(before.network.hashes.map(([path]) => path), git("ls-tree", "-r", "--name-only", revision, "--", "src/commands/network").split("\n").sort());
for (const [path, hash] of before.network.hashes) {
  const committed = spawnSync("git", ["show", `${revision}:${path}`]);
  assert.equal(committed.status, 0);
  assert.equal(digest(committed.stdout), hash);
}
assert.equal(before.hashes[`${directory}/oracle.json`], "b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7");
const args = ["--unhandled-rejections=strict", ...(mode === "types" ? [] : ["--import", "tsx"]), ...jobs[mode]];
const environment = { CURL_VERIFY_AFTER_HANDOFF: handoff, CURL_VERIFY_SOURCE_REVISION: revision };
const child = spawn(process.execPath, args, { shell: false, detached: true, env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let forced = false;
function terminate(signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 8 * 1024 * 1024) { forced = true; terminate("SIGKILL"); } });
child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 8 * 1024 * 1024) { forced = true; terminate("SIGKILL"); } });
const samples = [before.network];
let checking = Promise.resolve();
const sampler = setInterval(() => {
  checking = checking.then(async () => {
    const sample = await networkSnapshot();
    samples.push(sample);
    if (sample.digest !== expectedDigest) { forced = true; terminate("SIGTERM"); }
  });
}, 100);
const timer = setTimeout(() => { forced = true; terminate("SIGTERM"); }, 430000);
const hardTimer = setTimeout(() => terminate("SIGKILL"), 432000);
const exit = await new Promise((resolve) => {
  child.once("error", (error) => resolve({ code: null, signal: null, error: String(error) }));
  child.once("close", (code, signal) => resolve({ code, signal }));
});
clearInterval(sampler);
clearTimeout(timer);
clearTimeout(hardTimer);
await checking;
terminate("SIGKILL");
const after = await snapshot();
samples.push(after.network);
const changes = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].filter((path) => before.hashes[path] !== after.hashes[path]);
const records = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => { try { return JSON.parse(line); } catch { return { unparsable: line }; } });
const artifact = { schema: 1, mode, revision, expectedDigest, command: [process.execPath, ...args], environment, nodeVersion: process.version, platform: process.platform, before, samples, after, changes, networkStable: samples.every((sample) => sample.digest === expectedDigest), exit, forced, stdout, stderr, stdoutSha256: digest(stdout), stderrSha256: digest(stderr), records };
const text = JSON.stringify(artifact, null, 2);
const patch = `*** Begin Patch\n*** Add File: ${target}\n${text.split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`;
const saved = spawnSync("apply_patch", { input: patch, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
assert.equal(saved.status, 0, saved.stderr);
console.log(JSON.stringify({ target, exit, networkStable: artifact.networkStable, samples: samples.length, changes, summaries: records.filter((record) => record.total !== undefined || record.summary !== undefined), failures: records.filter((record) => record.status === "failed"), tap: stdout.match(/^# (tests|pass|fail|cancelled|skipped).*$/gm), stderr }));
assert(artifact.networkStable, "Network source changed; this run cannot establish acceptance");
assert.deepEqual(after.fixtureRoots, before.fixtureRoots, "Fixture roots leaked");
process.exitCode = exit.code ?? 1;
