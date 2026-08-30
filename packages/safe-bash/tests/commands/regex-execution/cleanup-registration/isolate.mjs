import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const base = "07acb1a4d30b7592cf247a0220250317be4e2038";
const evidenceDirectory = "tests/commands/regex-execution/cleanup-registration";
const artifact = resolve(evidenceDirectory, "artifacts/phase-a");
const overlay = ["src/commands/grep.ts", "src/commands/search/rg.ts", "src/commands/regex-execution/client.ts", "src/commands/regex-execution/README.md"];
const existingTests = ["executor.test.ts", "commands.test.ts", "followup/messageerror.test.ts", "continuation/glob.test.ts", "continuation/glob-transport.test.ts", "continuation/public-child.mjs"];
function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 20000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "--unhandled-rejections=strict" } });
  return { command: [command, ...args], status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
}
const names = run("git", ["ls-tree", "-r", "--name-only", base, "src", "package.json", "tsconfig.json", "tsconfig.build.json"]).stdout.trim().split("\n");
const hashes = {};
const save = (name, bytes) => {
  const path = resolve(artifact, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
};
for (const name of names) {
  const bytes = spawnSync("git", ["show", `${base}:${name}`], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(bytes.status, 0, name);
  save(name, bytes.stdout);
}
for (const name of overlay) save(name, readFileSync(name));
for (const name of existingTests) {
  const path = `tests/commands/regex-execution/${name}`;
  save(path, readFileSync(path));
}
for (const name of ["controls.test.ts", "tsconfig.json"]) {
  const path = `${evidenceDirectory}/${name}`;
  save(path, readFileSync(path));
}
const build = run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], artifact);
const types = run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", `${evidenceDirectory}/tsconfig.json`], artifact);
const tests = build.status === 0 ? run(process.execPath, ["--import", "tsx", "--test", ...existingTests.filter(name => name.endsWith(".test.ts")).map(name => `tests/commands/regex-execution/${name}`), `${evidenceDirectory}/controls.test.ts`], artifact) : null;
const publicControls = build.status === 0 ? run(process.execPath, ["tests/commands/regex-execution/continuation/public-child.mjs", new URL(`file://${artifact}/dist/index.js`).href], artifact) : null;
writeFileSync(`${evidenceDirectory}/isolated-validation.json`, `${JSON.stringify({ base, overlay, artifact, node: process.version, platform: process.platform, arch: process.arch, hashes, build, types, tests, publicControls }, null, 2)}\n`);
console.log(JSON.stringify({ build, types, tests, publicControls }, null, 2));
process.exitCode = [build, types, tests, publicControls].every(result => result?.status === 0) ? 0 : 1;
