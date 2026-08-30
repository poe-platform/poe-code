import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const directory = "tests/commands/structured-stress/jq-42-author-20260827";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const filesUnder = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
const save = (name, content) => {
  if (process.argv.includes("--verify")) return;
  const path = `${directory}/${name}`;
  assert.equal(existsSync(path), false, path);
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
};
const git = args => {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const snapshot = () => {
  const structured = Object.fromEntries(filesUnder("src/commands/structured").sort().map(path => [path, hash(readFileSync(path))]));
  const runtime = Object.fromEntries(filesUnder("src").filter(path => path.endsWith(".ts")).sort().map(path => [path, hash(readFileSync(path))]));
  return { at: new Date().toISOString(), head: git(["rev-parse", "HEAD"]).trim(), status: git(["status", "--short"]), structured, structuredDigest: hash(JSON.stringify(structured)), runtime, runtimeDigest: hash(JSON.stringify(runtime)) };
};
const before = snapshot();
const phases = [];
const run = (name, command, args, extension = "tap") => {
  const start = new Date().toISOString();
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024, shell: false });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  save(`final-${name}.${extension}`, stdout + stderr);
  const counts = Object.fromEntries([...stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const failures = [...stdout.matchAll(/^not ok \d+ - (.*)$/gmu)].map(match => match[1]);
  phases.push({ name, command, args, start, end: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, counts, failures, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) });
  console.log(name, result.status, counts);
};
const testPrefix = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap"];
run("immutable", process.execPath, [...testPrefix, "tests/commands/structured-stress/independent-increment/native-regressions.test.ts", "tests/commands/structured-stress/independent-increment/additive-regressions.test.ts"]);
run("author", process.execPath, [...testPrefix, `${directory}/native.test.ts`, `${directory}/followup.test.ts`, `${directory}/safety.test.ts`]);
run("owned", process.execPath, [...testPrefix, "tests/commands/structured/**/*.test.ts", "tests/commands/structured-stress/**/*.test.ts"]);
for (let repetition = 1; repetition <= 3; repetition++) run(`safety-repeat-${repetition}`, process.execPath, [...testPrefix, `${directory}/safety.test.ts`]);
run("split", process.execPath, ["--import", "tsx", "tests/commands/structured-stress/final-increment/split-report.ts"], "json");
run("build", "npm", ["run", "build"], "log");
run("typecheck", "npm", ["run", "typecheck"], "log");
const ownedTypes = ["src/commands/structured", "tests/commands/structured", "tests/commands/structured-stress"].flatMap(filesUnder).filter(path => path.endsWith(".ts"));
run("scoped-typecheck", "node_modules/.bin/tsc", ["--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...ownedTypes], "log");
const immutablePaths = git(["ls-tree", "-r", "--name-only", "96db59ac", "tests/commands/structured", "tests/commands/structured-stress", "benchmarks/reports/current-integration"]).trim().split("\n");
const immutable = immutablePaths.map(path => {
  const old = spawnSync("git", ["show", `96db59ac:${path}`], { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(old.status, 0);
  return { path, frozenSha256: hash(old.stdout), currentSha256: hash(readFileSync(path)), unchanged: hash(old.stdout) === hash(readFileSync(path)) };
});
const after = snapshot();
assert.deepEqual(before.structured, after.structured);
save("validation.json", JSON.stringify({ before, phases, immutable, after, structuredStable: before.structuredDigest === after.structuredDigest, runtimeStable: before.runtimeDigest === after.runtimeDigest }, null, 2));
console.log({ structuredStable: true, runtimeStable: before.runtimeDigest === after.runtimeDigest, immutableFiles: immutable.length, changedImmutable: immutable.filter(value => !value.unchanged).map(value => value.path) });
