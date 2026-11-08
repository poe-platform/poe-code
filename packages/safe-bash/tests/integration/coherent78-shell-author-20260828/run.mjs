import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { own, repository, sha256, blob, authenticate, materialize, inventory } from "./compose.mjs";

const presealCommit = "186804b7ae9d8280aac3ee78e556bfd7c8bba7d3";
const relative = "tests/integration/coherent78-shell-author-20260828/";
const seal = JSON.parse(fs.readFileSync(path.join(own, "PRESEAL.json")));
for (const [filename, digest] of Object.entries(seal.artifacts)) {
  const bytes = fs.readFileSync(path.join(own, filename));
  assert.equal(sha256(bytes), digest, filename);
  assert.deepEqual(bytes, blob(presealCommit, relative + filename));
}
const executor = JSON.parse(fs.readFileSync(path.join(own, "EXECUTOR.json")));
for (const [filename, digest] of Object.entries(executor.artifacts)) assert.equal(sha256(fs.readFileSync(path.join(own, filename))), digest, filename);
const manifest = JSON.parse(fs.readFileSync(path.join(own, "MANIFEST.json")));
const typeCases = JSON.parse(fs.readFileSync(path.join(own, "TYPES.json")));
const amendment = JSON.parse(fs.readFileSync(path.join(own, "CASES-v2-overlay.json")));
assert.equal(amendment.originalCasesSha256, seal.artifacts["CASES.json"]);
assert.equal(amendment.composition, manifest.composedTree);
const originalCases = JSON.parse(fs.readFileSync(path.join(own, "CASES.json")));
const originalUnicode = originalCases.cases.find(row => row.id === "C15").unicodeValues;
assert.equal(sha256(Buffer.from(JSON.stringify(originalUnicode))), amendment.originalC15InputSha256);
assert.deepEqual(amendment.C15.unicodeValues.slice(0, -1), originalUnicode.slice(0, -1));
assert.equal(amendment.C15.unicodeValues.at(-1), "\ufffd");
const evidence = { version: 2, presealCommit, composition: manifest.composedTree, executor, amendment, buildRole: "fresh reproducible build; prior temporary roots removed, no original-build reuse", commands: [], layouts: [], types: [], controls: [], cleanup: {}, createdAt: new Date().toISOString() };
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "coherent78-author-"));
const captureName = path.basename(temporary) + ".json.gz.base64";
const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
const npm = fs.realpathSync(path.join(path.dirname(process.execPath), "npm"));
evidence.tools = { node: process.version, executable: process.execPath, nodeSha256: sha256(fs.readFileSync(process.execPath)), typescript: JSON.parse(fs.readFileSync(path.join(repository, "node_modules/typescript/package.json"))).version, compilerSha256: sha256(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))), npmSha256: sha256(fs.readFileSync(npm)), platform: process.platform, architecture: process.arch };
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(temporary, "home"), TMPDIR: path.join(temporary, "tmp"), npm_config_cache: path.join(temporary, "cache"), npm_config_userconfig: path.join(temporary, "npmrc"), npm_config_globalconfig: path.join(temporary, "global-npmrc"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false", NO_COLOR: "1" };
for (const name of ["home", "tmp", "cache", "outside"]) fs.mkdirSync(path.join(temporary, name));
for (const name of ["npmrc", "global-npmrc"]) fs.writeFileSync(path.join(temporary, name), "");
const outside = path.join(temporary, "outside");
const source = path.join(temporary, "source");
function command(label, executable, args, cwd, extraEnv = {}) {
  const result = spawnSync(executable, args, { cwd, env: { ...environment, ...extraEnv }, encoding: "utf8", timeout: 90000, killSignal: "SIGKILL", maxBuffer: 24 * 1024 * 1024 });
  const row = { label, executable, args, cwd, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  evidence.commands.push(row);
  console.log(JSON.stringify({ command: label, status: row.status, signal: row.signal }));
  return row;
}
const success = row => assert.equal(row.status, 0, `${row.label}\n${row.stdout}\n${row.stderr}`);
const packageInventory = root => ({ ...Object.fromEntries(Object.entries(inventory(path.join(root, "dist"))).map(([name, item]) => ["dist/" + name, item])), ...Object.fromEntries(["package.json", "README.md"].map(name => { const bytes = fs.readFileSync(path.join(root, name)); return [name, { kind: "file", mode: fs.statSync(path.join(root, name)).mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) }]; })) });
function installHarness(root, admitted) {
  for (const name of ["probe.mjs", "loader.mjs", "names.mjs", "CASES.json", "CASES-v2-overlay.json"]) fs.copyFileSync(path.join(own, name), path.join(root, name));
  fs.writeFileSync(path.join(root, "admitted.json"), JSON.stringify(admitted));
}
function runtime(label, root, product, extra = {}) {
  const log = path.join(root, `${label}.loads.jsonl`);
  const row = command(label, process.execPath, ["--loader", path.join(root, "loader.mjs"), path.join(root, "probe.mjs")], outside, { RUN_ROOT: root, PRODUCT_ROOT: product, PRODUCT_INVENTORY: path.join(root, "admitted.json"), LOAD_LOG: log, LAYOUT: label, ...extra });
  const loads = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  row.loads = loads;
  const observations = row.stdout?.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line)) ?? [];
  row.observations = observations;
  return row;
}
function types(label, root) {
  const product = fs.realpathSync(fs.existsSync(path.join(root, "dist")) ? root : path.join(root, "node_modules/virtual-bash"));
  const admitted = JSON.parse(fs.readFileSync(path.join(root, "admitted.json")));
  for (const test of [...typeCases.positive.map(row => ({ ...row, expected: 0 })), ...typeCases.negative.flatMap(row => [{ ...row, expected: 2 }, { ...row, id: row.id + "-inversion", body: row.inversion, expected: 0 }])]) {
    const filename = path.join(root, "consumer.mts");
    fs.writeFileSync(filename, typeCases.prefix + test.body + "\n");
    const result = command(`${label}-${test.id}`, process.execPath, [compiler, "--noEmit", "--listFiles", "--strict", "--exactOptionalPropertyTypes", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(repository, "node_modules/@types"), filename], outside);
    const matched = result.status === test.expected && (test.expected === 0 || (result.stdout.includes(test.diagnostic) && result.stdout.includes(test.term) && !result.stdout.includes("TS2307")));
    const declarations = result.stdout.split("\n").filter(line => path.isAbsolute(line) && line.endsWith(".d.ts")).map(line => fs.realpathSync(line)).filter(name => name.startsWith(product + path.sep)).map(name => {
      const relative = path.relative(product, name), digest = sha256(fs.readFileSync(name));
      assert.equal(admitted[relative]?.sha256, digest, relative);
      return { relative, sha256: digest };
    });
    assert.ok(declarations.some(row => row.relative === "dist/index.d.ts"));
    assert.ok(declarations.some(row => row.relative === "dist/commands/timeout/index.d.ts"));
    assert.equal(result.stdout.split("\n").some(line => path.isAbsolute(line) && line.includes("/src/") && line.endsWith(".ts") && !line.endsWith(".d.ts")), false);
    evidence.types.push({ layout: label, id: test.id, matched, expected: test.expected, actual: result.status, declarations });
    fs.unlinkSync(filename);
    assert.equal(matched, true, result.stdout + result.stderr);
  }
}
function checkRuntime(row, expectedIds) {
  success(row);
  const summary = row.observations.find(item => item.summary)?.summary;
  assert.equal(summary?.pass, expectedIds.length); assert.equal(summary.cases, expectedIds.length); assert.equal(summary.created, summary.disposed);
  assert.deepEqual(row.observations.filter(item => item.id).map(item => item.id), expectedIds);
  const unique = [...new Set(row.loads.map(item => item.relative))].sort();
  for (const required of ["dist/index.js", "dist/shell/runtime.js", "dist/shell/shell.js", "dist/commands/timeout/index.js", "dist/commands/structured/interpreter.js", "dist/fs/webdav/webdav.js", "dist/commands/network/curl.js"]) assert.ok(unique.includes(required), required);
  evidence.layouts.push({ ...summary, modules: unique.length, loaded: unique });
}
let failure;
try {
  const bad = structuredClone(manifest); bad.inputs[0].sha256 = "0".repeat(64);
  assert.throws(() => authenticate(bad), { code: "ERR_ASSERTION" });
  evidence.controls.push({ name: "manifest-tamper", rejectedBeforeMaterialization: !fs.existsSync(source) });
  const contents = authenticate(manifest);
  materialize(contents, source);
  const selectedBefore = inventory(source);
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  success(command("build", process.execPath, [compiler, "-p", path.join(source, "tsconfig.build.json")], source));
  const admitted = packageInventory(source);
  assert.equal(Object.values(admitted).filter(row => row.kind === "file").length, 858);
  evidence.packageInventory = admitted;
  evidence.packageInventorySha256 = sha256(Buffer.from(JSON.stringify(admitted)));
  evidence.declarations = Object.fromEntries(Object.entries(admitted).filter(([name]) => name.endsWith(".d.ts")));
  evidence.declarationsSha256 = sha256(Buffer.from(JSON.stringify(evidence.declarations)));
  installHarness(source, admitted);
  checkRuntime(runtime("source-build-v2-affected", source, source, { CASE_IDS: "C14,C15,R15" }), ["C14", "C15", "R15"]);
  types("source-build", source);
  const packed = command("offline-pack", process.execPath, [npm, "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary], source);
  success(packed);
  const metadata = JSON.parse(packed.stdout)[0]; assert.equal(metadata.files.length, 858);
  const tarball = path.join(temporary, metadata.filename), bytes = fs.readFileSync(tarball);
  evidence.pack = { sha256: sha256(bytes), bytes: bytes.length, metadata, base64: bytes.toString("base64") };
  const consumer = path.join(temporary, "installed"); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "coherent78-isolated-consumer", private: true, type: "module" }));
  success(command("offline-install", process.execPath, [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], consumer));
  const installed = path.join(consumer, "node_modules/virtual-bash");
  assert.deepEqual(packageInventory(installed), admitted);
  evidence.fullInstalledBefore = inventory(installed);
  assert.equal(Object.values(evidence.fullInstalledBefore).filter(row => row.kind === "file").length, 858);
  installHarness(consumer, admitted);
  const revisedIds = [...originalCases.cases.map(row => row.id), "R15"];
  checkRuntime(runtime("installed", consumer, installed), revisedIds);
  types("installed", consumer);
  const moved = path.join(temporary, "physically moved consumer"); fs.renameSync(consumer, moved);
  assert.equal(fs.existsSync(consumer), false);
  const product = path.join(moved, "node_modules/virtual-bash");
  checkRuntime(runtime("moved", moved, product), revisedIds);
  types("moved", moved);
  evidence.physicalMove = { oldAbsent: !fs.existsSync(consumer), newPath: moved };
  const runtimePath = path.join(product, "dist/shell/runtime.js"), original = fs.readFileSync(runtimePath);
  try {
    fs.appendFileSync(runtimePath, "\n");
    const result = runtime("control-tamper", moved, product, { CASE_IDS: "C01" });
    assert.notEqual(result.status, 0); assert.ok(result.stderr.includes("Changed product load: dist/shell/runtime.js"));
    evidence.controls.push({ name: "emitted-tamper", rejected: true });
  } finally { fs.writeFileSync(runtimePath, original); }
  const sentinel = path.join(outside, "forbidden-fallback.mjs"); fs.writeFileSync(sentinel, "throw new Error('fallback executed');\n");
  const fallback = runtime("control-fallback", moved, product, { CASE_IDS: "C01", CONTROL: "source-fallback", FALLBACK_PATH: sentinel });
  assert.notEqual(fallback.status, 0); assert.ok(fallback.stderr.includes("Outside admitted consumer:"));
  evidence.controls.push({ name: "outside-fallback", rejected: true });
  const inversion = runtime("control-assertion", moved, product, { CASE_IDS: "C02", CONTROL: "assertion" });
  assert.notEqual(inversion.status, 0); assert.equal(inversion.observations[0]?.error?.code, "ERR_ASSERTION");
  assert.equal(inversion.observations.at(-1)?.summary?.cases, 1);
  evidence.controls.push({ name: "assertion-inversion", rejected: true });
  const timeoutEntry = path.join(product, "dist/commands/timeout/index.js");
  fs.renameSync(timeoutEntry, timeoutEntry + ".held");
  try {
    const missing = runtime("control-missing-entry", moved, product, { CASE_IDS: "C01" });
    assert.notEqual(missing.status, 0); assert.ok(missing.stderr.includes("ERR_MODULE_NOT_FOUND"));
    evidence.controls.push({ name: "missing-entry", rejected: true });
  } finally { fs.renameSync(timeoutEntry + ".held", timeoutEntry); }
  assert.deepEqual(inventory(product), evidence.fullInstalledBefore);
  assert.deepEqual(packageInventory(source), admitted);
  const srcBefore = Object.fromEntries(Object.entries(selectedBefore).filter(([name]) => name.startsWith("src/")));
  const srcAfter = Object.fromEntries(Object.entries(inventory(path.join(source, "src"))).map(([name, item]) => ["src/" + name, item]));
  delete srcBefore["src/"];
  assert.deepEqual(srcAfter, srcBefore);
  for (const [name, value] of contents) assert.deepEqual(fs.readFileSync(path.join(source, name)), value, name);
  evidence.stability = { appendedEntriesChecked: true, fullInstalled: true, selectedSource: true, selectedMetadata: true };
  evidence.pass = true;
} catch (error) {
  failure = error; evidence.pass = false; evidence.failure = { name: error.name, code: error.code, message: error.message, stack: error.stack };
} finally {
  evidence.cleanup.children = evidence.commands.map(row => ({ pid: row.pid, naturallyClosed: row.signal === null && row.status !== null, signal: row.signal }));
  fs.rmSync(temporary, { recursive: true, force: true });
  evidence.cleanup.temporaryRootAbsent = !fs.existsSync(temporary);
  evidence.cleanup.activeOwnedCommands = 0;
  const captures = path.join(own, "captures"); fs.mkdirSync(captures, { recursive: true });
  const capture = path.join(captures, captureName);
  fs.writeFileSync(capture, gzipSync(Buffer.from(JSON.stringify(evidence)), { level: 9 }).toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ capture, pass: evidence.pass, layouts: evidence.layouts.map(row => ({ layout: row.layout, pass: row.pass })), types: evidence.types.length, controls: evidence.controls.length, pack: evidence.pack?.sha256, cleanup: evidence.cleanup.temporaryRootAbsent }));
}
if (failure) { console.error(failure); process.exitCode = 1; }
