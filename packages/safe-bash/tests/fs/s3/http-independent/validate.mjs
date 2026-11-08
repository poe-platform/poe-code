import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2]);
const setup = JSON.parse(readFileSync(join(directory, "prepare.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const compiler = join(process.cwd(), "node_modules/typescript/bin/tsc");
const flags = ["--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--skipLibCheck", "--types", "node", "--typeRoots", join(process.cwd(), "node_modules/@types")];
const tests = [...Object.keys(setup.authorHashes).filter(path => path.endsWith(".test.ts")), ...readdirSync(join(setup.source, "tests/fs/s3/http-independent")).filter(name => name.endsWith(".test.ts")).map(name => "tests/fs/s3/http-independent/" + name)];
const inputs = Object.fromEntries(tests.map(path => [path, hash(readFileSync(join(setup.source, path)))]));
const phases = [];
function run(label, args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  phases.push({ label, args, cwd, status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  writeFileSync(join(directory, "validation.json"), JSON.stringify({ revision: setup.revision, overlay: setup.overlay, inputs, phases }, null, 2));
  assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
}
run("unchanged-author69-and-independent60", ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...tests], setup.source);
run("scoped-strict-types", [compiler, ...flags, "--noEmit", ...tests], setup.source);
const publicFile = "tests/fs/s3/http-independent/public-workflow.mts";
copyFileSync(join(setup.source, publicFile), join(setup.consumer, "public-workflow.mts"));
inputs[publicFile] = hash(readFileSync(join(setup.source, publicFile)));
run("independent-packed-public-workflow-types", [compiler, ...flags, "public-workflow.mts"], setup.consumer);
for (const [path, expected] of Object.entries(setup.sourceHashes)) assert.equal(hash(readFileSync(join(setup.source, path))), expected, path);
console.log(JSON.stringify({ directory, phases: phases.map(phase => ({ label: phase.label, status: phase.status })) }, null, 2));
