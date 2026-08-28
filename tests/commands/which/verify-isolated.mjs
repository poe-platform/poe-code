import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../../../node_modules/typescript/lib/typescript.js";

assert.equal(process.argv[2], "--capture", "Explicit --capture required; canonical tests never write evidence");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
assert.equal(process.cwd(), root);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "which-author-v2-")));
const snapshot = join(scratch, "snapshot");
const moved = join(scratch, "moved");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hash = path => sha256(readFileSync(path));
const patch = (path, text) => execFileSync("apply_patch", [], {
  cwd: root, input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`,
});
const copy = (source, destination) => { mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination); };
const json = (path, value) => patch(path, JSON.stringify(value, null, 2));
const sourceRoots = ["src/commands/which/index.ts", "src/fs/memory/index.ts", "src/fs/readonly/index.ts", "src/shell/shell.ts"];
const testRoots = readdirSync(join(root, "tests/commands/which")).filter(name => name.endsWith(".ts")).map(name => `tests/commands/which/${name}`);
const originalConfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
const config = ts.parseJsonConfigFileContent({ compilerOptions: originalConfig.compilerOptions, files: [...sourceRoots, ...testRoots] }, ts.sys, root);
const program = ts.createProgram(config.fileNames, config.options);
const closure = program.getSourceFiles().map(source => source.fileName).filter(path => path.startsWith(`${root}/src/`) || path.startsWith(`${root}/tests/commands/which/`));
const inputs = {};
for (const source of closure) {
  const path = relative(root, source);
  inputs[path] = hash(source);
  copy(source, join(snapshot, path));
}
for (const path of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"]) {
  inputs[path] = hash(join(root, path));
  copy(join(root, path), join(snapshot, path));
}
for (const name of readdirSync(join(root, "tests/commands/which"))) {
  if (!name.endsWith(".mjs") && !name.endsWith(".data")) continue;
  const path = `tests/commands/which/${name}`;
  inputs[path] = hash(join(root, path));
  copy(join(root, path), join(snapshot, path));
}
const typeRoots = [join(root, "node_modules/@types")];
json(join(snapshot, "build.json"), {
  extends: "./tsconfig.build.json", compilerOptions: { typeRoots }, files: sourceRoots, include: [], exclude: [],
});
json(join(snapshot, "focused.json"), {
  extends: "./tsconfig.json", compilerOptions: { typeRoots, noEmit: true }, files: [...sourceRoots, ...testRoots], include: [], exclude: [],
});
const result = {
  classification: "author-only isolated current-input evidence; not independent acceptance or public export support",
  startedAt: new Date().toISOString(), scratch, snapshot, moved,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  gitStatus: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }),
  node: process.version, platform: process.platform, arch: process.arch, typescript: ts.version,
  toolHashes: Object.fromEntries(["node_modules/typescript/lib/typescript.js", "node_modules/typescript/lib/_tsc.js", "node_modules/@types/node/package.json", "node_modules/tsx/package.json"].map(path => [path, hash(join(root, path))])),
  inputs, generatedConfigs: {}, phases: [], outputHashes: {}, consumerTypeClosure: [],
};
const run = (name, args, cwd) => {
  const outcome = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const phase = { name, command: [process.execPath, ...args], cwd, status: outcome.status, signal: outcome.signal, stdout: outcome.stdout, stderr: outcome.stderr, error: outcome.error?.message };
  result.phases.push(phase);
  if (outcome.status !== 0) throw new Error(`${name} failed; original output retained in ${scratch}/receipt.json`);
  return outcome.stdout;
};
const tree = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? tree(join(directory, entry.name)) : [join(directory, entry.name)]);
try {
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  run("focused-source-and-author-tests", [compiler, "-p", join(snapshot, "focused.json"), "--listFiles"], snapshot);
  run("isolated-source-build", [compiler, "-p", join(snapshot, "build.json"), "--listFiles"], snapshot);
  mkdirSync(moved);
  renameSync(join(snapshot, "dist"), join(moved, "dist"));
  copy(join(snapshot, "package.json"), join(moved, "package.json"));
  copy(join(snapshot, "tests/commands/which/moved-runtime.mjs"), join(moved, "runtime.mjs"));
  copy(join(snapshot, "tests/commands/which/consumer.ts.data"), join(moved, "consumer.ts"));
  json(join(moved, "tsconfig.json"), { compilerOptions: { ...originalConfig.compilerOptions, noEmit: true, typeRoots }, files: ["consumer.ts"], include: [] });
  const declarations = run("moved-strict-type-consumer", [compiler, "-p", join(moved, "tsconfig.json"), "--listFiles"], moved);
  result.consumerTypeClosure = declarations.trim().split("\n");
  for (const path of result.consumerTypeClosure) assert.ok(path.startsWith(`${moved}/`) || path.startsWith(`${root}/node_modules/`), `source fallback: ${path}`);
  assert.equal(existsSync(join(moved, "src")), false);
  const compiled = tree(join(moved, "dist"));
  const allowed = Object.fromEntries(compiled.filter(path => path.endsWith(".js")).map(path => [path, hash(path)]));
  const guard = `import { registerHooks } from 'node:module';\nimport { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';\nimport { fileURLToPath } from 'node:url';\nconst allowed = ${JSON.stringify({ ...allowed, [join(moved, "runtime.mjs")]: hash(join(moved, "runtime.mjs")) })};\nregisterHooks({load(url, context, nextLoad) { if (url.startsWith('node:')) return nextLoad(url, context); const path=fileURLToPath(url); if (!Object.hasOwn(allowed,path)) throw new Error('Noncompiled runtime input: '+path); const actual=createHash('sha256').update(readFileSync(path)).digest('hex'); if(actual!==allowed[path]) throw new Error('Runtime hash mismatch: '+path); return nextLoad(url,context); }});\n`;
  patch(join(moved, "guard.mjs"), guard);
  run("moved-runtime-no-source-fallback", ["--import", join(moved, "guard.mjs"), "--test", join(moved, "runtime.mjs")], moved);
  result.outputHashes = Object.fromEntries(compiled.map(path => [relative(moved, path), hash(path)]));
  result.generatedConfigs = Object.fromEntries([join(snapshot, "build.json"), join(snapshot, "focused.json"), join(moved, "tsconfig.json"), join(moved, "guard.mjs")].map(path => [relative(scratch, path), { sha256: hash(path), text: readFileSync(path, "utf8") }]));
  for (const [path, expected] of Object.entries(inputs)) assert.equal(hash(join(snapshot, path)), expected, `snapshot changed: ${path}`);
  result.snapshotAfter = "All enumerated input hashes unchanged; this is not an append-proof input tree check";
} catch (error) {
  result.failure = String(error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  json(join(scratch, "receipt.json"), result);
  console.log(JSON.stringify({ scratch, phases: result.phases.map(({ name, status }) => ({ name, status })), failure: result.failure }, null, 2));
}
