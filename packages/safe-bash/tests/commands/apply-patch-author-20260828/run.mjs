import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const seal = JSON.parse(fs.readFileSync(path.join(own, "EXECUTOR-SEAL-v1.json")));
for (const [name, digest] of Object.entries(seal.files)) {
  const filename = path.resolve(own, name);
  assert.ok(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink());
  assert.equal(hash(fs.readFileSync(filename)), digest, name);
}
const composition = await import(pathToFileURL(path.join(repository, "tests/integration/coherent78-shell-author-20260828/compose.mjs")));
const manifest = JSON.parse(fs.readFileSync(path.join(repository, "tests/integration/coherent78-shell-author-20260828/MANIFEST.json")));
assert.equal(manifest.composedTree, "8437e4eda904e1248c25eeef0d9d455b1d251495");
const revision = process.argv[2]; assert.match(revision ?? "", /^[a-f0-9]{40}$/);
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-author-")));
const rootIdentity = fs.lstatSync(temporary);
const evidence = { candidate: revision, base: manifest.composedTree, seal, commands: [], layouts: [], types: [], controls: [], cleanup: {}, createdAt: new Date().toISOString() };
const compiler = path.join(repository, "node_modules/typescript/bin/tsc");
const npm = fs.realpathSync(path.join(path.dirname(process.execPath), "npm"));
const require = createRequire(import.meta.url);
const ts = require(path.join(repository, "node_modules/typescript/lib/typescript.js"));
evidence.tools = { node: process.version, nodeSha256: hash(fs.readFileSync(process.execPath)), compilerSha256: hash(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/_tsc.js"))), typescriptSha256: hash(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/typescript.js"))), npmSha256: hash(fs.readFileSync(npm)), platform: process.platform };
for (const name of ["home", "tmp", "cache", "outside"]) fs.mkdirSync(path.join(temporary, name));
for (const name of ["npmrc", "global-npmrc"]) fs.writeFileSync(path.join(temporary, name), "");
const environment = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(temporary, "home"), TMPDIR: path.join(temporary, "tmp"), npm_config_cache: path.join(temporary, "cache"), npm_config_userconfig: path.join(temporary, "npmrc"), npm_config_globalconfig: path.join(temporary, "global-npmrc"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false", NO_COLOR: "1" };
const source = path.join(temporary, "source");
function child(label, args, cwd, extraEnv = {}) {
  assert.ok(evidence.commands.length < 40, "child admission cap");
  const result = spawnSync(process.execPath, args, { cwd, env: { ...environment, ...extraEnv }, encoding: "utf8", timeout: 90000, killSignal: "SIGKILL", maxBuffer: 24 * 1024 * 1024 });
  const row = { label, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  evidence.commands.push(row);
  console.log(JSON.stringify({ label, status: row.status, signal: row.signal }));
  assert.equal(row.signal, null, `child termination/integrity stop: ${label}`);
  assert.equal(row.error, undefined, `child tool failure: ${label}`);
  return row;
}
function success(row) { assert.equal(row.status, 0, `${row.label}: ${row.stdout}\n${row.stderr}`); }
function inventory(root) {
  return Object.fromEntries(Object.entries(composition.inventory(root)).filter(([name]) => name.startsWith("dist/") || name === "README.md" || name === "package.json"));
}
function harness(root, product, admitted, mockJs) {
  for (const name of ["probe.mjs", "loader.mjs", "CASES-v1.json"]) fs.copyFileSync(path.join(own, name), path.join(root, name));
  const routed = mockJs.replace('"../../../src/fs/webdav/resource-id.js"', JSON.stringify(pathToFileURL(path.join(product, "dist/fs/webdav/resource-id.js")).href));
  assert.notEqual(routed, mockJs);
  fs.writeFileSync(path.join(root, "mock.mjs"), routed);
  fs.writeFileSync(path.join(root, "admitted.json"), JSON.stringify(admitted));
}
function runtime(label, root, product, ids) {
  const fixture = path.join(root, `fixture-${label}`); fs.mkdirSync(fixture);
  const log = path.join(root, `loads-${label}.jsonl`); fs.writeFileSync(log, "");
  const row = child(label, ["--permission", `--allow-fs-read=${root}`, `--allow-fs-write=${fixture}`, `--allow-fs-write=${log}`, "--allow-worker", "--loader", pathToFileURL(path.join(root, "loader.mjs")).href, path.join(root, "probe.mjs")], root, { RUN_ROOT: root, PRODUCT_ROOT: product, PRODUCT_INVENTORY: path.join(root, "admitted.json"), LOAD_LOG: log, FIXTURE_ROOT: fixture, ...(ids ? { CASE_IDS: ids } : {}) });
  const observations = row.stdout.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const loads = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  row.observations = observations; row.loads = loads;
  fs.rmSync(fixture, { recursive: true });
  return row;
}
function runtimeCheck(row, count) {
  const summary = row.observations.at(-1)?.summary;
  assert.ok(summary, "no completed safe test summary; stop dependents");
  assert.equal(summary.cases, count); assert.equal(summary.shells, summary.disposed);
  for (const file of ["apply", "parser", "matcher", "shared", "options", "index"]) assert.ok(row.loads.some(load => load.relative === `dist/commands/apply-patch/${file}.js`));
  evidence.layouts.push({ label: row.label, summary, modules: new Set(row.loads.map(load => load.relative)).size });
  return summary.passed === count;
}
function types(label, root, product, admitted) {
  const modulePath = pathToFileURL(path.join(product, "dist/commands/apply-patch/index.js")).href;
  const rootPath = pathToFileURL(path.join(product, "dist/index.js")).href;
  const relativeModule = "./" + path.relative(root, path.join(product, "dist/commands/apply-patch/index.js")).split(path.sep).join("/");
  const relativeRoot = "./" + path.relative(root, path.join(product, "dist/index.js")).split(path.sep).join("/");
  const good = `import {createApplyPatchCommand,createApplyPatchCommands,applyPatchCommands,type ApplyPatchCommandsOptions,type ApplyPatchLimits} from ${JSON.stringify(relativeModule)};\nconst opts:ApplyPatchCommandsOptions={limits:{maxPatchBytes:64}}; const command=createApplyPatchCommand(opts); const definitions=createApplyPatchCommands(opts); const plugin=applyPatchCommands(opts); const limits:Partial<ApplyPatchLimits>={maxWork:128}; void [command,definitions,plugin,limits];\n`;
  const rows = [
    ["positive", good, 0],
    ["bad-limit", good + 'const invalid:ApplyPatchCommandsOptions={limits:{maxPatchBytes:"wrong"}};\n', 2, "TS2322"],
    ["bad-limit-repair", good + "const valid:ApplyPatchCommandsOptions={limits:{maxPatchBytes:32}};\n", 0],
    ["not-root-exported", `import {createApplyPatchCommand} from ${JSON.stringify(relativeRoot)}; void createApplyPatchCommand;\n`, 2, "TS2305"],
    ["root-export-repair", good, 0],
  ];
  for (const [name, body, expected, diagnostic] of rows) {
    const filename = path.join(root, "consumer.mts"); fs.writeFileSync(filename, body);
    const row = child(`${label}-types-${name}`, [compiler, "--noEmit", "--listFiles", "--strict", "--exactOptionalPropertyTypes", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--typeRoots", path.join(repository, "node_modules/@types"), filename], path.join(temporary, "outside"));
    const matched = row.status === expected && (expected === 0 || (row.stdout.includes(diagnostic) && !row.stdout.includes("TS2307")));
    const declarations = row.stdout.split("\n").filter(line => line.startsWith(product + path.sep) && line.endsWith(".d.ts")).map(line => ({ relative: path.relative(product, line), sha256: hash(fs.readFileSync(line)) }));
    for (const declaration of declarations) assert.equal(declaration.sha256, admitted[declaration.relative]?.sha256);
    assert.ok(declarations.length > 0); assert.equal(row.stdout.split("\n").some(line => line.startsWith(product + path.sep) && line.endsWith(".ts") && !line.endsWith(".d.ts")), false);
    evidence.types.push({ layout: label, name, matched, expected, actual: row.status, declarations, modulePath, rootPath });
    fs.unlinkSync(filename); assert.ok(matched, row.stdout);
  }
}

let failure;
try {
  const bad = structuredClone(manifest); bad.inputs[0].sha256 = "0".repeat(64); assert.throws(() => composition.authenticate(bad));
  const contents = composition.authenticate(manifest);
  const selected = composition.git("ls-tree", "-r", "--name-only", revision, "--", "src/commands/apply-patch").toString().trim().split("\n").filter(Boolean);
  const declared = JSON.parse(fs.readFileSync(path.join(own, "IMPLEMENTATION-PRESEAL-v1.json"))).productionPaths;
  assert.deepEqual(selected.toSorted(), declared.toSorted());
  evidence.source = [];
  for (const filename of selected) {
    const bytes = composition.blob(revision, filename); contents.set(filename, bytes);
    evidence.source.push({ path: filename, sha256: hash(bytes), bytes: bytes.length });
  }
  composition.materialize(contents, source);
  const before = composition.inventory(source);
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(source, "node_modules"), "dir");
  success(child("build", [compiler, "-p", path.join(source, "tsconfig.build.json")], source));
  fs.unlinkSync(path.join(source, "node_modules"));
  const admitted = inventory(source);
  evidence.packageInventory = admitted; evidence.packageManifestSha256 = hash(Buffer.from(JSON.stringify(admitted)));
  assert.equal(Object.values(admitted).filter(row => row.kind === "file").length, 882);
  const mockBytes = composition.blob(manifest.base, "tests/fs/webdav/mock.ts");
  evidence.mock = { revision: manifest.base, path: "tests/fs/webdav/mock.ts", sha256: hash(mockBytes), role: "unchanged admitted test mock; transpile-only developer helper with explicit emitted resource-id import routing, not real-service evidence" };
  const mockJs = ts.transpileModule(mockBytes.toString(), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 }, fileName: "mock.ts" }).outputText;
  harness(source, source, admitted, mockJs);
  const sourceRow = runtime("source-build", source, source); const sourcePassed = runtimeCheck(sourceRow, 63);
  types("source", source, source, admitted);
  const packed = child("offline-pack", [npm, "pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", temporary], source); success(packed);
  const metadata = JSON.parse(packed.stdout)[0]; assert.equal(metadata.files.length, 882);
  const tarball = path.join(temporary, metadata.filename), packBytes = fs.readFileSync(tarball);
  evidence.pack = { sha256: hash(packBytes), bytes: packBytes.length, metadata, base64: packBytes.toString("base64") };
  const installed = path.join(temporary, "installed"); fs.mkdirSync(installed);
  fs.writeFileSync(path.join(installed, "package.json"), JSON.stringify({ name: "apply-patch-internal-consumer", private: true, type: "module" }));
  success(child("offline-install", [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], installed));
  let product = path.join(installed, "node_modules/virtual-bash"); assert.deepEqual(inventory(product), admitted);
  harness(installed, product, admitted, mockJs);
  const installedRow = runtime("installed", installed, product); const installedPassed = runtimeCheck(installedRow, 63);
  types("installed", installed, product, admitted);
  const moved = path.join(temporary, "physically-moved"); fs.renameSync(installed, moved); assert.equal(fs.existsSync(installed), false);
  product = path.join(moved, "node_modules/virtual-bash"); assert.deepEqual(inventory(product), admitted);
  harness(moved, product, admitted, mockJs);
  const movedRow = runtime("moved", moved, product); const movedPassed = runtimeCheck(movedRow, 63);
  types("moved", moved, product, admitted);
  if (sourcePassed && installedPassed && movedPassed) {
    const mutants = [
      ["early-write", "apply.js", 'return new Invocation(context, limits).run();', 'return context.fs.writeFile("/work/a", Buffer.from("mutant")).then(() => new Invocation(context, limits).run());', "P28"],
      ["fuzzy", "matcher.js", 'work.equal(lines[candidate + offset].text, pattern[offset])', 'work.equal(lines[candidate + offset].text.trim(), pattern[offset].trim())', "P18"],
      ["early-unlink", "apply.js", 'await this.parents(file.destination);', 'await this.context.fs.rm(file.path); await this.parents(file.destination);', "T17"],
      ["borrowed-buffer", "apply.js", 'chunks.push(new Uint8Array(chunk));', 'chunks.push(chunk);', "T02"],
      ["raise-limit", "options.js", 'value > maxima[key]', 'false', "T04"],
      ["drop-caller-check", "shared.js", 'this.context.signal.throwIfAborted();', '', "T13"],
    ];
    for (const [name, file, needle, replacement, id] of mutants) {
      const relative = `dist/commands/apply-patch/${file}`, filename = path.join(product, relative), original = fs.readFileSync(filename);
      assert.ok(original.toString().includes(needle), `mutation site missing: ${name}`);
      const modified = Buffer.from(original.toString().replaceAll(needle, replacement)); fs.writeFileSync(filename, modified);
      const mutantInventory = { ...admitted, [relative]: { ...admitted[relative], sha256: hash(modified), bytes: modified.length } };
      fs.writeFileSync(path.join(moved, "admitted.json"), JSON.stringify(mutantInventory));
      const row = runtime(`mutant-${name}`, moved, product, id);
      assert.ok(row.loads.some(load => load.relative === relative && load.sha256 === hash(modified)), "mutant was not loaded");
      const killed = row.status === 1 && row.observations.some(observation => observation.id === id && observation.pass === false);
      evidence.controls.push({ name, id, killed, original: hash(original), mutated: hash(modified) });
      fs.writeFileSync(filename, original); fs.writeFileSync(path.join(moved, "admitted.json"), JSON.stringify(admitted));
      success(runtime(`restore-${name}`, moved, product, id)); assert.ok(killed, `mutant survived: ${name}`);
    }
    for (const kind of ["changed-hash", "unlisted", "outside"]) {
      const altered = structuredClone(admitted);
      if (kind === "changed-hash") altered["dist/commands/apply-patch/index.js"].sha256 = "0".repeat(64);
      if (kind === "unlisted") delete altered["dist/commands/apply-patch/index.js"];
      fs.writeFileSync(path.join(moved, "admitted.json"), JSON.stringify(altered));
      const originalProbe = fs.readFileSync(path.join(moved, "probe.mjs"));
      if (kind === "outside") fs.writeFileSync(path.join(moved, "probe.mjs"), `await import(${JSON.stringify(pathToFileURL(path.join(source, "dist/index.js")).href)});`);
      const row = runtime(`binding-${kind}`, moved, product, "P01");
      assert.equal(row.status, 1); assert.match(row.stderr, /Changed product load|Unlisted product load|Outside admitted consumer|ERR_ACCESS_DENIED/);
      evidence.controls.push({ name: kind, rejected: true });
      fs.writeFileSync(path.join(moved, "probe.mjs"), originalProbe);
    }
  }
  const after = composition.inventory(source);
  for (const [name, expected] of Object.entries(before)) assert.deepEqual(after[name], expected, name);
  assert.deepEqual(Object.keys(after).filter(name => name.startsWith("src/")).sort(), Object.keys(before).filter(name => name.startsWith("src/")).sort());
  assert.deepEqual(inventory(product), admitted);
  evidence.completed = true; evidence.allRuntimePassed = sourcePassed && installedPassed && movedPassed;
  if (!evidence.allRuntimePassed) process.exitCode = 1;
} catch (error) { failure = error; evidence.failure = error?.stack ?? String(error); process.exitCode = 1; }
finally {
  const current = fs.lstatSync(temporary); assert.equal(current.ino, rootIdentity.ino); assert.equal(current.dev, rootIdentity.dev);
  fs.rmSync(temporary, { recursive: true }); evidence.cleanup = { removedOwnedRoot: !fs.existsSync(temporary), children: evidence.commands.length, naturalOrObservedSettlements: evidence.commands.every(row => row.signal === null && row.error === undefined) };
  const capture = path.join(own, "captures", path.basename(temporary) + ".json.gz.base64"); fs.mkdirSync(path.dirname(capture), { recursive: true });
  fs.writeFileSync(capture, gzipSync(Buffer.from(JSON.stringify(evidence))).toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ capture, failure: evidence.failure, layouts: evidence.layouts, cleanup: evidence.cleanup }));
}
if (failure) console.error(failure.stack ?? failure);
