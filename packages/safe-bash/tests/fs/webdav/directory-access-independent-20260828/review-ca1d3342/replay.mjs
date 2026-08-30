import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { own, frozen, repo, hash, inventory, unpack, pack, write, save, originalFreeze, liveProtected } from "./common.mjs";

const scratch = path.join(own, "scratch");
const tools = path.join(scratch, "tools");
const composition = path.join(scratch, "composition");
const captureName = process.argv[2];
assert.match(captureName ?? "", /^replay-[a-zA-Z0-9-]+$/, "choose a unique replay-* capture name");
const raw = path.join(own, "raw", captureName);
assert.ok(!fs.existsSync(raw), "never overwrite a capture");
const binding = JSON.parse(fs.readFileSync(path.join(own, "BINDING.json")));
const seal = JSON.parse(fs.readFileSync(path.join(own, "DRIVER-SEAL.json")));
const payload = unpack(path.join(own, "composition.json.gz"));
const correctedSeal = JSON.parse(fs.readFileSync(path.join(own, "DRIVER-SEAL-v3.json")));
assert.equal(hash(fs.readFileSync(path.join(own, "types-v2.mjs"))), correctedSeal.files["types-v2.mjs"].sha256);
for (const [name, record] of Object.entries(seal.files)) assert.equal(hash(fs.readFileSync(path.join(own, name))), record.sha256, name);
assert.deepEqual(inventory(scratch), unpack(path.join(own, binding.scratchBeforeBuild.file)));
assert.equal(hash(fs.readFileSync(path.join(own, "composition.json.gz"))), binding.composition.archiveSha256);
originalFreeze();
const liveBefore = liveProtected();
fs.mkdirSync(raw, { recursive: true });
for (const name of ["user.npmrc", "global.npmrc"]) write(path.join(scratch, name), "");
const env = {
  PATH: tools, HOME: path.join(scratch, "home"), TMPDIR: path.join(scratch, "tmp"),
  LANG: "C.UTF-8", TZ: "UTC", NO_COLOR: "1", NODE_COMPILE_CACHE: path.join(scratch, "node-cache"),
  NPM_CONFIG_USERCONFIG: path.join(scratch, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(scratch, "global.npmrc"),
  NPM_CONFIG_CACHE: path.join(scratch, "cache"), NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_IGNORE_SCRIPTS: "true",
  NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false",
};
const records = [];
const results = { startedAt: new Date().toISOString(), composition: binding.composition, children: records, layouts: {}, sourceMutants: [], loadControls: [], environment: env };
const node = path.join(tools, "node");
const compiler = path.join(tools, "node_modules/typescript/lib/typescript.js");
const npm = path.join(tools, "npm/bin/npm-cli.js");
function child(label, args, cwd, allowFailure = false) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(node, args, { cwd, env, timeout: 120000, killSignal: "SIGTERM", maxBuffer: 32 * 1024 * 1024 });
  write(path.join(raw, `${label}.stdout.txt`), result.stdout ?? Buffer.alloc(0));
  write(path.join(raw, `${label}.stderr.txt`), result.stderr ?? Buffer.alloc(0));
  const record = { label, executable: node, args, cwd, startedAt, finishedAt: new Date().toISOString(), pid: result.pid,
    status: result.status, signal: result.signal, error: result.error && { code: result.error.code, message: result.error.message },
    stdoutSha256: hash(result.stdout ?? ""), stderrSha256: hash(result.stderr ?? "") };
  records.push(record); fs.writeFileSync(path.join(raw, "children.json"), JSON.stringify(records));
  console.log(JSON.stringify(record));
  assert.ok(!result.error && !result.signal, `${label}: guard/admission failure; stop`);
  if (!allowFailure) assert.equal(result.status, 0, `${label}: see preserved stderr`);
  return result;
}
function harness(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const name of ["boot.mjs", "runner.mjs"]) write(path.join(root, name), fs.readFileSync(path.join(own, name)));
  for (const name of ["cases.mjs", "typed-inputs.ts"]) write(path.join(root, name), fs.readFileSync(path.join(frozen, name)));
  write(path.join(root, "package.json"), JSON.stringify({ name: "independent-webdav-consumer", private: true, type: "module" }));
}
function configuration(label, layout, consumer, productRoot, extra = {}) {
  const allowedFiles = {};
  for (const [name, record] of Object.entries(inventory(productRoot))) allowedFiles[path.join(productRoot, name)] = record.sha256;
  for (const name of ["boot.mjs", "runner.mjs", "cases.mjs", "typed-inputs.ts"]) allowedFiles[path.join(consumer, name)] = hash(fs.readFileSync(path.join(consumer, name)));
  const config = { layout, tools, compiler, productRoot, allowedFiles, runner: path.join(consumer, "runner.mjs"),
    result: path.join(scratch, `${label}.result.json`), loadLog: path.join(scratch, `${label}.load.json`),
    typeResult: path.join(scratch, `${label}.types.json`), ...extra };
  const filename = path.join(raw, `${label}.config.json`);
  write(filename, JSON.stringify(config));
  return { config, filename };
}
function execute(label, settings, typecheck = true) {
  const { config, filename } = settings;
  const consumer = path.dirname(config.runner);
  const before = inventory(config.productRoot);
  child(label, [path.join(consumer, "boot.mjs"), filename], consumer, true);
  assert.ok(fs.existsSync(config.result), `${label}: loader/environment failure is not a case result`);
  const result = JSON.parse(fs.readFileSync(config.result));
  const load = JSON.parse(fs.readFileSync(config.loadLog));
  write(path.join(raw, `${label}.result.json.gz`), pack(result));
  write(path.join(raw, `${label}.load.json.gz`), pack(load));
  assert.equal(load.rejected.length, 0, "loader refusal is not a mutant kill");
  assert.equal(load.networkAttempts, 0);
  assert.ok(load.loaded.some(record => record.product && /\/fs\/webdav\/webdav\.(ts|js)$/.test(record.filename)));
  assert.deepEqual(inventory(config.productRoot), before);
  assert.equal(result.summary["resource-failure"], 0, "resource failure stops all following execution");
  assert.equal(result.summary.blocked, 0);
  if (typecheck) {
    child(`${label}-types`, [path.join(own, "types-v2.mjs"), filename], consumer);
    const types = JSON.parse(fs.readFileSync(config.typeResult));
    write(path.join(raw, `${label}.types.json.gz`), pack(types));
  }
  return { summary: result.summary, cases: result.cases.map(value => ({ id: value.id, status: value.status })),
    loadedProductModules: new Set(load.loaded.filter(value => value.product).map(value => value.filename)).size,
    resultSha256: hash(fs.readFileSync(path.join(raw, `${label}.result.json.gz`))), loadSha256: hash(fs.readFileSync(path.join(raw, `${label}.load.json.gz`))) };
}
try {
  child("build", [path.join(tools, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], composition);
  for (const [name, record] of Object.entries(payload.files)) assert.equal(hash(fs.readFileSync(path.join(composition, name))), record.sha256);
  write(path.join(raw, "emitted.json.gz"), pack(inventory(path.join(composition, "dist"))));
  const packed = child("pack", [npm, "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", path.join(scratch, "artifacts")], composition);
  const metadata = JSON.parse(packed.stdout.toString())[0];
  const tarball = path.join(scratch, "artifacts", metadata.filename);
  assert.equal(hash(fs.readFileSync(tarball)), hash(fs.readFileSync(path.join(own, "candidate.tgz"))), "rebuilt artifact must equal the sealed reviewed package");
  results.package = { sha256: hash(fs.readFileSync(tarball)), metadata };
  const sourceConsumer = path.join(scratch, "source-consumer");
  harness(sourceConsumer);
  results.layouts.source = execute("source", configuration("source", "source", sourceConsumer, composition));
  const installed = path.join(scratch, "installed-consumer");
  harness(installed);
  child("install", [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball], installed);
  const installedRoot = path.join(installed, "node_modules/virtual-bash");
  const packageInventory = inventory(installedRoot);
  assert.equal(packageInventory["package.json"].sha256, payload.files["package.json"].sha256);
  for (const [name, record] of Object.entries(packageInventory)) assert.equal(record.sha256, hash(fs.readFileSync(path.join(composition, name))), `installed differs from built artifact: ${name}`);
  const emitted = inventory(path.join(composition, "dist"));
  assert.deepEqual(Object.keys(packageInventory).filter(name => name.startsWith("dist/")).map(name => name.slice(5)).sort(), Object.keys(emitted).sort());
  results.package.entries = Object.keys(packageInventory).length;
  write(path.join(raw, "package-inventory.json.gz"), pack(packageInventory));
  results.layouts.installed = execute("installed", configuration("installed", "installed", installed, installedRoot));
  const installedConsumerInventory = inventory(installed);
  const moved = path.join(scratch, "physically-moved-consumer");
  fs.renameSync(installed, moved);
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(inventory(moved), installedConsumerInventory);
  const movedRoot = path.join(moved, "node_modules/virtual-bash");
  results.move = { original: installed, destination: moved, originalAbsentBeforeRun: true, identicalRegularFileInventory: true };
  results.layouts.moved = execute("moved", configuration("moved", "moved", moved, movedRoot));
  assert.equal(fs.existsSync(installed), false);
  assert.deepEqual(inventory(moved), installedConsumerInventory);
  const controls = JSON.parse(fs.readFileSync(path.join(own, "CONTROLS.json")));
  for (const mutant of controls.sourceMutants) {
    assert.equal(results.layouts.source.cases.find(value => value.id === mutant.witness)?.status, "pass", "candidate witness must pass before mutation");
    const root = path.join(scratch, `mutant-${mutant.id}`);
    fs.mkdirSync(root);
    fs.cpSync(path.join(composition, "src"), path.join(root, "src"), { recursive: true, preserveTimestamps: true });
    write(path.join(root, "package.json"), fs.readFileSync(path.join(composition, "package.json")));
    const provider = path.join(root, "src/fs/webdav/webdav.ts");
    const original = fs.readFileSync(provider, "utf8");
    assert.equal(original.split(mutant.from).length, 2, "mutant must have exactly one source match");
    fs.writeFileSync(provider, original.replace(mutant.from, mutant.to));
    const record = execute(`mutant-${mutant.id}`, configuration(`mutant-${mutant.id}`, "source", sourceConsumer, root,
      { caseIds: [mutant.witness], mutant: mutant.id }), false);
    results.sourceMutants.push({ ...mutant, mutatedProviderSha256: hash(fs.readFileSync(provider)),
      result: record, killed: record.summary.fail === 1 && record.summary.pass === 0 });
  }
  for (const control of controls.loadControls) {
    const consumer = path.join(scratch, `load-${control.id}`);
    fs.cpSync(moved, consumer, { recursive: true, preserveTimestamps: true });
    const root = path.join(consumer, "node_modules/virtual-bash");
    const settings = configuration(`load-${control.id}`, "moved", consumer, root, {
      control: { expected: control.expected, specifier: control.id === "outside-source" ? pathToFileURL(path.join(composition, "src/index.ts")).href : "virtual-bash" },
    });
    if (control.id === "tampered-packed-provider") fs.appendFileSync(path.join(root, "dist/fs/webdav/webdav.js"), "\n;");
    if (control.id === "missing-package-entry") fs.renameSync(path.join(root, "dist/index.js"), path.join(root, "dist/index.removed"));
    child(`load-${control.id}`, [path.join(consumer, "boot.mjs"), settings.filename], consumer);
    const result = JSON.parse(fs.readFileSync(settings.config.result));
    const load = JSON.parse(fs.readFileSync(settings.config.loadLog));
    write(path.join(raw, `load-${control.id}.json.gz`), pack({ result, load }));
    results.loadControls.push({ ...control, result });
  }
  assert.deepEqual(liveProtected(), liveBefore);
  originalFreeze();
  results.livePreserved = true;
  results.finishedAt = new Date().toISOString();
  save(`RESULT-${captureName}.json`, results);
} catch (error) {
  results.fatal = { message: error.message, stack: error.stack };
  results.finishedAt = new Date().toISOString();
  save(`RESULT-${captureName}.json`, results);
  throw error;
}
