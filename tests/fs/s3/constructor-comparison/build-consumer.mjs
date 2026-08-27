import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const directory = "tests/fs/s3/constructor-comparison";
const label = process.argv[2];
assert.match(label ?? "", /^[a-z0-9-]+$/);
const output = `${directory}/built-${label}.json`;
const isolated = `${directory}/.isolated/${label}`;
assert.equal(existsSync(output), false);
assert.equal(existsSync(isolated), false);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sources = git("ls-files", "src").split("\n").filter(name => name.endsWith(".ts"));
const inputs = [...sources, "package.json", `${directory}/consumer.mts`, `${directory}/build-consumer.mjs`];
const hash = content => createHash("sha256").update(content).digest("hex");
const contents = Object.fromEntries(inputs.map(name => [name, readFileSync(name, "utf8")]));
const manifest = Object.fromEntries(Object.entries(contents).map(([name, content]) => [name, hash(content)]));
const files = Object.fromEntries([...sources, "package.json"].map(name => [`${isolated}/${name}`, contents[name]]));
files[`${isolated}/example/consumer.mts`] = contents[`${directory}/consumer.mts`];
const patch = Object.entries(files).map(([name, content]) => `*** Add File: ${name}\n${content.replace(/\n$/, "").split("\n").map(line => "+" + line).join("\n")}`).join("\n");
execFileSync("apply_patch", [], { input: `*** Begin Patch\n${patch}\n*** End Patch\n`, maxBuffer: 16 * 1024 * 1024 });
const compiler = path.resolve("node_modules/typescript/bin/tsc");
const strict = ["--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict",
  "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames",
  "--skipLibCheck", "--types", "node", "--declaration", "--noEmitOnError"];
const commands = [
  ["isolated-package-build", [compiler, ...strict, "--rootDir", `${isolated}/src`, "--outDir", `${isolated}/dist`, `${isolated}/src/index.ts`]],
  ["public-consumer-compile", [compiler, ...strict, "--rootDir", `${isolated}/example`, "--outDir", `${isolated}/example-dist`, `${isolated}/example/consumer.mts`]],
  ["public-consumer-run", ["--unhandled-rejections=strict", "--test", `${isolated}/example-dist/consumer.mjs`]],
];
const checks = [];
for (const [name, args] of commands) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  checks.push({ name, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
  console.log(name, result.status, result.status === 0 ? (result.stdout ?? "").split("\n").filter(line => /^# (tests|pass|fail)/.test(line)).join("; ") : result.stdout || result.stderr);
  if (result.status !== 0) break;
}
const collect = root => existsSync(root) ? readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => path.join(entry.parentPath, entry.name)).sort() : [];
const built = Object.fromEntries([...collect(`${isolated}/dist`), ...collect(`${isolated}/example-dist`)].map(name => [name, hash(readFileSync(name))]));
const record = { head: git("rev-parse", "HEAD"), node: process.version, typescript: JSON.parse(readFileSync("node_modules/typescript/package.json", "utf8")).version,
  isolated, manifest, sourceSnapshots: contents, liveInputsChangedAfterSnapshot: inputs.filter(name => hash(readFileSync(name)) !== manifest[name]), built, checks };
const text = JSON.stringify(record, null, 2);
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${output}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, maxBuffer: 16 * 1024 * 1024 });
process.exitCode = checks.length !== 3 || checks.some(check => check.status !== 0) ? 1 : 0;
